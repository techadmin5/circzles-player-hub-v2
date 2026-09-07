import { describe, expect, it } from "vitest";
import { AppError } from "../src/domain/errors.js";
import { developmentPuzzleCatalog, parseClaimCode, PuzzleOwnershipService } from "../src/domain/puzzles.js";
import { FakePuzzleRepository } from "./fakes.js";

async function serviceWithCatalog() {
  const repo = new FakePuzzleRepository();
  const service = new PuzzleOwnershipService(repo);
  await service.seedDevelopmentCatalog(developmentPuzzleCatalog);
  return { repo, service };
}

describe("puzzle ownership", () => {
  it("normalizes codes by trimming, uppercasing, and parsing the final numeric segment", () => {
    const parsed = parseClaimCode(" cc-11-18-r1-001 ");
    expect(parsed.normalizedPrefix).toBe("CC-11-18-R1");
    expect(parsed.serialNumber).toBe(BigInt(1));
    expect(parsed.normalizedCode).toBe("CC-11-18-R1-1");
  });

  it("rejects malformed claim codes", () => {
    expect(() => parseClaimCode("CC-11-R1-ABC")).toThrow(AppError);
    expect(() => parseClaimCode("001")).toThrow(AppError);
    expect(() => parseClaimCode("CC-11-R1-0")).toThrow(AppError);
  });

  it("allows the same serial number under different puzzle prefixes", async () => {
    const { repo, service } = await serviceWithCatalog();
    await service.claimByCode("player-1", "DEV-MM-R1-001");
    await service.claimByCode("player-1", "DEV-MM-R2-001");
    expect(repo.claims).toHaveLength(2);
    expect(repo.ownerships.map((ownership) => ownership.puzzleId)).toEqual([
      "DEV-PUZZLE-METAMORPHOSIS-R1",
      "DEV-PUZZLE-METAMORPHOSIS-R2",
    ]);
  });

  it("treats leading-zero and non-leading-zero serials as the same physical unit", async () => {
    const { service } = await serviceWithCatalog();
    await service.claimByCode("player-1", "DEV-MM-R1-001");
    await expect(service.claimByCode("player-2", "DEV-MM-R1-1")).rejects.toMatchObject({ code: "PUZZLE_CODE_ALREADY_CLAIMED" });
  });

  it("does not consume a second physical code when the player already owns the puzzle variant", async () => {
    const { repo, service } = await serviceWithCatalog();
    await service.claimByCode("player-1", "DEV-MM-R1-001");
    await expect(service.claimByCode("player-1", "DEV-MM-R1-002")).rejects.toMatchObject({ code: "PUZZLE_ALREADY_OWNED" });
    expect(repo.claims).toHaveLength(1);
    expect(repo.claims[0]?.normalizedCode).toBe("DEV-MM-R1-1");
  });

  it("returns owned puzzles only for the requested player", async () => {
    const { service } = await serviceWithCatalog();
    await service.claimByCode("player-1", "DEV-MM-R1-001");
    await service.claimByCode("player-2", "DEV-MM-R2-001");
    const playerOne = await service.getOwnedPuzzles("player-1");
    expect(playerOne).toHaveLength(1);
    expect(playerOne[0]?.id).toBe("DEV-PUZZLE-METAMORPHOSIS-R1");
  });
});
