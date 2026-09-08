import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { adminUsers, authSessions, users } from "../db/schema.js";
import { forbidden, unauthorized } from "./errors.js";
import { hashSessionToken } from "./sessions.js";

export type AdminRole = "SUPER_ADMIN" | "REVIEWER";
export type AdminPermission = "SUBMISSIONS_REVIEW" | "COMPETITION_CONFIG";

const ROLE_PERMISSIONS: Readonly<Record<AdminRole, ReadonlySet<AdminPermission>>> = {
  SUPER_ADMIN: new Set(["SUBMISSIONS_REVIEW", "COMPETITION_CONFIG"]),
  REVIEWER: new Set(["SUBMISSIONS_REVIEW"]),
};

export interface AdminSessionRecord {
  userId: string;
  adminUserId: string | null;
  role: AdminRole | null;
  adminActive: boolean | null;
}

export interface AdminAuthorizationRepository {
  findValidSession(tokenHash: string, now: Date): Promise<AdminSessionRecord | null>;
}

export class AdminAuthorizationService {
  constructor(private repo: AdminAuthorizationRepository, private sessionSecret: string) {}

  async requirePermission(token: string | undefined, permission: AdminPermission, now = new Date()) {
    if (!token) throw unauthorized();
    const session = await this.repo.findValidSession(hashSessionToken(token, this.sessionSecret), now);
    if (!session) throw unauthorized();
    if (!session.adminUserId || !session.role || session.adminActive !== true || !hasAdminPermission(session.role, permission)) throw forbidden("Admin permission is required.");
    return { userId: session.userId, adminUserId: session.adminUserId, role: session.role };
  }
}

export class DrizzleAdminAuthorizationRepository implements AdminAuthorizationRepository {
  constructor(private db: Database) {}

  async findValidSession(tokenHash: string, now: Date) {
    const [row] = await this.db.select({ userId: users.userId, adminUserId: adminUsers.adminUserId, role: adminUsers.role, adminActive: adminUsers.active })
      .from(authSessions)
      .innerJoin(users, eq(users.userId, authSessions.userId))
      .leftJoin(adminUsers, eq(adminUsers.userId, users.userId))
      .where(and(eq(authSessions.tokenHash, tokenHash), eq(authSessions.status, "ACTIVE"), gt(authSessions.expiresAt, now), isNull(authSessions.revokedAt), eq(users.status, "ACTIVE")))
      .limit(1);
    return row ?? null;
  }
}

export function hasAdminPermission(role: AdminRole, permission: AdminPermission) {
  return ROLE_PERMISSIONS[role].has(permission);
}
