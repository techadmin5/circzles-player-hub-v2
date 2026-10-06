import { PublicShell } from "@/components/public/PublicShell";
import { NativeAuthForm } from "@/components/auth/NativeAuthForm";
export default function Page() { return <PublicShell><div className="mx-auto grid min-h-[70vh] max-w-md content-center px-4 py-16"><h1 className="cz-display text-center text-3xl font-bold">Set password</h1><NativeAuthForm mode="set-password" /></div></PublicShell>; }
