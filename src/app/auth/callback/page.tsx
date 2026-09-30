import { WixAuthorizationCallback } from "@/components/auth/WixAuthorizationCallback";
import { PublicShell } from "@/components/public/PublicShell";

export default function Page() {
  return <PublicShell><div className="mx-auto grid min-h-[70vh] max-w-md content-center px-4 py-16"><WixAuthorizationCallback /></div></PublicShell>;
}
