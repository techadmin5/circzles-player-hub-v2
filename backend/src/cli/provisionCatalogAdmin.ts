// Operator-only bootstrap. Never exposed through HTTP or run on server startup.
import { z } from "zod";
import { and, eq, isNotNull } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { users, adminUsers } from "../db/schema.js";

const args = process.argv.slice(2);
const userId = z.string().uuid().safeParse(args[1]);
if (args[0] !== "--user-id" || !userId.success || args.length > 3 || (args[2] !== undefined && args[2] !== "--apply") || !process.env.DATABASE_URL) {
  console.error("Usage: DATABASE_URL=<operator connection> tsx src/cli/provisionCatalogAdmin.ts --user-id <verified user UUID> [--apply]");
  process.exitCode = 1;
} else {
  const { pool, db } = createDb(process.env.DATABASE_URL);
  try {
    await db.transaction(async tx => {
      const [user] = await tx.select({ id: users.userId }).from(users).where(and(eq(users.userId, userId.data), eq(users.status, "ACTIVE"), isNotNull(users.verifiedEmail), isNotNull(users.emailVerifiedAt))).for("update");
      if (!user) throw new Error("A verified active account is required.");
      if (args[2] === "--apply") {
        await tx.insert(adminUsers).values({ userId: user.id, role: "SUPER_ADMIN", active: true }).onConflictDoUpdate({ target: adminUsers.userId, set: { role: "SUPER_ADMIN", active: true, updatedAt: new Date() } });
        console.info("Provisioned existing verified user as active SUPER_ADMIN: " + user.id);
      } else console.info("Preview: eligible verified user " + user.id + "; SUPER_ADMIN includes catalog management, reviews and competition configuration. No changes made.");
    });
  } catch { console.error("Admin provisioning failed. Verify the active account UUID and operator database access."); process.exitCode = 1; }
  finally { await pool.end(); }
}
