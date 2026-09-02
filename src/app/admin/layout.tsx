import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const nav = ["players","submissions","puzzles","missions","rewards","store","progression","leaderboards","seasons","notifications","audit-log"];
  return <div className="min-h-dvh bg-[#120b08] text-amber-50"><aside className="border-b border-amber-200/15 bg-black/30 p-4"><Link href="/admin" className="font-display text-3xl font-bold text-[var(--gold)]">CircZles Admin</Link><nav className="mt-3 flex gap-2 overflow-x-auto">{nav.map(n=><Link className="rounded-md border border-amber-200/15 px-3 py-2 text-sm" key={n} href={`/admin/${n}`}>{n}</Link>)}</nav></aside>{children}</div>;
}
