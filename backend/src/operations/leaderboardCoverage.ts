import "dotenv/config";
import pg from "pg";
import { pathToFileURL } from "node:url";

// Aggregate SELECT only. Includes empty levels and never registers competitions.
export const leaderboardCoverageSql = `
select level,
 count(p.puzzle_id)::int as active_playable,
 count(p.puzzle_id) filter (where c.active and c.leaderboard_enabled and c.category = 'MAIN_LEVEL' and c.max_leaderboard_time_ms > 0)::int as enabled_main_leaderboards,
 count(p.puzzle_id) filter (where c.puzzle_id is null or c.category is null or c.max_leaderboard_time_ms is null)::int as incomplete_configuration,
 count(p.puzzle_id) filter (where c.category = 'SIDE_QUEST')::int as side_quest_configured
from generate_series(1,10) as levels(level)
left join puzzles p on p.level_id = level and p.status = 'ACTIVE' and p.deleted_at is null
left join puzzle_competition_settings c on c.puzzle_id = p.puzzle_id
group by level order by level`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for read-only coverage.");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10s'");
    const result = await client.query(leaderboardCoverageSql);
    await client.query("ROLLBACK");
    console.log(JSON.stringify({ capturedAt: new Date().toISOString(), readOnly: true, levels: result.rows }, null, 2));
  } finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Read-only leaderboard coverage failed; check connectivity and database access."); process.exitCode = 1; });
}
