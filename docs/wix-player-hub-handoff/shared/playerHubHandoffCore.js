// Wix Studio → backend/playerHubHandoffCore.js  (identical on circzles.com and circzles.in)
//
// Pure logic: no Wix imports, so it can be unit-tested outside Wix. The Player Hub repository test
// (backend/tests/wixHandoffTemplate.test.ts) feeds tokens from this file to the real AuthHandoffVerifier.
import { createHmac, randomBytes } from 'crypto';

const AUDIENCE = 'circzles-player-hub';
const TTL_SECONDS = 120; // Player Hub rejects anything longer than 300.
// Member statuses that mean "approved and allowed to log in". Anything else (PENDING, BLOCKED, ...) is refused.
const ELIGIBLE_STATUSES = ['APPROVED', 'ACTIVE'];

export class HandoffRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const clean = (value, max) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

const absoluteHttpsUrl = (value) => {
  if (typeof value !== 'string') return undefined;
  const url = value.startsWith('//') ? `https:${value}` : value;
  return /^https:\/\/[^\s]+$/.test(url) && url.length <= 2048 ? url : undefined;
};

/**
 * @param member  the object returned by currentMember.getMember() in BACKEND code
 * @param options { issuer, now?: Date, jti?: string }
 */
export function buildHandoffClaims(member, options) {
  const { issuer } = options;
  if (issuer !== 'circzles.com' && issuer !== 'circzles.in') throw new HandoffRefusal('BAD_ISSUER_CONFIG', 'Issuer is not configured.');
  if (!member) throw new HandoffRefusal('NOT_LOGGED_IN', 'No logged-in member.');
  // Current Wix Members API uses `id`. `_id` is accepted only as a legacy Velo identifier alias;
  // identity, email and verification still come from the authenticated backend member record.
  const memberId = clean(member.id, 128) ?? clean(member._id, 128);
  if (!memberId) throw new HandoffRefusal('NOT_LOGGED_IN', 'Logged-in member has no usable ID.');
  if (!ELIGIBLE_STATUSES.includes(member.status)) throw new HandoffRefusal('MEMBER_NOT_ELIGIBLE', 'Member is not approved.');
  const email = clean(member.loginEmail, 320);
  if (!email || !email.includes('@')) throw new HandoffRefusal('NO_LOGIN_EMAIL', 'Member has no login email.');
  // Never infer email ownership from login success or a dashboard toggle. Wix must verify this member.
  if (member.loginEmailVerified !== true) throw new HandoffRefusal('EMAIL_NOT_VERIFIED', 'Member login email is not verified.');

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const firstName = clean(member.contact?.firstName ?? member.contactDetails?.firstName, 80);
  const lastName = clean(member.contact?.lastName ?? member.contactDetails?.lastName, 80);
  const displayName = clean(member.profile?.nickname, 80) ?? clean([firstName, lastName].filter(Boolean).join(' '), 80);
  const claims = {
    v: 1,
    iss: issuer,
    aud: AUDIENCE,
    sub: memberId,
    jti: options.jti ?? randomBytes(24).toString('hex'),
    iat: nowSeconds,
    exp: nowSeconds + TTL_SECONDS,
    email,
    emailVerified: true,
    provider: 'WIX',
  };
  // Optional fields are omitted entirely when empty: the Hub schema is strict and rejects empty strings.
  if (displayName) claims.displayName = displayName;
  if (firstName) claims.firstName = firstName;
  if (lastName) claims.lastName = lastName;
  const avatarUrl = absoluteHttpsUrl(member.profile?.photo?.url ?? member.profile?.profilePhoto?.url);
  if (avatarUrl) claims.avatarUrl = avatarUrl;
  return claims;
}

export function signHandoff(claims, secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new HandoffRefusal('SECRET_NOT_CONFIGURED', 'Handoff secret is missing or too short.');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'CZ-HANDOFF' }));
  const payload = b64url(JSON.stringify(claims));
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${header}.${payload}.${signature}`;
}
