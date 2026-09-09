import type { IdentityRepository, PlayerDto } from "../src/domain/identity.js";
import { AppError, insufficientPoints } from "../src/domain/errors.js";
import type { GameStateRepository, PlayerGameState, PointChangeInput, ProgressionLevelConfig, XpGrantInput } from "../src/domain/gameState.js";
import { parseClaimCode, type DevelopmentPuzzleFixture, type PlayerPuzzleDto, type PuzzleDto, type PuzzleRepository } from "../src/domain/puzzles.js";
import type { SubmissionDto, SubmissionRepository, VideoUploadRecord } from "../src/domain/submissions.js";
import type { SignedVideoUpload, VerifiedVideoAsset, VideoStorage } from "../src/storage/videoStorage.js";
import type { AdminAuthorizationRepository, AdminRole } from "../src/domain/adminAuth.js";
import type { AdminSubmissionDto, AdminSubmissionFilter, AdminSubmissionRepository } from "../src/domain/adminSubmissions.js";
import type { LeaderboardCatalogDto, LeaderboardDto, LeaderboardRepository } from "../src/domain/leaderboards.js";
import type { SubmissionReviewInput, SubmissionReviewRepository, SubmissionReviewResult } from "../src/domain/submissionReviews.js";
import type { PublicPlayerProfileDto, PublicProfileRepository } from "../src/domain/publicProfiles.js";
import type { GameEventInput } from "../src/domain/gameEvents.js";
import type { MissionClaimInput, MissionClaimRepository, MissionClaimResult, MissionDto, PlayerMissionRepository } from "../src/domain/missions.js";

interface StoredAccount {
  userId: string;
  wixMemberId: string;
  player: PlayerDto;
}

export class FakeGameStateRepository implements GameStateRepository {
  public progressionLevels: ProgressionLevelConfig[] = [];
  public states = new Map<string, { progressionLevel: number; rankName: string; totalXp: number }>();
  public wallets = new Map<string, number>();
  public xpTransactions: Array<{ xpTransactionId: string; playerId: string; amount: number; sourceType: string; totalXpAfter: number; idempotencyKey?: string }> = [];
  public pointTransactions: Array<{ transactionId: string; playerId: string; amount: number; direction: "CREDIT" | "DEBIT"; sourceType: string; balanceAfter: number; idempotencyKey?: string }> = [];
  public gameEvents: GameEventInput[] = [];

  async seedProgressionLevels(levels: ProgressionLevelConfig[]) {
    for (const level of levels) {
      const existingIndex = this.progressionLevels.findIndex((item) => item.progressionLevel === level.progressionLevel);
      if (existingIndex >= 0) this.progressionLevels[existingIndex] = level;
      else this.progressionLevels.push(level);
    }
    this.progressionLevels.sort((a, b) => a.xpRequired - b.xpRequired);
  }

  async ensurePlayerGameState(playerId: string) {
    const initial = this.firstLevel();
    if (!this.states.has(playerId)) this.states.set(playerId, { progressionLevel: initial.progressionLevel, rankName: initial.rankName, totalXp: 0 });
    if (!this.wallets.has(playerId)) this.wallets.set(playerId, 0);
  }

  async getPlayerGameState(playerId: string) {
    await this.ensurePlayerGameState(playerId);
    return this.state(playerId);
  }

  async grantXp(input: XpGrantInput) {
    await this.ensurePlayerGameState(input.playerId);
    const existing = input.idempotencyKey ? this.xpTransactions.find((transaction) => transaction.playerId === input.playerId && transaction.idempotencyKey === input.idempotencyKey) : undefined;
    if (existing) {
      if (existing.amount !== input.amount || existing.sourceType !== input.sourceType) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different XP operation.", 409);
      return { transactionId: existing.xpTransactionId, idempotent: true, totalXpAfter: existing.totalXpAfter, state: await this.getPlayerGameState(input.playerId) };
    }
    const current = this.states.get(input.playerId);
    if (!current) throw new Error("missing state");
    const totalXpAfter = current.totalXp + input.amount;
    const rank = this.levelForXp(totalXpAfter);
    this.states.set(input.playerId, { progressionLevel: rank.progressionLevel, rankName: rank.rankName, totalXp: totalXpAfter });
    const transaction = { xpTransactionId: `xp-${this.xpTransactions.length + 1}`, playerId: input.playerId, amount: input.amount, sourceType: input.sourceType, totalXpAfter, idempotencyKey: input.idempotencyKey };
    this.xpTransactions.push(transaction);
    this.gameEvents.push({ playerId: input.playerId, eventType: "xp.earned", sourceType: "XP_TRANSACTION", sourceId: transaction.xpTransactionId, idempotencyKey: `xp.earned:${transaction.xpTransactionId}`, payload: { amount: input.amount } });
    for (const level of this.progressionLevels.filter((item) => item.progressionLevel > current.progressionLevel && item.progressionLevel <= rank.progressionLevel)) {
      this.gameEvents.push({ playerId: input.playerId, eventType: "progression.level_up", sourceType: "XP_TRANSACTION", sourceId: transaction.xpTransactionId, idempotencyKey: `progression.level_up:${input.playerId}:${level.progressionLevel}:${transaction.xpTransactionId}`, payload: { previousProgressionLevel: current.progressionLevel, newProgressionLevel: level.progressionLevel, rankName: level.rankName, triggerXpTransactionId: transaction.xpTransactionId } });
    }
    return { transactionId: transaction.xpTransactionId, idempotent: false, totalXpAfter, state: await this.getPlayerGameState(input.playerId) };
  }

  async creditPoints(input: PointChangeInput) {
    return this.changePoints(input, "CREDIT");
  }

  async debitPoints(input: PointChangeInput) {
    return this.changePoints(input, "DEBIT");
  }

  private async changePoints(input: PointChangeInput, direction: "CREDIT" | "DEBIT") {
    await this.ensurePlayerGameState(input.playerId);
    const existing = input.idempotencyKey ? this.pointTransactions.find((transaction) => transaction.playerId === input.playerId && transaction.idempotencyKey === input.idempotencyKey) : undefined;
    if (existing) {
      if (existing.direction !== direction || existing.amount !== input.amount || existing.sourceType !== input.sourceType) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different Synapse Point operation.", 409);
      return { transactionId: existing.transactionId, idempotent: true, balanceAfter: existing.balanceAfter };
    }
    const current = this.wallets.get(input.playerId) ?? 0;
    const balanceAfter = direction === "CREDIT" ? current + input.amount : current - input.amount;
    if (balanceAfter < 0) throw insufficientPoints();
    this.wallets.set(input.playerId, balanceAfter);
    const transaction = { transactionId: `pt-${this.pointTransactions.length + 1}`, playerId: input.playerId, amount: input.amount, direction, sourceType: input.sourceType, balanceAfter, idempotencyKey: input.idempotencyKey };
    this.pointTransactions.push(transaction);
    if (direction === "CREDIT") this.gameEvents.push({ playerId: input.playerId, eventType: "points.earned", sourceType: "POINT_TRANSACTION", sourceId: transaction.transactionId, idempotencyKey: `points.earned:${transaction.transactionId}`, payload: { amount: input.amount } });
    return { transactionId: transaction.transactionId, idempotent: false, balanceAfter };
  }

  private async state(playerId: string): Promise<PlayerGameState> {
    const state = this.states.get(playerId);
    if (!state) throw new Error("missing state");
    const next = this.progressionLevels.find((level) => level.xpRequired > state.totalXp);
    return {
      progressionLevel: state.progressionLevel,
      rankName: state.rankName,
      totalXp: state.totalXp,
      xpNeeded: next?.xpRequired ?? state.totalXp,
      synapsePoints: this.wallets.get(playerId) ?? 0,
    };
  }

  private firstLevel() {
    const level = this.progressionLevels[0];
    if (!level) throw new Error("progression levels not seeded");
    return level;
  }

  private levelForXp(totalXp: number) {
    return this.progressionLevels.reduce((current, level) => (level.xpRequired <= totalXp ? level : current), this.firstLevel());
  }
}

interface StoredSession {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export class FakeIdentityRepository implements IdentityRepository {
  public accounts: StoredAccount[] = [];
  public sessions: StoredSession[] = [];
  private next = 1;

  async findByWixMemberId(wixMemberId: string) {
    const account = this.accounts.find((item) => item.wixMemberId === wixMemberId);
    return account ? { userId: account.userId, player: account.player } : null;
  }

  async createUserPlayerAndWixLink(input: { wixMemberId: string; displayName: string; publicPlayerId?: string }) {
    const existing = await this.findByWixMemberId(input.wixMemberId);
    if (existing) return existing;
    const userId = `user-${this.next}`;
    const player: PlayerDto = {
      internalId: `player-${this.next}`,
      publicPlayerId: input.publicPlayerId ?? `CZ-TEST${this.next}`,
      displayName: input.displayName,
      avatar: "/brand/avatar.svg",
      country: "",
      state: "",
      progressionLevel: 1,
      rank: "Peasant",
      xp: 0,
      xpNeeded: 1200,
      synapsePoints: 0,
      streak: 0,
      equippedFrame: "Starter Frame",
      badgeShowcase: [],
    };
    this.next += 1;
    if (this.accounts.some((account) => account.player.publicPlayerId === player.publicPlayerId)) {
      throw new Error("duplicate public player id");
    }
    this.accounts.push({ userId, wixMemberId: input.wixMemberId, player });
    return { userId, player };
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date) {
    this.sessions.push({ userId, tokenHash, expiresAt });
  }

  async findPlayerBySession(tokenHash: string, now: Date) {
    const session = this.sessions.find((item) => item.tokenHash === tokenHash && item.expiresAt > now);
    if (!session) return null;
    return this.accounts.find((item) => item.userId === session.userId)?.player ?? null;
  }
}

export class FakeAdminAuthorizationRepository implements AdminAuthorizationRepository {
  admins = new Map<string, { adminUserId: string; role: AdminRole; active: boolean }>();
  constructor(private identity: FakeIdentityRepository) {}

  async findValidSession(tokenHash: string, now: Date) {
    const session = this.identity.sessions.find((item) => item.tokenHash === tokenHash && item.expiresAt > now);
    if (!session) return null;
    const admin = this.admins.get(session.userId);
    return { userId: session.userId, adminUserId: admin?.adminUserId ?? null, role: admin?.role ?? null, adminActive: admin?.active ?? null };
  }
}

export class FakeAdminSubmissionRepository implements AdminSubmissionRepository {
  items: AdminSubmissionDto[] = [];
  async list(filter: AdminSubmissionFilter) {
    return this.items.filter((item) => item.status === filter.status && (!filter.puzzleId || item.puzzleId === filter.puzzleId) && (filter.levelId === undefined || item.levelId === filter.levelId)).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.submissionId.localeCompare(b.submissionId)).slice(0, filter.limit);
  }
  async get(submissionId: string) { return this.items.find((item) => item.submissionId === submissionId) ?? null; }
}

export class FakeLeaderboardRepository implements LeaderboardRepository {
  catalog: LeaderboardCatalogDto = { mainLevels: [], sideQuests: [] };
  boards = new Map<string, LeaderboardDto>();
  async getCatalog() { return this.catalog; }
  async getLeaderboard(puzzleId: string) {
    const board = this.boards.get(puzzleId);
    if (!board) throw new AppError("LEADERBOARD_NOT_FOUND", "Leaderboard was not found.", 404);
    return board;
  }
}

export class FakePublicProfileRepository implements PublicProfileRepository {
  profiles = new Map<string, PublicPlayerProfileDto>();
  async findByPublicPlayerId(publicPlayerId: string) {
    return this.profiles.get(publicPlayerId) ?? null;
  }
}

export class FakePlayerMissionRepository implements PlayerMissionRepository {
  missions = new Map<string, MissionDto[]>();
  async listForPlayer(playerId: string) { return this.missions.get(playerId) ?? []; }
}

export class FakeMissionClaimRepository implements MissionClaimRepository {
  calls: MissionClaimInput[] = [];
  result?: MissionClaimResult;
  async claim(input: MissionClaimInput) {
    this.calls.push(input);
    if (!this.result) throw new AppError("MISSION_NOT_CLAIMABLE", "Mission is not claimable.", 409);
    return this.result;
  }
}

export class FakeSubmissionReviewRepository implements SubmissionReviewRepository {
  calls: SubmissionReviewInput[] = [];
  reviews = new Map<string, { input: SubmissionReviewInput; result: SubmissionReviewResult }>();
  async review(input: SubmissionReviewInput) {
    const key = `${input.reviewerAdminUserId}:${input.idempotencyKey}`;
    const existing = this.reviews.get(key);
    if (existing) {
      if (JSON.stringify(existing.input) !== JSON.stringify(input)) throw new AppError("IDEMPOTENCY_CONFLICT", "Review payload differs.", 409);
      return { ...existing.result, idempotent: true };
    }
    if ([...this.reviews.values()].some((item) => item.input.submissionId === input.submissionId)) throw new AppError("SUBMISSION_ALREADY_REVIEWED", "Submission has already been reviewed.", 409);
    this.calls.push(input);
    const result: SubmissionReviewResult = { submissionReviewId: `review-${this.calls.length}`, submissionId: input.submissionId, decision: input.decision, reviewNote: input.reviewNote, reviewedAt: "2026-09-08T00:00:00.000Z", idempotent: false, firstCompletionProcessed: input.decision === "APPROVED" };
    this.reviews.set(key, { input, result });
    return result;
  }
}

export class FakePuzzleRepository implements PuzzleRepository {
  public puzzles = new Map<string, PuzzleDto & { active: boolean }>();
  public prefixes = new Map<string, { puzzleId: string; active: boolean }>();
  public claims: Array<{ playerId: string; puzzleId: string; normalizedCode: string; normalizedPrefix: string; serialNumber: bigint }> = [];
  public ownerships: Array<{ playerPuzzleId?: string; playerId: string; puzzleId: string; status: PlayerPuzzleDto["status"] }> = [];
  public gameEvents: GameEventInput[] = [];

  async getOwnedPuzzles(playerId: string) {
    return this.ownerships
      .filter((ownership) => ownership.playerId === playerId)
      .map((ownership) => this.toPlayerPuzzle(ownership.puzzleId, ownership.status));
  }

  async getPuzzle(puzzleId: string) {
    const puzzle = this.puzzles.get(puzzleId);
    return puzzle?.active ? toPublicPuzzle(puzzle) : null;
  }

  async claimByCode(playerId: string, parsed: ReturnType<typeof parseClaimCode>) {
    const prefix = this.prefixes.get(parsed.normalizedPrefix);
    if (!prefix?.active) throw new AppError("PUZZLE_CODE_INVALID", "Puzzle code is not valid.", 400);
    const puzzleId = prefix.puzzleId;
    if (!this.puzzles.get(puzzleId)?.active) throw new AppError("PUZZLE_CODE_INVALID", "Puzzle code is not valid.", 400);
    const existingPhysical = this.claims.find((claim) => claim.normalizedPrefix === parsed.normalizedPrefix && claim.serialNumber === parsed.serialNumber);
    if (existingPhysical) throw new AppError("PUZZLE_CODE_ALREADY_CLAIMED", "Puzzle code has already been claimed.", 409);
    const existingOwnership = this.ownerships.find((ownership) => ownership.playerId === playerId && ownership.puzzleId === puzzleId);
    if (existingOwnership) throw new AppError("PUZZLE_ALREADY_OWNED", "Player already owns this puzzle variant.", 409);
    this.claims.push({ playerId, puzzleId, normalizedCode: parsed.normalizedCode, normalizedPrefix: parsed.normalizedPrefix, serialNumber: parsed.serialNumber });
    this.ownerships.push({ playerId, puzzleId, status: "OWNED" });
    this.gameEvents.push({ playerId, eventType: "puzzle.added", sourceType: "PUZZLE_CLAIM", sourceId: parsed.normalizedCode, idempotencyKey: `puzzle.added:${playerId}:${puzzleId}`, payload: { puzzleId } });
    return this.toPlayerPuzzle(puzzleId, "OWNED");
  }

  async seedDevelopmentCatalog(fixtures: DevelopmentPuzzleFixture[]) {
    for (const fixture of fixtures) {
      const id = fixture.puzzleLegacyWixId;
      this.puzzles.set(id, {
        id,
        name: fixture.puzzleName,
        runCode: fixture.runCode,
        pieceCount: fixture.pieceCount,
        sizeLabel: fixture.sizeLabel,
        levelId: fixture.levelId,
        image: fixture.image,
        description: fixture.description,
        active: true,
      });
      this.prefixes.set(parseClaimCode(`${fixture.prefix}-1`).normalizedPrefix, { puzzleId: id, active: true });
    }
  }

  private toPlayerPuzzle(puzzleId: string, status: PlayerPuzzleDto["status"]) {
    const puzzle = this.puzzles.get(puzzleId);
    if (!puzzle) throw new Error("missing fake puzzle");
    const ownership = this.ownerships.find((item) => item.puzzleId === puzzleId && item.status === status);
    return { ...toPublicPuzzle(puzzle), playerPuzzleId: ownership?.playerPuzzleId ?? `player-puzzle-${puzzleId}`, status };
  }
}

function toPublicPuzzle(puzzle: PuzzleDto & { active: boolean }): PuzzleDto {
  const { active, ...publicPuzzle } = puzzle;
  void active;
  return publicPuzzle;
}

export class FakeVideoStorage implements VideoStorage {
  configured = true;
  verificationFails = false;
  signedPublicIds: string[] = [];
  async signUpload(publicId: string): Promise<SignedVideoUpload> {
    this.signedPublicIds.push(publicId);
    return { uploadUrl: "https://example.test/video/upload", fields: { apiKey: "public-test-key", timestamp: 1, publicId, signature: "test-signature" } };
  }
  async verifyUpload(publicId: string): Promise<VerifiedVideoAsset> {
    if (this.verificationFails) throw new AppError("VIDEO_UPLOAD_VERIFICATION_FAILED", "The uploaded video could not be verified.", 422);
    return { publicId, bytes: 1024, durationMs: 12_500, resourceType: "video" };
  }
}

export class FakeSubmissionRepository implements SubmissionRepository {
  uploads = new Map<string, VideoUploadRecord & { failureCode?: string }>();
  submissions: SubmissionDto[] = [];
  gameEvents: GameEventInput[] = [];
  private nextUpload = 1;
  private nextSubmission = 1;
  constructor(private puzzles: FakePuzzleRepository) {}

  async createVideoUpload(input: { playerId: string; publicId: string; filename: string; mimeType: string; sizeBytes: number; expiresAt: Date }) {
    const videoUploadId = `10000000-0000-4000-8000-${String(this.nextUpload++).padStart(12, "0")}`;
    const record: VideoUploadRecord = { videoUploadId, playerId: input.playerId, publicId: input.publicId, mimeType: input.mimeType, declaredSizeBytes: input.sizeBytes, status: "SIGNED", expiresAt: input.expiresAt };
    this.uploads.set(videoUploadId, record);
    return record;
  }
  async getVideoUpload(videoUploadId: string) { return this.uploads.get(videoUploadId) ?? null; }
  async completeVideoUpload(videoUploadId: string) { const upload = this.uploads.get(videoUploadId); if (upload) upload.status = "COMPLETE"; }
  async failVideoUpload(videoUploadId: string, failureCode: string) { const upload = this.uploads.get(videoUploadId); if (upload) { upload.status = "FAILED"; upload.failureCode = failureCode; } }
  async expireVideoUpload(videoUploadId: string) { const upload = this.uploads.get(videoUploadId); if (upload) upload.status = "EXPIRED"; }
  async createSubmission(input: { playerId: string; playerPuzzleId: string; completionTimeMs: number; videoUploadId: string; idempotencyKey?: string }) {
    const existing = input.idempotencyKey ? this.submissions.find((item) => (item as SubmissionDto & { idempotencyKey?: string }).idempotencyKey === input.idempotencyKey && (item as SubmissionDto & { playerId?: string }).playerId === input.playerId) : undefined;
    if (existing) {
      if (existing.playerPuzzleId !== input.playerPuzzleId || existing.completionTimeMs !== input.completionTimeMs || existing.videoUploadId !== input.videoUploadId) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different submission.", 409);
      return existing;
    }
    const ownership = this.puzzles.ownerships.find((item) => item.playerId === input.playerId && (item.playerPuzzleId ?? `player-puzzle-${item.puzzleId}`) === input.playerPuzzleId);
    if (!ownership) throw new AppError("PLAYER_PUZZLE_NOT_FOUND", "Owned puzzle was not found.", 404);
    const upload = this.uploads.get(input.videoUploadId);
    if (!upload || upload.playerId !== input.playerId) throw new AppError("VIDEO_UPLOAD_NOT_FOUND", "Video upload was not found.", 404);
    if (upload.status !== "COMPLETE") throw new AppError("VIDEO_UPLOAD_NOT_COMPLETE", "Video upload has not been verified.", 409);
    if (this.submissions.some((item) => item.videoUploadId === input.videoUploadId)) throw new AppError("VIDEO_UPLOAD_ALREADY_USED", "Video upload has already been used for a submission.", 409);
    const puzzle = this.puzzles.puzzles.get(ownership.puzzleId);
    if (!puzzle?.active) throw new AppError("PLAYER_PUZZLE_NOT_FOUND", "Owned puzzle was not found.", 404);
    const id = `20000000-0000-4000-8000-${String(this.nextSubmission++).padStart(12, "0")}`;
    const result = { id, playerPuzzleId: input.playerPuzzleId, puzzleId: puzzle.id, puzzleName: puzzle.name, levelId: puzzle.levelId, completionTimeMs: input.completionTimeMs, completionTime: "02:41", status: "PENDING_REVIEW" as const, createdAt: new Date().toISOString(), videoUploadId: input.videoUploadId, playerId: input.playerId, idempotencyKey: input.idempotencyKey };
    this.submissions.push(result);
    this.gameEvents.push({ playerId: input.playerId, eventType: "submission.created", sourceType: "SUBMISSION", sourceId: id, idempotencyKey: `submission.created:${id}`, payload: { submissionId: id, puzzleId: puzzle.id, playerPuzzleId: input.playerPuzzleId, levelId: puzzle.levelId, completionTimeMs: input.completionTimeMs } });
    return result;
  }
  async getSubmissions(playerId: string) { return this.submissions.filter((item) => (item as SubmissionDto & { playerId?: string }).playerId === playerId); }
  async getSubmission(playerId: string, submissionId: string) { return this.submissions.find((item) => item.id === submissionId && (item as SubmissionDto & { playerId?: string }).playerId === playerId) ?? null; }
}
