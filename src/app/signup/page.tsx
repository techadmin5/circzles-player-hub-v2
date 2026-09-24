import { PublicShell } from "@/components/public/PublicShell";
import { SignupForm } from "@/components/auth/SignupForm";

export default function Page() {
  return <PublicShell><div className="mx-auto grid min-h-[70vh] max-w-md content-center px-4 py-16"><span className="cz-chip mx-auto">Join CircZles</span><h1 className="cz-display mt-4 text-center text-3xl font-bold">Create Player Profile</h1><p className="mt-2 text-center text-sm text-[var(--cz-text-secondary)]">Sign up once through the canonical CircZles identity provider. Your game progress remains attached to one internal Player Hub identity.</p><SignupForm /></div></PublicShell>;
}
