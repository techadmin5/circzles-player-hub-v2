import { readMigrationFiles } from "drizzle-orm/migrator";
import { fileURLToPath } from "node:url";

export interface ResetClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

// Children precede parents. Every DELETE has an explicit UUID ownership predicate.
export const resetOrder = [
  "coupon_redemptions", "coupon_provider_mappings", "reward_wheel_spins",
  "inventory_consumptions", "player_equipment", "submission_reviews", "leaderboard_entries",
  "submission_reward_grants", "mission_claims", "store_purchases", "inventory_grants",
  "coupon_ownerships", "player_inventory_items", "player_mission_progress", "game_events",
  "submissions", "player_puzzles", "video_uploads", "puzzle_claims", "xp_transactions",
  "point_transactions", "player_progression", "wallets", "auth_sessions", "auth_identities",
  "password_credentials", "auth_challenges", "auth_handoff_exchanges", "wix_identity_links",
  "admin_users", "players", "users",
] as const;
const userTables = new Set(["auth_sessions", "auth_identities", "password_credentials", "auth_handoff_exchanges", "wix_identity_links", "admin_users", "players", "users"]);
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const migrations = () => readMigrationFiles({ migrationsFolder: fileURLToPath(new URL("../../drizzle/", import.meta.url)) });
const demand = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

export interface ResetManifest {
  version: 1;
  database: string;
  identities: Record<string, unknown>[];
  challenges: Record<string, unknown>[];
  dependencies: Record<string, unknown>[];
  preserved: Record<string, unknown>[];
  foreignKeys: Record<string, unknown>[];
  history: Record<string, unknown>[];
}

async function foreignKeys(client: ResetClient) {
  return (await client.query(`SELECT ns.nspname AS schema, src.relname AS child, dst.relname AS parent,
    pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
    JOIN pg_class src ON src.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=src.relnamespace
    JOIN pg_class dst ON dst.oid=c.confrelid JOIN pg_namespace nd ON nd.oid=dst.relnamespace
    WHERE c.contype='f' AND nd.nspname='public' ORDER BY 1,2,3,4`)).rows;
}

async function publicTables(client: ResetClient) {
  return (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map((row) => String(row.tablename));
}

async function fingerprints(client: ResetClient, tables: string[]) {
  const rows: Record<string, unknown>[] = [];
  for (const table of tables) {
    const [row] = (await client.query(`SELECT count(*)::text AS count,
      md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), '')) AS fingerprint
      FROM public.${quote(table)} t`)).rows;
    rows.push({ table, ...row });
  }
  return rows;
}

async function assertPreMigration(client: ResetClient) {
  const expected = migrations();
  demand(expected.length === 22, "Expected the reviewed 0000–0021 migration chain");
  demand((await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS journal")).rows[0].journal, "Missing Drizzle migration journal");
  const history = (await client.query("SELECT created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows;
  demand(JSON.stringify(history) === JSON.stringify(expected.slice(0, 21).map((entry) => ({ created_at: String(entry.folderMillis) }))), "Database must have exactly migrations 0000–0020; 0021 must be unapplied");
  demand(!(await client.query("SELECT to_regclass('public.players_player_number_seq') AS sequence")).rows[0].sequence, "Player sequence already exists");
  demand((await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='players' AND column_name='player_number'")).rows.length === 0, "Player number already exists");
  demand((await client.query("SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal")).rows.length === 0, "Unexpected user-defined trigger: review reset effects first");
  return history;
}

// Call only inside a transaction. This performs no persistent writes.
export async function captureResetPreflight(client: ResetClient): Promise<ResetManifest> {
  const tables = await publicTables(client);
  await client.query(`LOCK TABLE ${tables.map((table) => `public.${quote(table)}`).join(", ")}, drizzle.__drizzle_migrations IN SHARE ROW EXCLUSIVE MODE`);
  const history = await assertPreMigration(client);
  const identities = (await client.query(`SELECT u.user_id::text, p.player_id::text, p.public_player_id, u.verified_email
    FROM users u FULL JOIN players p ON p.user_id=u.user_id ORDER BY u.user_id, p.player_id`)).rows;
  demand(identities.length === 12 && identities.every((row) => row.user_id && row.player_id && row.public_player_id), "Expected exactly 12 users with exactly 12 matching players, no extra/unpaired identities");
  const keys = await foreignKeys(client);
  const scope = new Set<string>(["users", "players"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of keys) if (scope.has(String(key.parent))) {
      demand(key.schema === "public" && resetOrder.includes(String(key.child) as typeof resetOrder[number]), `Unreviewed dependent table ${key.schema}.${key.child}`);
      if (!scope.has(String(key.child))) { scope.add(String(key.child)); changed = true; }
    }
  }
  demand(resetOrder.every((table) => tables.includes(table)), "Missing audited player tables");
  const challenges = (await client.query("SELECT id::text, user_id::text, email FROM auth_challenges ORDER BY id")).rows;
  demand(challenges.every((row) => row.user_id ? identities.some((identity) => identity.user_id === row.user_id) : identities.some((identity) => identity.verified_email === row.email)), "Unassociated signup challenge: review separately before reset");
  demand((await client.query("SELECT count(*)::text AS count FROM google_auth_states WHERE expires_at > now()")).rows[0].count === "0", "Wait for in-flight Google authorization states to expire with writes paused");
  return {
    version: 1, database: String((await client.query("SELECT current_database() AS name")).rows[0].name),
    identities, challenges, dependencies: await fingerprints(client, [...resetOrder]),
    preserved: await fingerprints(client, tables.filter((table) => !resetOrder.includes(table as typeof resetOrder[number]))),
    foreignKeys: keys, history,
  };
}

function predicate(table: string) {
  if (table === "auth_challenges") return "t.id=ANY($3::uuid[])";
  if (table === "coupon_redemptions" || table === "coupon_provider_mappings") return "t.coupon_ownership_id IN (SELECT coupon_ownership_id FROM coupon_ownerships WHERE player_id=ANY($2::uuid[]))";
  if (table === "submission_reviews") return "t.submission_id IN (SELECT submission_id FROM submissions WHERE player_id=ANY($2::uuid[])) OR t.reviewer_admin_user_id IN (SELECT admin_user_id FROM admin_users WHERE user_id=ANY($1::uuid[]))";
  return userTables.has(table) ? "t.user_id=ANY($1::uuid[])" : "t.player_id=ANY($2::uuid[])";
}

// Caller owns BEGIN/COMMIT/ROLLBACK. Reset, 0021 and journal insertion share one transaction.
export async function resetTestPlayersAndMigrate(client: ResetClient, reviewed: ResetManifest) {
  const actual = await captureResetPreflight(client);
  demand(JSON.stringify(actual) === JSON.stringify(reviewed), "Preflight differs from reviewed manifest; nothing deleted");
  const params = [reviewed.identities.map((row) => row.user_id), reviewed.identities.map((row) => row.player_id), reviewed.challenges.map((row) => row.id)];
  // Typed parameters appear even when a particular ownership predicate uses only one array.
  for (const table of resetOrder) await client.query(`DELETE FROM public.${quote(table)} t WHERE (${predicate(table)}) AND cardinality($1::uuid[]) = 12 AND cardinality($2::uuid[]) = 12 AND cardinality($3::uuid[]) >= 0`, params);
  demand((await client.query("SELECT count(*)::text AS count FROM players")).rows[0].count === "0", "Reset did not leave players empty");
  const migration = migrations()[21];
  for (const statement of migration.sql) await client.query(statement);
  await client.query("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)", [migration.hash, migration.folderMillis]);
  await assertLaunchPostflight(client, reviewed);
}

export async function assertLaunchPostflight(client: ResetClient, reviewed: ResetManifest) {
  demand(String((await client.query("SELECT current_database() AS name")).rows[0].name) === reviewed.database, "Wrong database for reviewed manifest");
  const history = (await client.query("SELECT created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows;
  demand(JSON.stringify(history) === JSON.stringify(migrations().map((entry) => ({ created_at: String(entry.folderMillis) }))), "Expected migration journal through 0021");
  for (const table of resetOrder) {
    const [row] = (await client.query(`SELECT count(*)::text AS count FROM public.${quote(table)}`)).rows;
    // Unbound handoff replay rows have no user ownership and must survive.
    const expected = table === "auth_handoff_exchanges" ? (await client.query("SELECT count(*)::text AS count FROM auth_handoff_exchanges WHERE user_id IS NULL")).rows[0].count : "0";
    demand(row.count === expected, `Remaining/orphaned rows in ${table}`);
  }
  const [sequence] = (await client.query("SELECT last_value::text, is_called FROM players_player_number_seq")).rows;
  demand(sequence.last_value === "1" && sequence.is_called === false, "Next player allocation must be 1 (audit does not consume nextval)");
  const indexes = (await client.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='players' AND indexdef LIKE 'CREATE UNIQUE INDEX%'")).rows.map((row) => row.indexname);
  demand(indexes.includes("players_public_player_id_unique") && indexes.includes("players_player_number_unique"), "Missing unique player identity indexes");
  const protectedRows = await fingerprints(client, reviewed.preserved.map((row) => String(row.table)));
  demand(JSON.stringify(protectedRows) === JSON.stringify(reviewed.preserved), "Protected catalog/config data changed; rollback required");
}
