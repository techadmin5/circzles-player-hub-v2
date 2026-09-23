import { PublicShell } from "@/components/public/PublicShell";
import { HandoffExchange } from "@/components/auth/HandoffExchange";

export default function Page() {
  return <PublicShell><div className="mx-auto grid min-h-[70vh] max-w-md content-center px-4 py-16"><HandoffExchange /></div></PublicShell>;
}
