export const MOCK_LATENCY_MS = Number(process.env.NEXT_PUBLIC_MOCK_LATENCY_MS ?? 20);

export async function mockDelay() {
  const delay = Math.max(0, Math.min(MOCK_LATENCY_MS, 80));
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}
