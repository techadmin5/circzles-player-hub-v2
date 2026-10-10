// Storage only. Future eligibility checks must run server-side on verified submissions.
export function parseCatalogTime(minutes: string, seconds: string): number | null {
  if (!minutes && !seconds) return null;
  if (!/^[0-9]+$/.test(minutes) || !/^[0-9]+$/.test(seconds)) throw new Error("Enter whole, non-negative minutes and seconds.");
  const m = Number(minutes), s = Number(seconds), total = (m * 60 + s) * 1000;
  if (s > 59) throw new Error("Seconds must be between 0 and 59.");
  if (!Number.isSafeInteger(total) || total <= 0 || total > 2147483647) throw new Error("Enter a positive time of at most 35791 minutes and 23 seconds.");
  return total;
}
export function formatCatalogTime(time: number | null | undefined): string {
  if (time == null) return "Not set";
  return String(Math.floor(time / 60000)).padStart(2, "0") + ":" + String(Math.floor(time / 1000) % 60).padStart(2, "0");
}
