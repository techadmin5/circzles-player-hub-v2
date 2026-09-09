import { loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { DrizzleGameStateRepository, GameStateService } from "./domain/gameState.js";
import { DrizzleIdentityRepository, IdentityService } from "./domain/identity.js";
import { DrizzlePuzzleRepository, PuzzleOwnershipService } from "./domain/puzzles.js";
import { DrizzleSubmissionRepository, SubmissionService } from "./domain/submissions.js";
import { buildApp } from "./http/app.js";
import { CloudinaryVideoStorage } from "./storage/videoStorage.js";
import { AdminAuthorizationService, DrizzleAdminAuthorizationRepository } from "./domain/adminAuth.js";
import { AdminSubmissionService, DrizzleAdminSubmissionRepository } from "./domain/adminSubmissions.js";
import { DrizzleLeaderboardRepository, LeaderboardService } from "./domain/leaderboards.js";
import { DrizzleSubmissionReviewRepository, SubmissionReviewService } from "./domain/submissionReviews.js";
import { DrizzlePublicProfileRepository, PublicProfileService } from "./domain/publicProfiles.js";

const env = loadEnv();
const { pool, db } = createDb(env.DATABASE_URL);
const identity = new IdentityService(new DrizzleIdentityRepository(db), env.SESSION_SECRET);
const gameState = new GameStateService(new DrizzleGameStateRepository(db));
const puzzles = new PuzzleOwnershipService(new DrizzlePuzzleRepository(db));
const videoStorage = new CloudinaryVideoStorage({ cloudName: env.CLOUDINARY_CLOUD_NAME, apiKey: env.CLOUDINARY_API_KEY, apiSecret: env.CLOUDINARY_API_SECRET });
const submissionService = new SubmissionService(new DrizzleSubmissionRepository(db), videoStorage);
const adminAuth = new AdminAuthorizationService(new DrizzleAdminAuthorizationRepository(db), env.SESSION_SECRET);
const adminSubmissions = new AdminSubmissionService(new DrizzleAdminSubmissionRepository(db));
const leaderboards = new LeaderboardService(new DrizzleLeaderboardRepository(db));
const submissionReviews = new SubmissionReviewService(new DrizzleSubmissionReviewRepository(db));
const publicProfiles = new PublicProfileService(new DrizzlePublicProfileRepository(db));
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
  checkDb: async () => {
    await pool.query("select 1");
  },
});

const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
app.log.info({ address }, "CircZles backend started");

process.on("SIGINT", async () => {
  await app.close();
  await pool.end();
  process.exit(0);
});
