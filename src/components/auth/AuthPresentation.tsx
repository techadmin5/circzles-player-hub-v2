import Link from "next/link";

export type AuthMode = "login" | "signup" | "verify" | "forgot-password" | "reset-password" | "set-password";

export function AuthNotice({ message, emailSent = false }: { message: string; emailSent?: boolean }) {
  if (!message) return null;
  return <div role="status" className="grid gap-2 text-sm text-[var(--cz-text-secondary)]">
    <p>{message}</p>
    {emailSent && <p className="text-xs text-[var(--cz-text-tertiary)]">{"Didn't receive the email? Check your spam or junk folder."}</p>}
  </div>;
}

export function AuthFormNotice({ mode, message }: { mode: AuthMode; message: string }) {
  return <AuthNotice message={message} emailSent={mode === "signup" || mode === "forgot-password"} />;
}

export function PasswordSetupIntroduction() {
  return <p className="text-sm text-[var(--cz-text-secondary)]">Create a password so you can also sign in with your email address.</p>;
}

export const passwordSetupSentMessage = "For your security, we've sent a verification link to your email. Open it to finish adding your password.";

export function AuthNavigation({ mode, returnTo }: { mode: AuthMode; returnTo: string }) {
  return <>
    {mode === "login" && <Link className="text-sm text-[var(--cz-aqua)]" href="/auth/forgot-password">Forgot password?</Link>}
    <p className="text-center text-sm text-[var(--cz-text-tertiary)]">{mode === "login" ? <>New here? <Link className="text-[var(--cz-aqua)]" href={`/signup?returnTo=${encodeURIComponent(returnTo)}`}>Create an account</Link></> : <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Back to login</Link>}</p>
    {mode === "verify" && <Link className="text-sm text-[var(--cz-aqua)]" href="/signup">Request a new verification link</Link>}
  </>;
}
