"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { request } from "@/lib/apiClient";
import { catalogAdmin } from "@/lib/catalogAdmin";
import { usePlayerUiState } from "@/stores/playerUiState";

export function CatalogAdminBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reviewArea = pathname === "/admin/submissions";
  const missionArea = pathname === "/admin/missions";
  const area = missionArea ? "missions" : reviewArea ? "review" : "catalog";
  const generation = usePlayerUiState(state => state.sessionVersion);
  const [authorization, setAccess] = useState<{ generation: number; area: string; status: "loading" | "allowed" | "denied" }>({ generation, area, status: "loading" });
  const access = authorization.generation === generation && authorization.area === area ? authorization.status : "loading";
  useEffect(() => {
    const controller = new AbortController();
    (missionArea ? request<{ allowed: boolean }>("/api/admin/missions/access", { signal: controller.signal }) : reviewArea ? request<{ allowed: boolean }>("/api/admin/submissions/access", { signal: controller.signal }) : catalogAdmin.access(controller.signal)).then(result => { if (!controller.signal.aborted) setAccess({ generation, area, status: result.allowed ? "allowed" : "denied" }); }).catch(() => { if (!controller.signal.aborted) setAccess({ generation, area, status: "denied" }); });
    return () => controller.abort();
  }, [generation, reviewArea, missionArea, area]);
  if (access !== "allowed") return <main className="mx-auto max-w-xl p-8"><h1 className="cz-display text-2xl">{access === "loading" ? "Checking admin access…" : "Admin access unavailable"}</h1><p className="mt-3">{access === "loading" ? "Verifying your server permissions." : "An active administrator role with permission for this area is required. Contact your administrator for access."}</p><Link className="cz-btn mt-4" href="/hub">Return to Player Hub</Link></main>;
  return <div className="min-h-dvh bg-[var(--cz-void)]"><header className="border-b border-[var(--cz-hairline)] p-5"><Link href="/admin/puzzles" className="cz-display text-xl">CircZles Catalog</Link><Link href="/admin/submissions" className="ml-5">Submission Review</Link><Link href="/admin/missions" className="ml-5">Missions</Link><Link href="/hub" className="float-right">Player Hub</Link></header>{pathname === "/admin" || pathname === "/admin/puzzles" || reviewArea || missionArea ? children : <main className="p-8">This admin area is currently unavailable.</main>}</div>;
}
