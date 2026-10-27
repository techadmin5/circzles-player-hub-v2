// No DATABASE_URL fallback, dotenv loading, sockets, hostname aliases or URL options.
// A separate explicit database name prevents accidentally reusing circzles_m1_test.
export function localMissionPostgresUrl(raw: string | undefined, database: string | undefined, attestation: string | undefined) {
  if (!raw || !database || !/^circzles_m1_verify_\d{8}_[a-f0-9]{12}$/.test(database) || attestation !== "YES_LOCAL_DISPOSABLE") throw new Error("Requires a uniquely named, explicitly attested disposable local mission database.");
  let target: URL;
  try { target = new URL(raw); } catch { throw new Error("Invalid local test database URL; connection details omitted."); }
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.port !== "5432" || target.username !== "circzles_test" || target.pathname !== `/${database}` || target.search || target.hash) throw new Error("Only the exact disposable database / circzles_test on 127.0.0.1:5432 is allowed, without connection overrides.");
  return target;
}
