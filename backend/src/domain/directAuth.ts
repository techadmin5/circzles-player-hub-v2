import { AppError } from "./errors.js";
import type { VerifiedExternalIdentity } from "./identity.js";

export interface DirectSignupChallenge {
  challengeId: string;
  expiresAt?: string;
}

export type CaptchaType = "RECAPTCHA" | "INVISIBLE_RECAPTCHA";

export interface DirectAuthRedirect {
  authorizationUrl: string;
}

export interface DirectEmailVerificationChallenge extends DirectSignupChallenge {
  state: "EMAIL_VERIFICATION_REQUIRED";
}

export type DirectEmailLoginResult = DirectAuthRedirect | DirectEmailVerificationChallenge;
export type DirectEmailSignupResult = DirectAuthRedirect | DirectEmailVerificationChallenge;

export interface CompletedDirectAuthorization {
  identity: VerifiedExternalIdentity;
  returnTo: string;
}

export interface DirectAuthProvider {
  loginWithEmail(input: { email: string; password: string; captchaToken?: string; captchaType?: CaptchaType; returnTo: string }): Promise<DirectEmailLoginResult>;
  startEmailSignup(input: { displayName: string; email: string; password: string; captchaToken?: string; captchaType?: CaptchaType; returnTo: string }): Promise<DirectEmailSignupResult>;
  verifyEmailSignup(input: { challengeId: string; code: string; returnTo: string }): Promise<DirectAuthRedirect>;
  getGoogleAuthorizationUrl(input: { returnTo: string }): Promise<{ authorizationUrl: string }>;
  completeAuthorization(input: { code: string; state: string }): Promise<CompletedDirectAuthorization>;
}

export class UnconfiguredDirectAuthProvider implements DirectAuthProvider {
  private unavailable(): never {
    throw new AppError("DIRECT_AUTH_PROVIDER_NOT_CONFIGURED", "Direct Player Hub authentication is not configured yet.", 503);
  }

  async loginWithEmail(): Promise<DirectEmailLoginResult> { return this.unavailable(); }
  async startEmailSignup(): Promise<DirectEmailSignupResult> { return this.unavailable(); }
  async verifyEmailSignup(): Promise<DirectAuthRedirect> { return this.unavailable(); }
  async getGoogleAuthorizationUrl(): Promise<{ authorizationUrl: string }> { return this.unavailable(); }
  async completeAuthorization(): Promise<CompletedDirectAuthorization> { return this.unavailable(); }
}
