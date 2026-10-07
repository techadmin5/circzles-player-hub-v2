import { loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { DrizzleGameStateRepository, GameStateService } from "./domain/gameState.js";
import { DrizzleIdentityRepository, IdentityService } from "./domain/identity.js";
import { DrizzlePuzzleRepository, PuzzleOwnershipService } from "./domain/puzzles.js";
import { DrizzleSubmissionRepository, SubmissionService } from "./domain/submissions.js";
import { buildApp } from "./http/app.js";
import { CloudinaryVideoStorage } from "./storage/videoStorage.js";
import { CloudinaryAvatarStorage } from "./storage/avatarStorage.js";
import { PlayerProfileService } from "./domain/playerProfile.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "./domain/adminAuth.js";
import { AdminSubmissionService, DrizzleAdminSubmissionRepository } from "./domain/adminSubmissions.js";
import { DrizzleLeaderboardRepository, LeaderboardService } from "./domain/leaderboards.js";
import { DrizzleSubmissionReviewRepository, SubmissionReviewService } from "./domain/submissionReviews.js";
import { DrizzlePublicProfileRepository, PublicProfileService } from "./domain/publicProfiles.js";
import { DrizzleMissionClaimRepository, DrizzleMissionRepository, MissionClaimService, MissionEventProcessor, MissionProcessorRunner, PlayerMissionService } from "./domain/missions.js";
import { DrizzleRewardCatalogRepository, RewardCatalogService } from "./domain/rewardCatalog.js";
import { DrizzleStorePurchaseRepository, StorePurchaseService } from "./domain/storePurchases.js";
import { DrizzleInventoryRepository, InventoryService } from "./domain/inventory.js";
import { DrizzlePlayerIdentityActionRepository, PlayerIdentityActionService } from "./domain/playerIdentityActions.js";
import { DrizzleRewardWheelRepository, RewardWheelService } from "./domain/rewardWheel.js";
import { CouponService, DrizzleCouponRepository } from "./domain/coupons.js";
import { CouponRedemptionSyncService, DrizzleCouponRedemptionSyncRepository } from "./domain/couponRedemptionSync.js";
import { DrizzleCouponMappingSyncRepository, WixCouponSyncService } from "./domain/wixCouponSync.js";
import { DrizzleShopifyCouponMappingSyncRepository, ShopifyCouponSyncService } from "./domain/shopifyCouponSync.js";
import { WixCouponGateway } from "./integrations/wix/wixCouponGateway.js";
import { ShopifyCouponGateway } from "./integrations/shopify/shopifyCouponGateway.js";
import { WixCouponAppliedWebhook } from "./integrations/wix/wixWebhook.js";
import { ShopifyOrdersPaidWebhook } from "./integrations/shopify/shopifyWebhook.js";
import { ProviderCouponRedemptionWebhookHandler } from "./integrations/couponRedemptionWebhooks.js";
import { AuthHandoffVerifier } from "./domain/authHandoff.js";
import { NativeAuthService } from "./domain/nativeAuth.js";
import { DrizzleNativeAuthRepository } from "./domain/nativeAuthRepository.js";
import { GoogleAuthService } from "./domain/googleAuth.js";
import { DevelopmentAuthMailer, ResendAuthMailer } from "./domain/authEmail.js";

const env = loadEnv();
const { pool, db } = createDb(env.DATABASE_URL, (error) => {
  console.error("Unexpected PostgreSQL client error; broken client removed from pool", error);
});
const identity = new IdentityService(new DrizzleIdentityRepository(db), env.SESSION_SECRET);
const authHandoff = new AuthHandoffVerifier({
  circzlesCom: env.AUTH_HANDOFF_CIRCZLES_COM_SECRET,
  circzlesIn: env.AUTH_HANDOFF_CIRCZLES_IN_SECRET,
});
const nativeRepo = new DrizzleNativeAuthRepository(db);
const mailer = env.AUTH_EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY && env.AUTH_EMAIL_FROM
  ? new ResendAuthMailer(env.RESEND_API_KEY, env.AUTH_EMAIL_FROM, env.FRONTEND_ORIGIN)
  : new DevelopmentAuthMailer();
const nativeAuth = new NativeAuthService(nativeRepo, mailer);
const googleAuth = new GoogleAuthService(nativeRepo, env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_AUTH_CALLBACK_URL
  ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, callbackUrl: env.GOOGLE_AUTH_CALLBACK_URL } : null);
const gameState = new GameStateService(new DrizzleGameStateRepository(db));
const puzzles = new PuzzleOwnershipService(new DrizzlePuzzleRepository(db));
const videoStorage = new CloudinaryVideoStorage({ cloudName: env.CLOUDINARY_CLOUD_NAME, apiKey: env.CLOUDINARY_API_KEY, apiSecret: env.CLOUDINARY_API_SECRET });
const submissionService = new SubmissionService(new DrizzleSubmissionRepository(db), videoStorage);
const adminAuth = new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(db), env.SESSION_SECRET);
const adminSubmissions = new AdminSubmissionService(new DrizzleAdminSubmissionRepository(db));
const leaderboards = new LeaderboardService(new DrizzleLeaderboardRepository(db));
const submissionReviews = new SubmissionReviewService(new DrizzleSubmissionReviewRepository(db));
const publicProfiles = new PublicProfileService(new DrizzlePublicProfileRepository(db));
const missionRepository = new DrizzleMissionRepository(db);
const missions = new PlayerMissionService(missionRepository);
const missionProcessor = new MissionEventProcessor(missionRepository);
const missionClaims = new MissionClaimService(new DrizzleMissionClaimRepository(db));
const rewardCatalog = new RewardCatalogService(new DrizzleRewardCatalogRepository(db));
const storePurchases = new StorePurchaseService(new DrizzleStorePurchaseRepository(db));
const inventory = new InventoryService(new DrizzleInventoryRepository(db));
const playerProfile = new PlayerProfileService(db, new CloudinaryAvatarStorage({ cloudName: env.CLOUDINARY_CLOUD_NAME, apiKey: env.CLOUDINARY_API_KEY, apiSecret: env.CLOUDINARY_API_SECRET }));
const coupons = new CouponService(new DrizzleCouponRepository(db));
const playerIdentityActions = new PlayerIdentityActionService(new DrizzlePlayerIdentityActionRepository(db));
const rewardWheel = new RewardWheelService(new DrizzleRewardWheelRepository(db));
const wixCouponSync = new WixCouponSyncService(new WixCouponGateway(), new DrizzleCouponMappingSyncRepository(db));
const shopifyCouponSync = new ShopifyCouponSyncService(new ShopifyCouponGateway(), new DrizzleShopifyCouponMappingSyncRepository(db));
const couponRedemptionSync = new CouponRedemptionSyncService(
  new DrizzleCouponRedemptionSyncRepository(db),
  wixCouponSync,
  shopifyCouponSync,
);
const couponRedemptionWebhooks = new ProviderCouponRedemptionWebhookHandler(
  new WixCouponAppliedWebhook([
    { appId: env.WIX_CIRCZLES_IN_APP_ID ?? "", publicKey: env.WIX_CIRCZLES_IN_WEBHOOK_PUBLIC_KEY, instanceId: env.WIX_CIRCZLES_IN_INSTANCE_ID, storefrontTarget: "WIX_CIRCZLES_IN" },
    { appId: env.WIX_APP_ID ?? "", publicKey: env.WIX_WEBHOOK_PUBLIC_KEY, instanceId: env.WIX_CIRCZLES_COM_INSTANCE_ID, storefrontTarget: "WIX_CIRCZLES_COM" },
    { appId: env.WIX_APP_ID ?? "", publicKey: env.WIX_WEBHOOK_PUBLIC_KEY, instanceId: env.WIX_COGZART_IN_INSTANCE_ID, storefrontTarget: "WIX_COGZART_IN" },
    { appId: env.WIX_APP_ID ?? "", publicKey: env.WIX_WEBHOOK_PUBLIC_KEY, instanceId: env.WIX_COGZART_COM_INSTANCE_ID, storefrontTarget: "WIX_COGZART_COM" },
  ]),
  new ShopifyOrdersPaidWebhook({ clientSecret: env.SHOPIFY_CLIENT_SECRET, shopDomain: env.SHOPIFY_SHOP_DOMAIN }),
  couponRedemptionSync,
);
const app = buildApp({
  env,
  identity,
  gameState,
  puzzles,
  submissions: submissionService,
  adminAuth,
  adminSubmissions,
  leaderboards,
  submissionReviews,
  publicProfiles,
  missions,
  missionClaims,
  rewardCatalog,
  storePurchases,
  inventory,
  playerProfile,
  coupons,
  playerIdentityActions,
  rewardWheel,
  couponRedemptionWebhooks,
  authHandoff,
  nativeAuth,
  googleAuth,
  checkDb: async () => {
    await pool.query("select 1");
  },
});

const missionRunner = new MissionProcessorRunner(missionProcessor, env.MISSION_PROCESSOR_INTERVAL_MS, env.MISSION_PROCESSOR_BATCH_SIZE, (error) => app.log.error(error, "Mission processor tick failed"));
app.addHook("onClose", async () => missionRunner.stop());
const authCleanup = setInterval(() => {
  nativeRepo.pruneExpired().catch(() => app.log.warn("Expired authentication record cleanup failed"));
}, 60 * 60_000);
authCleanup.unref();
app.addHook("onClose", async () => { clearInterval(authCleanup); });

const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
missionRunner.start();
app.log.info({ address }, "CircZles backend started");

process.on("SIGINT", async () => {
  await app.close();
  await pool.end();
  process.exit(0);
});
