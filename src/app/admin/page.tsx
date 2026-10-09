import Link from "next/link";
import { dataMode } from "@/config/dataMode";
import { adminService } from "@/services";
export default async function Page(){if(dataMode === "api") return <main className="p-8"><h1 className="cz-display text-3xl">CircZles Admin</h1><Link className="cz-btn mt-4" href="/admin/puzzles">Open CircZles Catalog</Link></main>; const o=await adminService.getOverview();return <main className="mx-auto max-w-7xl px-4 py-8"><h1 className="font-display text-5xl font-bold">Admin Dashboard</h1><div className="mt-6 grid gap-4 md:grid-cols-5">{Object.entries(o).map(([k,v])=><div className="game-card border-amber-200/20 p-4" key={k}><p className="text-sm text-amber-200/70">{k}</p><p className="stat-number text-3xl">{String(v)}</p></div>)}</div></main>}
