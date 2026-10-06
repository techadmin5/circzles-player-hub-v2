import { NativeAuthForm } from "./NativeAuthForm";
export function LoginForm({ returnTo, initialError }: { returnTo: string; initialError?: string }) { return <NativeAuthForm mode="login" returnTo={returnTo} initialError={initialError} />; }

export function authMessage(error: unknown) { return error instanceof Error ? error.message : "Authentication could not complete."; }
