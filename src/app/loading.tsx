export default function Loading() {
  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--cz-void)]">
      <div className="grid justify-items-center gap-3">
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--cz-hairline-strong)] border-t-[var(--cz-aqua)]" />
        <p className="cz-display text-sm text-[var(--cz-text-tertiary)]">Loading CircZles…</p>
      </div>
    </div>
  );
}
