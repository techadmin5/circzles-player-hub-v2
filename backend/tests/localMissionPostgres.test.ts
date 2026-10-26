import { expect, it } from "vitest";
import { localMissionPostgresUrl } from "./helpers/localMissionPostgres.js";
const name = "circzles_m1_verify_20261021_123456abcdef", attestation = "YES_LOCAL_DISPOSABLE";
const url = `postgresql://circzles_test:synthetic@127.0.0.1:5432/${name}`;
it("accepts only the explicitly named loopback disposable database", () => {
  expect(localMissionPostgresUrl(url, name, attestation).pathname).toBe(`/${name}`);
});
it.each([
  url.replace("127.0.0.1", "remote.example.invalid"), url.replace("127.0.0.1", "localhost"), url.replace("5432", "5433"),
  url.replace(name, "circzles_m1_test"), url.replace(name, "postgres"), url.replace(name, "neondb"),
  url.replace("circzles_test:", "techadmin:"), `${url}?host=remote.example.invalid`, `${url}?options=-csearch_path=other`, `${url}#override`,
])("rejects unsafe URL before opening any connection: %s", unsafe => {
  expect(() => localMissionPostgresUrl(unsafe, name, attestation)).toThrow();
});
it.each([undefined, "circzles_m1_test", "neondb", "circzles_m1_verify_20261021_short"])("requires an explicit unique disposable name: %s", invalid => {
  expect(() => localMissionPostgresUrl(url, invalid, attestation)).toThrow();
});
it("never falls back to application URLs or accepts a missing attestation", () => {
  expect(() => localMissionPostgresUrl(undefined, name, attestation)).toThrow();
  expect(() => localMissionPostgresUrl(url, name, undefined)).toThrow();
});
it("omits malformed credential-bearing input from parsing errors", () => {
  expect(() => localMissionPostgresUrl("malformed synthetic-secret", name, attestation)).toThrow("connection details omitted");
  try { localMissionPostgresUrl("malformed synthetic-secret", name, attestation); } catch (error) { expect(String(error)).not.toContain("synthetic-secret"); }
});
