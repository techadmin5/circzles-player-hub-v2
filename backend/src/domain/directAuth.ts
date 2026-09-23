import { AppError } from "./errors.js";
import type { VerifiedExternalIdentity } from "./identity.js";

export interface DirectSignupChallenge {
  challengeId: string;
  expiresAt?: string;
}

export interface DirectAuthProvider {
  loginWithEmail(input: { email: string; password: string }): Promise<VerifiedExternalIdentity>;
  startEmailSignup(input: { displayName: string; email: string; password: string }): Promise<DirectSignupChallenge>;
  verifyEmailSignup(input: { challengeId: string; code: string }): Promise<VerifiedExternalIdentity>;
  getGoogleAuthorizationUrl(input: { returnTo: string }): Promise<{ authorizationUrl: string }>;
  completeGoogleAuthorization(input: { code: string; state: string }): Promise<VerifiedExternalIdentity>;
}

export class UnconfiguredDirectAuthProvider implements DirectAuthProvider {
  private unavailable(): never {
    throw new AppError("DIRECT_AUTH_PROVIDER_NOT_CONFIGURED", "Direct Player Hub authentication is not configured yet.", 503);
  }

  async loginWithEmail(): Promise<VerifiedExternalIdentity> { return this.unavailable(); }
  async startEmailSignup(): Promise<DirectSignupChallenge> { return this.unavailable(); }
  async verifyEmailSignup(): Promise<VerifiedExternalIdentity> { return this.unavailable(); }
  async getGoogleAuthorizationUrl(): Promise<{ authorizationUrl: string }> { return this.unavailable(); }
  async completeGoogleAuthorization(): Promise<VerifiedExternalIdentity> { return this.unavailable(); }
}
