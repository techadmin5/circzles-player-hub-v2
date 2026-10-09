import { PublicShell } from "@/components/public/PublicShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeAuthReturnTo } from "@/lib/authReturnTo";

export default async function Page({ searchParams }: { searchParams: Promise<{ returnTo?: string; authError?: string }> }) {
  const params = await searchParams;
  const requested = params.returnTo;
  const returnTo = safeAuthReturnTo(requested);
  return <PublicShell><div className="mx-auto grid min-h-[70vh] max-w-md content-center px-4 py-16"><span className="cz-chip mx-auto">Player access</span><h1 className="cz-display mt-4 text-center text-3xl font-bold">Enter the Player Hub</h1><p className="mt-2 text-center text-sm text-[var(--cz-text-secondary)]">One secure account for your CircZles collection, progression, rewards and verified solves.</p><LoginForm returnTo={returnTo} initialError={params.authError === "google" ? "Google login did not complete. Please try again." : undefined} /></div></PublicShell>;
}
