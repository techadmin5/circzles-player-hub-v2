import { PublicShell } from "@/components/public/PublicShell";
import { LoginForm } from "@/components/auth/LoginForm";

export default async function Page({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const requested = (await searchParams).returnTo;
  const returnTo = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/hub";
  return <PublicShell><div className="mx-auto grid min-h-[70vh] max-w-md content-center px-4 py-16"><span className="cz-chip mx-auto">Player access</span><h1 className="cz-display mt-4 text-center text-3xl font-bold">Enter the Player Hub</h1><p className="mt-2 text-center text-sm text-[var(--cz-text-secondary)]">One secure account for CircZles progression, rewards, puzzles and verified solves.</p><LoginForm returnTo={returnTo} /></div></PublicShell>;
}
