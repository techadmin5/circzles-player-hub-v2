// Wix Studio → Backend → playerHubHandoff.web.js   (circzles.in)
import { Permissions, webMethod } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { getSecret } from 'wix-secrets-backend';
import { buildHandoffClaims, signHandoff, HandoffRefusal } from 'backend/playerHubHandoffCore';

const ISSUER = 'circzles.in';
const SECRET_NAME = 'AUTH_HANDOFF_CIRCZLES_IN_SECRET'; // stored in Wix Secrets Manager, never in frontend code
const PLAYER_HUB_ORIGIN = 'https://circzles-player-hub.vercel.app'; // fixed: the browser can never choose the destination

export const createPlayerHubHandoff = webMethod(Permissions.Anyone, async () => {
  try {
    // Backend getMember() throws when nobody is logged in; identity is read from the caller's session.
    // buildHandoffClaims additionally requires this authoritative member record to report loginEmailVerified === true.
    const member = await currentMember.getMember({ fieldsets: ['FULL'] });
    const claims = buildHandoffClaims(member, { issuer: ISSUER });
    const secret = await getSecret(SECRET_NAME);
    const token = signHandoff(claims, secret);
    return { ok: true, url: `${PLAYER_HUB_ORIGIN}/auth/handoff#handoff=${token}` };
  } catch (error) {
    if (error instanceof HandoffRefusal) return { ok: false, reason: error.code };
    console.error('Player Hub handoff failed', error && error.message);
    return { ok: false, reason: 'NOT_LOGGED_IN_OR_UNAVAILABLE' };
  }
});
