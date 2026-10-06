import { NativeAuthForm } from "./NativeAuthForm";
export function SignupForm({ returnTo }: { returnTo: string }) { return <NativeAuthForm mode="signup" returnTo={returnTo} />; }
