import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../src/domain/errors.js";
import { GameStateService, temporaryDevelopmentProgressionLevels } from "../src/domain/gameState.js";
import { SubmissionReviewService, type SubmissionReviewInput, type SubmissionReviewRepository, type SubmissionReviewResult } from "../src/domain/submissionReviews.js";
import { FakeGameStateRepository } from "./fakes.js";
import type { GameEventInput } from "../src/domain/gameEvents.js";

interface TestSubmission { submissionId: string; playerId: string; puzzleId: string; status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "RESUBMISSION_REQUIRED"; completionTimeMs?: number; submittedAt?: string }
interface TestSetting { active: boolean; rewardEnabled: boolean; synapseReward: number; xpReward: number }
interface TestReview { id: string; reviewerAdminUserId: string; submissionId: string; decision: SubmissionReviewInput["decision"]; reviewNote?: string; idempotencyKey: string }
interface TestGrant { id: string; playerId: string; puzzleId: string; submissionId: string; rewardEnabledSnapshot: boolean; synapseReward: number; xpReward: number; pointTransactionId?: string; xpTransactionId?: string }
interface TestPb { playerId: string; puzzleId: string; submissionId: string; completionTimeMs: number; approvedAt: string; submittedAt: string }

class InMemorySubmissionReviewRepository implements SubmissionReviewRepository {
  submissions = new Map<string, TestSubmission>();
  settings = new Map<string, TestSetting>();
  reviews: TestReview[] = [];
  grants: TestGrant[] = [];
  pbs = new Map<string, TestPb>();
  events: GameEventInput[] = [];
  failAfterRewards = false;
  private sequence: Promise<void> = Promise.resolve();

  constructor(public gameRepo: FakeGameStateRepository) {}

  review(input: SubmissionReviewInput): Promise<SubmissionReviewResult> {
    const operation = this.sequence.then(() => this.reviewAtomically(input));
    this.sequence = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async reviewAtomically(input: SubmissionReviewInput): Promise<SubmissionReviewResult> {
    const snapshot = this.snapshot();
    try {
      const submission = this.submissions.get(input.submissionId);
      if (!submission) throw new AppError("SUBMISSION_NOT_FOUND", "Submission was not found.", 404);
      const existing = this.reviews.find((review) => review.reviewerAdminUserId === input.reviewerAdminUserId && review.idempotencyKey === input.idempotencyKey);
      if (existing) {
        if (existing.submissionId !== input.submissionId || existing.decision !== input.decision || existing.reviewNote !== input.reviewNote) throw new AppError("IDEMPOTENCY_CONFLICT", "Review payload differs.", 409);
        return this.result(existing, true);
      }
      if (submission.status !== "PENDING_REVIEW") throw new AppError("SUBMISSION_ALREADY_REVIEWED", "Submission has already been reviewed.", 409);
      const review = { id: `review-${this.reviews.length + 1}`, ...input };
      this.reviews.push(review);
      submission.status = input.decision;
      const reviewEventType = input.decision === "APPROVED" ? "submission.approved" : input.decision === "REJECTED" ? "submission.rejected" : "submission.resubmission_required";
      this.events.push({ playerId: submission.playerId, eventType: reviewEventType, sourceType: "SUBMISSION_REVIEW", sourceId: review.id, idempotencyKey: `${reviewEventType}:${submission.submissionId}`, payload: { submissionId: submission.submissionId, puzzleId: submission.puzzleId, decision: input.decision } });

      if (input.decision === "APPROVED" && !this.grants.some((grant) => grant.playerId === submission.playerId && grant.puzzleId === submission.puzzleId)) {
        const setting = this.settings.get(submission.puzzleId);
        const enabled = setting?.active === true && setting.rewardEnabled;
        const grant: TestGrant = {
          id: `grant-${this.grants.length + 1}`,
          playerId: submission.playerId,
          puzzleId: submission.puzzleId,
          submissionId: submission.submissionId,
          rewardEnabledSnapshot: enabled,
          synapseReward: enabled ? setting.synapseReward : 0,
          xpReward: enabled ? setting.xpReward : 0,
        };
        this.grants.push(grant);
        const gameState = new GameStateService(this.gameRepo);
        if (grant.synapseReward > 0) grant.pointTransactionId = (await gameState.creditPoints({ playerId: submission.playerId, amount: grant.synapseReward, reason: "First approved puzzle completion", sourceType: "submission.first_completion", sourceId: submission.submissionId, idempotencyKey: `submission:first-completion:${submission.playerId}:${submission.puzzleId}:sp` })).transactionId;
        if (grant.xpReward > 0) grant.xpTransactionId = (await gameState.grantXp({ playerId: submission.playerId, amount: grant.xpReward, reason: "First approved puzzle completion", sourceType: "submission.first_completion", sourceId: submission.submissionId, idempotencyKey: `submission:first-completion:${submission.playerId}:${submission.puzzleId}:xp` })).transactionId;
      }
      if (input.decision === "APPROVED") {
        const candidate: TestPb = { playerId: submission.playerId, puzzleId: submission.puzzleId, submissionId: submission.submissionId, completionTimeMs: submission.completionTimeMs ?? 200_000, approvedAt: `2026-09-08T00:00:${String(this.reviews.length).padStart(2, "0")}.000Z`, submittedAt: submission.submittedAt ?? "2026-09-07T00:00:00.000Z" };
        const key = `${submission.playerId}:${submission.puzzleId}`;
        const existingPb = this.pbs.get(key);
        if (!existingPb || comparePb(candidate, existingPb) < 0) {
          this.pbs.set(key, candidate);
          this.events.push({ playerId: submission.playerId, eventType: "personal_best.improved", sourceType: "SUBMISSION", sourceId: submission.submissionId, idempotencyKey: `personal_best.improved:${submission.submissionId}`, payload: { submissionId: submission.submissionId, puzzleId: submission.puzzleId, previousBestTimeMs: existingPb?.completionTimeMs ?? null, newBestTimeMs: candidate.completionTimeMs } });
        }
      }
      if (this.failAfterRewards) throw new Error("simulated transaction failure");
      return this.result(review, false);
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  private result(review: TestReview, idempotent: boolean): SubmissionReviewResult {
    const grant = this.grants.find((item) => item.submissionId === review.submissionId);
    return {
      submissionReviewId: review.id,
      submissionId: review.submissionId,
      decision: review.decision,
      reviewNote: review.reviewNote,
      reviewedAt: "2026-09-08T00:00:00.000Z",
      idempotent,
      firstCompletionProcessed: Boolean(grant),
      rewardGrant: grant ? { submissionRewardGrantId: grant.id, rewardEnabledSnapshot: grant.rewardEnabledSnapshot, synapseReward: grant.synapseReward, xpReward: grant.xpReward, pointTransactionId: grant.pointTransactionId, xpTransactionId: grant.xpTransactionId } : undefined,
    };
  }

  private snapshot() {
    return {
      submissions: structuredClone(this.submissions), reviews: structuredClone(this.reviews), grants: structuredClone(this.grants), pbs: structuredClone(this.pbs), events: structuredClone(this.events),
      states: structuredClone(this.gameRepo.states), wallets: structuredClone(this.gameRepo.wallets), xp: structuredClone(this.gameRepo.xpTransactions), points: structuredClone(this.gameRepo.pointTransactions), gameEvents: structuredClone(this.gameRepo.gameEvents),
    };
  }

  private restore(snapshot: ReturnType<InMemorySubmissionReviewRepository["snapshot"]>) {
    this.submissions = snapshot.submissions; this.reviews = snapshot.reviews; this.grants = snapshot.grants; this.pbs = snapshot.pbs; this.events = snapshot.events;
    this.gameRepo.states = snapshot.states; this.gameRepo.wallets = snapshot.wallets; this.gameRepo.xpTransactions = snapshot.xp; this.gameRepo.pointTransactions = snapshot.points; this.gameRepo.gameEvents = snapshot.gameEvents;
  }
}

function comparePb(a: TestPb, b: TestPb) {
  return a.completionTimeMs - b.completionTimeMs || a.approvedAt.localeCompare(b.approvedAt) || a.submittedAt.localeCompare(b.submittedAt) || a.submissionId.localeCompare(b.submissionId);
}

const reviewer = "admin-1";
const approve = (submissionId: string, idempotencyKey = `approve-${submissionId}`): SubmissionReviewInput => ({ reviewerAdminUserId: reviewer, submissionId, decision: "APPROVED", reviewNote: "Clear solve.", idempotencyKey });

describe("submission review decision engine", () => {
  let gameRepo: FakeGameStateRepository;
  let repo: InMemorySubmissionReviewRepository;
  let service: SubmissionReviewService;

  beforeEach(async () => {
    gameRepo = new FakeGameStateRepository();
    await gameRepo.seedProgressionLevels(temporaryDevelopmentProgressionLevels);
    repo = new InMemorySubmissionReviewRepository(gameRepo);
    repo.submissions.set("submission-1", { submissionId: "submission-1", playerId: "player-1", puzzleId: "puzzle-1", status: "PENDING_REVIEW" });
    repo.settings.set("puzzle-1", { active: true, rewardEnabled: true, synapseReward: 300, xpReward: 8000 });
    service = new SubmissionReviewService(repo);
  });

  it("atomically approves a rewarded first completion and recalculates progression", async () => {
    const result = await service.review(approve("submission-1"));
    expect(repo.submissions.get("submission-1")?.status).toBe("APPROVED");
    expect(repo.reviews).toHaveLength(1); expect(repo.grants).toHaveLength(1);
    expect(result.rewardGrant).toMatchObject({ rewardEnabledSnapshot: true, synapseReward: 300, xpReward: 8000 });
    expect(gameRepo.wallets.get("player-1")).toBe(300);
    expect(gameRepo.states.get("player-1")).toMatchObject({ totalXp: 8000, progressionLevel: 15, rankName: "Knight" });
    expect(repo.pbs.get("player-1:puzzle-1")?.submissionId).toBe("submission-1");
  });

  it("approves a later solve for the same player and canonical puzzle without another reward", async () => {
    await service.review(approve("submission-1"));
    repo.submissions.set("submission-2", { submissionId: "submission-2", playerId: "player-1", puzzleId: "puzzle-1", status: "PENDING_REVIEW" });
    const result = await service.review(approve("submission-2"));
    expect(result.firstCompletionProcessed).toBe(false); expect(repo.reviews).toHaveLength(2); expect(repo.grants).toHaveLength(1);
    expect(gameRepo.pointTransactions).toHaveLength(1); expect(gameRepo.xpTransactions).toHaveLength(1);
  });

  it("rewards the same player independently for a different canonical puzzle", async () => {
    await service.review(approve("submission-1"));
    repo.submissions.set("submission-2", { submissionId: "submission-2", playerId: "player-1", puzzleId: "puzzle-2", status: "PENDING_REVIEW" });
    repo.settings.set("puzzle-2", { active: true, rewardEnabled: true, synapseReward: 50, xpReward: 100 });
    await service.review(approve("submission-2"));
    expect(repo.grants).toHaveLength(2); expect(gameRepo.wallets.get("player-1")).toBe(350); expect(gameRepo.states.get("player-1")?.totalXp).toBe(8100);
  });

  it.each([
    ["disabled", { active: true, rewardEnabled: false, synapseReward: 300, xpReward: 400 }],
    ["inactive", { active: false, rewardEnabled: true, synapseReward: 300, xpReward: 400 }],
    ["missing", undefined],
  ] as const)("freezes a disabled zero reward snapshot when settings are %s", async (_name, setting) => {
    if (setting) repo.settings.set("puzzle-1", setting); else repo.settings.delete("puzzle-1");
    const result = await service.review(approve("submission-1"));
    expect(result.rewardGrant).toMatchObject({ rewardEnabledSnapshot: false, synapseReward: 0, xpReward: 0 });
    expect(gameRepo.pointTransactions).toHaveLength(0); expect(gameRepo.xpTransactions).toHaveLength(0); expect(repo.pbs).toHaveLength(1);
  });

  it.each([[0, 500, 0, 1], [250, 0, 1, 0]])("skips zero ledgers for SP %i and XP %i", async (sp, xp, pointCount, xpCount) => {
    repo.settings.set("puzzle-1", { active: true, rewardEnabled: true, synapseReward: sp, xpReward: xp });
    await service.review(approve("submission-1"));
    expect(gameRepo.pointTransactions).toHaveLength(pointCount); expect(gameRepo.xpTransactions).toHaveLength(xpCount);
  });

  it.each(["REJECTED", "RESUBMISSION_REQUIRED"] as const)("records %s without reward processing", async (decision) => {
    await service.review({ ...approve("submission-1"), decision, idempotencyKey: decision });
    expect(repo.submissions.get("submission-1")?.status).toBe(decision); expect(repo.reviews).toHaveLength(1); expect(repo.grants).toHaveLength(0); expect(repo.pbs).toHaveLength(0);
    expect(repo.events.map((event) => event.eventType)).toEqual([decision === "REJECTED" ? "submission.rejected" : "submission.resubmission_required"]);
  });

  it("returns an exact idempotent replay without duplicates", async () => {
    const first = await service.review(approve("submission-1", "same-key"));
    const replay = await service.review(approve("submission-1", "same-key"));
    expect(replay).toMatchObject({ submissionReviewId: first.submissionReviewId, idempotent: true });
    expect(repo.reviews).toHaveLength(1); expect(repo.grants).toHaveLength(1); expect(gameRepo.xpTransactions).toHaveLength(1);
    expect(repo.events.filter((event) => event.eventType === "submission.approved")).toHaveLength(1);
    expect(repo.events.filter((event) => event.eventType === "personal_best.improved")).toHaveLength(1);
  });

  it("rejects mismatched idempotency reuse", async () => {
    await service.review(approve("submission-1", "same-key"));
    await expect(service.review({ ...approve("submission-1", "same-key"), reviewNote: "Different" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("rejects a new decision for an already-reviewed submission", async () => {
    await service.review(approve("submission-1"));
    await expect(service.review({ ...approve("submission-1", "reject-key"), decision: "REJECTED" })).rejects.toMatchObject({ code: "SUBMISSION_ALREADY_REVIEWED" });
  });

  it("serializes concurrent first-completion approvals without double granting", async () => {
    repo.submissions.set("submission-2", { submissionId: "submission-2", playerId: "player-1", puzzleId: "puzzle-1", status: "PENDING_REVIEW" });
    await Promise.all([service.review(approve("submission-1")), service.review(approve("submission-2"))]);
    expect(repo.reviews).toHaveLength(2); expect(repo.grants).toHaveLength(1); expect(repo.pbs).toHaveLength(1); expect(gameRepo.pointTransactions).toHaveLength(1); expect(gameRepo.xpTransactions).toHaveLength(1);
  });

  it("leaves the actual fastest PB after concurrent fast and slow approvals", async () => {
    repo.submissions.get("submission-1")!.completionTimeMs = 220_000;
    repo.submissions.set("submission-2", { submissionId: "submission-2", playerId: "player-1", puzzleId: "puzzle-1", status: "PENDING_REVIEW", completionTimeMs: 180_000 });
    await Promise.all([service.review(approve("submission-1")), service.review(approve("submission-2"))]);
    expect(repo.pbs.get("player-1:puzzle-1")).toMatchObject({ submissionId: "submission-2", completionTimeMs: 180_000 });
  });

  it("rolls back review, status, grant, ledgers, and caches after a partial failure", async () => {
    repo.failAfterRewards = true;
    await expect(service.review(approve("submission-1"))).rejects.toThrow("simulated transaction failure");
    expect(repo.submissions.get("submission-1")?.status).toBe("PENDING_REVIEW");
    expect(repo.reviews).toHaveLength(0); expect(repo.grants).toHaveLength(0); expect(gameRepo.pointTransactions).toHaveLength(0); expect(gameRepo.xpTransactions).toHaveLength(0);
    expect(gameRepo.wallets.has("player-1")).toBe(false); expect(gameRepo.states.has("player-1")).toBe(false);
    expect(repo.pbs).toHaveLength(0);
    expect(repo.events).toHaveLength(0); expect(gameRepo.gameEvents).toHaveLength(0);
  });

  it("replaces a PB with a faster later approval but grants no second reward", async () => {
    repo.submissions.get("submission-1")!.completionTimeMs = 200_000;
    await service.review(approve("submission-1"));
    repo.submissions.set("submission-2", { submissionId: "submission-2", playerId: "player-1", puzzleId: "puzzle-1", status: "PENDING_REVIEW", completionTimeMs: 185_000 });
    await service.review(approve("submission-2"));
    expect(repo.pbs.get("player-1:puzzle-1")?.submissionId).toBe("submission-2"); expect(repo.grants).toHaveLength(1);
    expect(repo.events.filter((event) => event.eventType === "personal_best.improved")).toHaveLength(2);
  });

  it("keeps the PB for a slower or equal-time later approval", async () => {
    repo.submissions.get("submission-1")!.completionTimeMs = 185_000;
    await service.review(approve("submission-1"));
    for (const [id, time] of [["submission-2", 200_000], ["submission-3", 185_000]] as const) {
      repo.submissions.set(id, { submissionId: id, playerId: "player-1", puzzleId: "puzzle-1", status: "PENDING_REVIEW", completionTimeMs: time });
      await service.review(approve(id));
    }
    expect(repo.pbs.get("player-1:puzzle-1")?.submissionId).toBe("submission-1");
    expect(repo.events.filter((event) => event.eventType === "personal_best.improved")).toHaveLength(1);
  });

  it("stores independent PBs by canonical player and puzzle identity", async () => {
    await service.review(approve("submission-1"));
    repo.submissions.set("submission-2", { submissionId: "submission-2", playerId: "player-1", puzzleId: "puzzle-2", status: "PENDING_REVIEW" });
    repo.submissions.set("submission-3", { submissionId: "submission-3", playerId: "player-2", puzzleId: "puzzle-1", status: "PENDING_REVIEW" });
    await service.review(approve("submission-2")); await service.review(approve("submission-3"));
    expect(repo.pbs).toHaveLength(3);
  });

  it("captures PB history when reward or leaderboard configuration is absent", async () => {
    repo.settings.delete("puzzle-1");
    await service.review(approve("submission-1"));
    expect(repo.pbs).toHaveLength(1); expect(repo.grants[0]).toMatchObject({ rewardEnabledSnapshot: false });
    repo.settings.set("puzzle-1", { active: false, rewardEnabled: false, synapseReward: 0, xpReward: 0 });
    expect(repo.pbs.get("player-1:puzzle-1")?.submissionId).toBe("submission-1");
  });

  it("requires a non-empty idempotency key", async () => {
    expect(() => service.review({ ...approve("submission-1"), idempotencyKey: " " })).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });
});
