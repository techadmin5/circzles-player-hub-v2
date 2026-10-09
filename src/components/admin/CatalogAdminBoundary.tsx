"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { catalogAdmin } from "@/lib/catalogAdmin";
import { usePlayerUiState } from "@/stores/playerUiState";

export function CatalogAdminBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const generation = usePlayerUiState(state => state.sessionVersion);
  const [authorization, setAccess] = useState<{ generation: number; status: "loading" | "allowed" | "denied" }>({ generation, status: "loading" });
  const access = authorization.generation === generation ? authorization.status : "loading";
  useEffect(() => {
    const controller = new AbortController();
    catalogAdmin.access(controller.signal).then(result => { if (!controller.signal.aborted) setAccess({ generation, status: result.allowed ? "allowed" : "denied" }); }).catch(() => { if (!controller.signal.aborted) setAccess({ generation, status: "denied" }); });
    return () => controller.abort();
  }, [generation]);
  if (access !== "allowed") return <main className="mx-auto max-w-xl p-8"><h1 className="cz-display text-2xl">{access === "loading" ? "Checking admin access…" : "Admin access unavailable"}</h1><p className="mt-3">{access === "loading" ? "Verifying your server permissions." : "An active catalog administrator role is required. Contact your administrator for access."}</p><Link className="cz-btn mt-4" href="/hub">Return to Player Hub</Link></main>;
  return <div className="min-h-dvh bg-[var(--cz-void)]"><header className="border-b border-[var(--cz-hairline)] p-5"><Link href="/admin/puzzles" className="cz-display text-xl">CircZles Catalog</Link><Link href="/hub" className="float-right">Player Hub</Link></header>{pathname === "/admin" || pathname === "/admin/puzzles" ? children : <main className="p-8">This admin area is currently unavailable.</main>}</div>;
}
