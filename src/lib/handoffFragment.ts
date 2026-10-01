// The Wix → Player Hub handoff travels in the URL fragment (`#handoff=...`) so it is never sent
// to any server in a request line, Referer header, or access log.
export function readHandoffFromHash(hash: string): string | null {
  if (!hash.startsWith("#")) return null;
  const token = new URLSearchParams(hash.slice(1)).get("handoff")?.trim();
  return token && token.length <= 8192 ? token : null;
}

export function handoffFragmentFreeUrl(pathname: string): string {
  return pathname;
}
