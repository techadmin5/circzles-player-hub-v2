import { and, eq, isNull, lte, gte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema.js";
import { manufacturingBatches, manufacturingBatchRanges, catalogVariants, playerPuzzles, puzzleClaimPrefixes, puzzleClaims, puzzleDesigns, puzzles } from "../db/schema.js";
import { AppError, validationFailed } from "./errors.js";
import { assertValidLevelId } from "./competitionSettings.js";
import { insertGameEventInTransaction } from "./gameEvents.js";

type Db = NodePgDatabase<typeof schema>;

export interface PuzzleDto {
  id: string;
  name: string;
  runCode?: string;
  pieceCount?: number;
  sizeLabel?: string;
  levelId: number;
  image: string;
  description: string;
}

export interface PlayerPuzzleDto extends PuzzleDto {
  playerPuzzleId: string;
  status: "OWNED" | "READY_TO_SOLVE" | "SUBMISSION_PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";
  personalBest?: string;
  leaderboardRank?: number;
  latestSubmissionStatus?: "DRAFT" | "UPLOADING" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "RESUBMISSION_REQUIRED";
}

export interface ClaimPuzzleResult {
  success: true;
  puzzle: PlayerPuzzleDto;
}

export interface ParsedClaimCode {
  normalizedCode: string;
  normalizedPrefix: string;
  serialNumber: bigint;
}

export interface DevelopmentPuzzleFixture {
  designLegacyWixId: string;
  designName: string;
  designDescription: string;
  designArtwork: string;
  puzzleLegacyWixId: string;
  puzzleName: string;
  runCode: string;
  pieceCount: number;
  sizeLabel: string;
  levelId: number;
  image: string;
  description: string;
  prefix: string;
}

export interface PuzzleRepository {
  getOwnedPuzzles(playerId: string): Promise<PlayerPuzzleDto[]>;
  getPuzzle(puzzleId: string): Promise<PuzzleDto | null>;
  claimByCode(playerId: string, parsed: ParsedClaimCode): Promise<PlayerPuzzleDto>;
  seedDevelopmentCatalog(fixtures: DevelopmentPuzzleFixture[]): Promise<void>;
}

export const developmentPuzzleCatalog: DevelopmentPuzzleFixture[] = [
  {
    designLegacyWixId: "DEV-DESIGN-METAMORPHOSIS",
    designName: "Metamorphosis",
    designDescription: "Temporary development design used for Phase 3C catalog and ownership testing.",
    designArtwork: "/puzzles/placeholder.svg",
    puzzleLegacyWixId: "DEV-PUZZLE-METAMORPHOSIS-R1",
    puzzleName: "Metamorphosis",
    runCode: "R1",
    pieceCount: 121,
    sizeLabel: "Standard",
    levelId: 18,
    image: "/puzzles/placeholder.svg",
    description: "Temporary development playable variant R1.",
    prefix: "DEV-MM-R1",
  },
  {
    designLegacyWixId: "DEV-DESIGN-METAMORPHOSIS",
    designName: "Metamorphosis",
    designDescription: "Temporary development design used for Phase 3C catalog and ownership testing.",
    designArtwork: "/puzzles/placeholder.svg",
    puzzleLegacyWixId: "DEV-PUZZLE-METAMORPHOSIS-R2",
    puzzleName: "Metamorphosis",
    runCode: "R2",
    pieceCount: 121,
    sizeLabel: "Standard",
    levelId: 22,
    image: "/puzzles/placeholder.svg",
    description: "Temporary development playable variant R2 with the same public-facing design name.",
    prefix: "DEV-MM-R2",
  },
];

const POSTGRES_BIGINT_MAX = BigInt("9223372036854775807");

export class PuzzleOwnershipService {
  constructor(private repo: PuzzleRepository) {}

  getOwnedPuzzles(playerId: string) {
    return this.repo.getOwnedPuzzles(playerId);
  }

  async getPuzzle(puzzleId: string) {
    const puzzle = await this.repo.getPuzzle(puzzleId);
    if (!puzzle) throw new AppError("PUZZLE_NOT_FOUND", "CircZles was not found.", 404);
    return puzzle;
  }

  async claimByCode(playerId: string, code: string): Promise<ClaimPuzzleResult> {
    const parsed = parseClaimCode(code);
    const puzzle = await this.repo.claimByCode(playerId, parsed);
    return { success: true, puzzle };
  }

  seedDevelopmentCatalog(fixtures = developmentPuzzleCatalog) {
    return this.repo.seedDevelopmentCatalog(fixtures);
  }
}

export class DrizzlePuzzleRepository implements PuzzleRepository {
  constructor(private db: Db) {}

  async getOwnedPuzzles(playerId: string): Promise<PlayerPuzzleDto[]> {
    const rows = await this.db.select({
      playerPuzzle: playerPuzzles,
      puzzle: puzzles,
    }).from(playerPuzzles)
      .innerJoin(puzzles, eq(playerPuzzles.puzzleId, puzzles.puzzleId))
      .where(and(eq(playerPuzzles.playerId, playerId), isNull(playerPuzzles.deletedAt), isNull(puzzles.deletedAt)));

    return rows.map(({ playerPuzzle, puzzle }) => toPlayerPuzzleDto(puzzle, playerPuzzle.status, playerPuzzle.playerPuzzleId));
  }

  async getPuzzle(puzzleId: string): Promise<PuzzleDto | null> {
    const rows = await this.db.select().from(puzzles).where(and(eq(puzzles.puzzleId, puzzleId), eq(puzzles.status, "ACTIVE"), isNull(puzzles.deletedAt))).limit(1);
    return rows[0] ? toPuzzleDto(rows[0]) : null;
  }

  async claimByCode(playerId: string, parsed: ParsedClaimCode): Promise<PlayerPuzzleDto> {
    try {
      return await this.db.transaction(async (tx) => {
        // Lock manufacturing identity before checking range, status and ownership.
        const [batch] = await tx.select().from(manufacturingBatches)
          .where(eq(manufacturingBatches.skuPrefix, parsed.normalizedPrefix)).for("update");
        if (!batch) throw new AppError("PUZZLE_CODE_INVALID", "CircZles SKU has no verified manufacturing batch.", 400);
        if (batch.productType !== "CIRCZLES") throw new AppError("PUZZLE_CODE_ACCESSORY", "Accessory SKUs cannot be added as CircZles.", 400);
        if (batch.status !== "ACTIVE") throw new AppError("PUZZLE_BATCH_INACTIVE", "This CircZles manufacturing batch is not active.", 400);
        const [variant] = await tx.select().from(catalogVariants).where(eq(catalogVariants.catalogVariantId, batch.catalogVariantId));
        if (!variant || variant.status !== "ACTIVE" || !variant.puzzleId || variant.puzzleId !== batch.puzzleId) throw new AppError("PUZZLE_BATCH_INACTIVE", "This CircZles is not available for claims.", 400);
        const [range] = await tx.select().from(manufacturingBatchRanges).where(and(
          eq(manufacturingBatchRanges.manufacturingBatchId, batch.manufacturingBatchId),
          lte(manufacturingBatchRanges.serialStart, parsed.serialNumber), gte(manufacturingBatchRanges.serialEnd, parsed.serialNumber))).limit(1);
        if (!range) throw new AppError("PUZZLE_SERIAL_NOT_MANUFACTURED", "This serial is outside the manufactured CircZles ranges.", 400);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${playerId + ":" + variant.puzzleId}))`);
        const prefixRows = await tx.select({
          prefix: puzzleClaimPrefixes,
          puzzle: puzzles,
        }).from(puzzleClaimPrefixes)
          .innerJoin(puzzles, eq(puzzleClaimPrefixes.puzzleId, puzzles.puzzleId))
          .where(and(
            eq(puzzleClaimPrefixes.puzzleClaimPrefixId, batch.puzzleClaimPrefixId!),
            eq(puzzles.puzzleId, variant.puzzleId),
            eq(puzzleClaimPrefixes.active, true),
            isNull(puzzleClaimPrefixes.deletedAt),
            eq(puzzles.status, "ACTIVE"),
            isNull(puzzles.deletedAt),
          ))
          .limit(1);
        const match = prefixRows[0];
        if (!match) throw new AppError("PUZZLE_CODE_INVALID", "CircZles SKU is not valid.", 400);

        const existingPhysicalClaim = await tx.select().from(puzzleClaims)
          .where(and(eq(puzzleClaims.puzzleClaimPrefixId, match.prefix.puzzleClaimPrefixId), eq(puzzleClaims.serialNumber, parsed.serialNumber)))
          .limit(1);
        if (existingPhysicalClaim[0]) throw new AppError("PUZZLE_CODE_ALREADY_CLAIMED", "CircZles SKU has already been claimed.", 409);

        const existingOwnership = await tx.select().from(playerPuzzles)
          .where(and(eq(playerPuzzles.playerId, playerId), eq(playerPuzzles.puzzleId, match.puzzle.puzzleId), isNull(playerPuzzles.deletedAt)))
          .limit(1);
        if (existingOwnership[0]) throw new AppError("PUZZLE_ALREADY_OWNED", "Player already owns this CircZles variant.", 409);

        const [claim] = await tx.insert(puzzleClaims).values({
          puzzleClaimPrefixId: match.prefix.puzzleClaimPrefixId,
          puzzleId: match.puzzle.puzzleId,
          playerId,
          serialNumber: parsed.serialNumber,
          normalizedCode: parsed.normalizedCode,
        }).returning();

        const [ownership] = await tx.insert(playerPuzzles).values({
          playerId,
          puzzleId: match.puzzle.puzzleId,
          puzzleClaimId: claim.puzzleClaimId,
          source: "CODE_CLAIM",
          status: "OWNED",
        }).returning();

        await insertGameEventInTransaction(tx, {
          playerId, eventType: "puzzle.added", sourceType: "PUZZLE_CLAIM", sourceId: claim.puzzleClaimId,
          idempotencyKey: `puzzle.added:${playerId}:${match.puzzle.puzzleId}`,
          payload: { manufacturingBatchId: batch.manufacturingBatchId, puzzleId: match.puzzle.puzzleId, levelId: Number(match.puzzle.levelId), puzzleClaimPrefixId: match.prefix.puzzleClaimPrefixId },
        });

        return toPlayerPuzzleDto(match.puzzle, ownership.status, ownership.playerPuzzleId);
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw mapClaimConstraintError(error);
    }
  }

  async seedDevelopmentCatalog(fixtures: DevelopmentPuzzleFixture[]) {
    for (const fixture of fixtures) {
      assertValidLevelId(fixture.levelId);
      const [design] = await this.db.insert(puzzleDesigns).values({
        legacyWixId: fixture.designLegacyWixId,
        name: fixture.designName,
        description: fixture.designDescription,
        artwork: fixture.designArtwork,
        status: "ACTIVE",
      }).onConflictDoUpdate({
        target: puzzleDesigns.legacyWixId,
        set: {
          name: fixture.designName,
          description: fixture.designDescription,
          artwork: fixture.designArtwork,
          status: "ACTIVE",
          updatedAt: new Date(),
          deletedAt: null,
        },
      }).returning();

      const [puzzle] = await this.db.insert(puzzles).values({
        puzzleDesignId: design.puzzleDesignId,
        legacyWixId: fixture.puzzleLegacyWixId,
        name: fixture.puzzleName,
        runCode: fixture.runCode,
        pieceCount: fixture.pieceCount,
        sizeLabel: fixture.sizeLabel,
        levelId: fixture.levelId,
        image: fixture.image,
        description: fixture.description,
        status: "ACTIVE",
      }).onConflictDoUpdate({
        target: puzzles.legacyWixId,
        set: {
          puzzleDesignId: design.puzzleDesignId,
          name: fixture.puzzleName,
          runCode: fixture.runCode,
          pieceCount: fixture.pieceCount,
          sizeLabel: fixture.sizeLabel,
          levelId: fixture.levelId,
          image: fixture.image,
          description: fixture.description,
          status: "ACTIVE",
          updatedAt: new Date(),
          deletedAt: null,
        },
      }).returning();

      const [prefix] = await this.db.insert(puzzleClaimPrefixes).values({
        puzzleId: puzzle.puzzleId,
        prefix: fixture.prefix,
        normalizedPrefix: normalizePrefix(fixture.prefix),
        active: true,
      }).onConflictDoUpdate({
        target: puzzleClaimPrefixes.normalizedPrefix,
        targetWhere: isNull(puzzleClaimPrefixes.deletedAt),
        set: {
          puzzleId: puzzle.puzzleId,
          prefix: fixture.prefix,
          active: true,
          updatedAt: new Date(),
          deletedAt: null,
        },
      }).returning();
      const [variant] = await this.db.insert(catalogVariants).values({
        puzzleDesignId: design.puzzleDesignId, puzzleId: puzzle.puzzleId, displayName: puzzle.name,
        brand: "CircZles", productType: "CIRCZLES", levelId: String(puzzle.levelId), sizeLabel: puzzle.sizeLabel,
        pieceCount: puzzle.pieceCount, image: puzzle.image, description: puzzle.description, status: "ACTIVE",
      }).onConflictDoUpdate({ target: catalogVariants.puzzleId, set: { displayName: puzzle.name, status: "ACTIVE" } }).returning();
      // Explicit demo manufacturing capacity only; never derive production ranges from legacy prefixes.
      const [batch] = await this.db.insert(manufacturingBatches).values({
        catalogVariantId: variant.catalogVariantId, puzzleId: puzzle.puzzleId, puzzleClaimPrefixId: prefix.puzzleClaimPrefixId,
        brand: "CircZles", productType: "CIRCZLES", numberIdentifier: "DEV", manufacturingCode: fixture.runCode,
        skuPrefix: normalizePrefix(fixture.prefix), serialStart: 1n, serialEnd: 1000n, unitsManufactured: 1000n, status: "ACTIVE",
      }).onConflictDoUpdate({ target: manufacturingBatches.skuPrefix, set: { status: "ACTIVE" } }).returning();
      await this.db.insert(manufacturingBatchRanges).values({ manufacturingBatchId: batch.manufacturingBatchId, serialStart: 1n, serialEnd: 1000n }).onConflictDoNothing();
    }
  }
}

export function parseClaimCode(code: string): ParsedClaimCode {
  const trimmed = code.trim().toUpperCase();
  if (trimmed.length > 200) throw validationFailed("CircZles SKU is too long.");
  const separatorIndex = trimmed.lastIndexOf("-");
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    throw validationFailed("CircZles SKU must include a prefix and numeric serial.");
  }
  const normalizedPrefix = trimmed.slice(0, separatorIndex);
  const serialText = trimmed.slice(separatorIndex + 1);
  if (!/^[A-Z0-9]+(?:-[A-Z0-9.]+)+$/.test(normalizedPrefix)) throw validationFailed("CircZles SKU prefix is malformed.");
  if (!/^\d+$/.test(serialText)) {
    throw validationFailed("CircZles SKU serial must contain digits only.");
  }
  const serialNumber = BigInt(serialText);
  if (serialNumber <= BigInt(0)) {
    throw validationFailed("CircZles SKU serial must be greater than zero.");
  }
  if (serialNumber > POSTGRES_BIGINT_MAX) {
    throw validationFailed("CircZles SKU serial exceeds the maximum supported value.");
  }
  return {
    normalizedPrefix,
    serialNumber,
    normalizedCode: `${normalizedPrefix}-${serialNumber.toString()}`,
  };
}

function normalizePrefix(prefix: string) {
  return prefix.trim().toUpperCase();
}

function toPuzzleDto(puzzle: typeof puzzles.$inferSelect): PuzzleDto {
  return {
    id: puzzle.puzzleId,
    name: puzzle.name,
    runCode: puzzle.runCode ?? undefined,
    pieceCount: puzzle.pieceCount ?? undefined,
    sizeLabel: puzzle.sizeLabel ?? undefined,
    levelId: Number(puzzle.levelId),
    image: puzzle.image ?? "/puzzles/placeholder.svg",
    description: puzzle.description ?? "",
  };
}

function toPlayerPuzzleDto(puzzle: typeof puzzles.$inferSelect, status: string, playerPuzzleId: string): PlayerPuzzleDto {
  return {
    ...toPuzzleDto(puzzle),
    playerPuzzleId,
    status: toPlayerPuzzleStatus(status),
  };
}

function toPlayerPuzzleStatus(status: string): PlayerPuzzleDto["status"] {
  if (["OWNED", "READY_TO_SOLVE", "SUBMISSION_PENDING", "APPROVED", "REJECTED", "COMPLETED"].includes(status)) {
    return status as PlayerPuzzleDto["status"];
  }
  return "OWNED";
}

function mapClaimConstraintError(error: unknown): AppError {
  let pgError = error as { code?: string; constraint?: string; cause?: unknown };
  for (let depth = 0; !pgError.code && pgError.cause && depth < 5; depth++) pgError = pgError.cause as typeof pgError;
  if (pgError.code === "23505") {
    if (pgError.constraint === "puzzle_claims_prefix_serial_unique" || pgError.constraint === "puzzle_claims_normalized_code_unique") {
      return new AppError("PUZZLE_CODE_ALREADY_CLAIMED", "CircZles SKU has already been claimed.", 409);
    }
    if (pgError.constraint === "player_puzzles_player_id_puzzle_id_active_unique") {
      return new AppError("PUZZLE_ALREADY_OWNED", "Player already owns this CircZles variant.", 409);
    }
  }
  return new AppError("PUZZLE_CLAIM_FAILED", "CircZles claim could not be completed.", 500);
}
