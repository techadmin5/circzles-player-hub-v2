import Link from "next/link";
import { AuthenticatedRoute } from "@/components/auth/AuthProvider";
import { dataMode } from "@/config/dataMode";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  if (dataMode === "api") return <AuthenticatedRoute><main className="grid min-h-dvh place-items-center bg-[var(--cz-void)] p-4"><section className="cz-surface max-w-lg p-6 text-center"><h1 className="cz-display text-2xl font-bold">Admin access unavailable</h1><p className="mt-2 text-sm text-[var(--cz-text-secondary)]">The Admin Control Center remains disabled until server-side admin role authorization is implemented.</p></section></main></AuthenticatedRoute>;
  const nav = ["players","submissions","puzzles","missions","rewards","store","progression","leaderboards","seasons","notifications","audit-log"];
  return <AuthenticatedRoute><div className="min-h-dvh bg-[#120b08] text-amber-50"><aside className="border-b border-amber-200/15 bg-black/30 p-4"><Link href="/admin" className="font-display text-3xl font-bold text-[var(--gold)]">CircZles Admin</Link><nav className="mt-3 flex gap-2 overflow-x-auto">{nav.map(n=><Link className="rounded-md border border-amber-200/15 px-3 py-2 text-sm" key={n} href={`/admin/${n}`}>{n}</Link>)}</nav></aside>{children}</div></AuthenticatedRoute>;
}
