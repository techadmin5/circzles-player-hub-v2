import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";

export default function Page() {
  return (
    <PublicShell>
      <div className="mx-auto grid min-h-[70vh] max-w-md content-center px-4 py-16">
        <span className="cz-chip mx-auto">Join CircZles</span>
        <h1 className="cz-display mt-4 text-center text-3xl font-bold">Create Player Profile</h1>
        <p className="mt-2 text-center text-sm text-[var(--cz-text-secondary)]">Your profile is created through the CircZles / Wix member signup, keeping one identity across the ecosystem.</p>

        <div className="cz-surface mt-6 grid gap-4 p-5">
          <Link href="/hub" className="cz-btn cz-btn-primary w-full" data-testid="wix-signup">Sign up with CircZles Account<ArrowRight size={16} /></Link>
          <div className="flex items-center gap-3 text-xs text-[var(--cz-text-tertiary)]"><span className="h-px flex-1 bg-[var(--cz-hairline)]" />or with email<span className="h-px flex-1 bg-[var(--cz-hairline)]" /></div>
          <label className="grid gap-1 text-sm"><span className="text-[var(--cz-text-secondary)]">Display Name</span>
            <input aria-label="Display Name" placeholder="Smokey_OP" className="min-h-11 rounded-xl border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] px-3.5 text-sm outline-none focus:border-[var(--cz-aqua)]" /></label>
          <label className="grid gap-1 text-sm"><span className="text-[var(--cz-text-secondary)]">Email</span>
            <input type="email" aria-label="Email" placeholder="player@example.com" className="min-h-11 rounded-xl border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] px-3.5 text-sm outline-none focus:border-[var(--cz-aqua)]" /></label>
          <Link href="/hub" className="cz-btn cz-btn-ghost w-full">Create Profile</Link>
          <p className="text-center text-[0.68rem] text-[var(--cz-text-tertiary)]">Public player ID and internal ID are assigned automatically and stay immutable. Only your display name is renameable.</p>
        </div>
        <p className="mt-4 text-center text-sm text-[var(--cz-text-tertiary)]">Already have an account? <Link href="/login" className="text-[var(--cz-aqua)]">Log in</Link></p>
      </div>
    </PublicShell>
  );
}
