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
  it("accepts serial 1", () => {
    const parsed = parseClaimCode("CC-11-18-R1-1");
    expect(parsed.serialNumber).toBe(BigInt(1));
  });

  it("accepts a normal large valid serial without converting to Number", () => {
    const parsed = parseClaimCode("CC-11-18-R1-987654321012345");
    expect(parsed.serialNumber).toBe(BigInt("987654321012345"));
  });

  it("accepts PostgreSQL signed bigint max serial", () => {
    const parsed = parseClaimCode("CC-11-18-R1-9223372036854775807");
    expect(parsed.serialNumber).toBe(BigInt("9223372036854775807"));
  });

  it("rejects serial values above PostgreSQL signed bigint max", () => {
    expect(() => parseClaimCode("CC-11-18-R1-9223372036854775808")).toThrow(AppError);
    expect(() => parseClaimCode("CC-11-18-R1-999999999999999999999999999999999999999999999999999999999")).toThrow(AppError);
  });

  it("normalizes codes by trimming, uppercasing, and parsing the final numeric segment", () => {
    const parsed = parseClaimCode(" cc-11-18-r1-001 ");
    expect(parsed.normalizedPrefix).toBe("CC-11-18-R1");
    expect(parsed.serialNumber).toBe(BigInt(1));
    expect(parsed.normalizedCode).toBe("CC-11-18-R1-1");
  });

  it("returns PUZZLE_CODE_INVALID for unknown prefixes", async () => {
    const { service } = await serviceWithCatalog();
    await expect(service.claimByCode("player-1", "UNKNOWN-R1-001")).rejects.toMatchObject({ code: "PUZZLE_CODE_INVALID" });
  });

  it("returns PUZZLE_CODE_INVALID for inactive prefixes", async () => {
    const { repo, service } = await serviceWithCatalog();
    const prefix = repo.prefixes.get("DEV-MM-R1");
    if (!prefix) throw new Error("missing fake prefix");
    prefix.active = false;
    await expect(service.claimByCode("player-1", "DEV-MM-R1-001")).rejects.toMatchObject({ code: "PUZZLE_CODE_INVALID" });
  });

  it("returns PUZZLE_CODE_INVALID for inactive puzzles during claim", async () => {
    const { repo, service } = await serviceWithCatalog();
    const puzzle = repo.puzzles.get("DEV-PUZZLE-METAMORPHOSIS-R1");
    if (!puzzle) throw new Error("missing fake puzzle");
    puzzle.active = false;
    await expect(service.claimByCode("player-1", "DEV-MM-R1-001")).rejects.toMatchObject({ code: "PUZZLE_CODE_INVALID" });
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

  it("keeps same-name R1 and R2 variants as different puzzle ids", async () => {
    const { service } = await serviceWithCatalog();
    const r1 = await service.claimByCode("player-1", "DEV-MM-R1-001");
    const r2 = await service.claimByCode("player-1", "DEV-MM-R2-001");
    expect(r1.puzzle.name).toBe(r2.puzzle.name);
    expect(r1.puzzle.id).not.toBe(r2.puzzle.id);
    expect(r1.puzzle.runCode).toBe("R1");
    expect(r2.puzzle.runCode).toBe("R2");
  });

  it("treats leading-zero and non-leading-zero serials as the same physical unit", async () => {
    const { service } = await serviceWithCatalog();
    await service.claimByCode("player-1", "DEV-MM-R1-001");
    await expect(service.claimByCode("player-2", "DEV-MM-R1-1")).rejects.toMatchObject({ code: "PUZZLE_CODE_ALREADY_CLAIMED" });
  });

  it("prevents two players from claiming the same prefix and serial", async () => {
    const { repo, service } = await serviceWithCatalog();
    await service.claimByCode("player-1", "DEV-MM-R1-777");
    await expect(service.claimByCode("player-2", "DEV-MM-R1-777")).rejects.toMatchObject({ code: "PUZZLE_CODE_ALREADY_CLAIMED" });
    expect(repo.claims).toHaveLength(1);
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

  it("returns an active puzzle by id", async () => {
    const { service } = await serviceWithCatalog();
    const puzzle = await service.getPuzzle("DEV-PUZZLE-METAMORPHOSIS-R1");
    expect(puzzle.id).toBe("DEV-PUZZLE-METAMORPHOSIS-R1");
    expect(puzzle.runCode).toBe("R1");
  });

  it("returns 404 for unknown puzzle ids", async () => {
    const { service } = await serviceWithCatalog();
    await expect(service.getPuzzle("missing")).rejects.toMatchObject({ code: "PUZZLE_NOT_FOUND", statusCode: 404 });
  });

  it("does not return inactive puzzles from public getPuzzle", async () => {
    const { repo, service } = await serviceWithCatalog();
    const puzzle = repo.puzzles.get("DEV-PUZZLE-METAMORPHOSIS-R1");
    if (!puzzle) throw new Error("missing fake puzzle");
    puzzle.active = false;
    await expect(service.getPuzzle("DEV-PUZZLE-METAMORPHOSIS-R1")).rejects.toMatchObject({ code: "PUZZLE_NOT_FOUND", statusCode: 404 });
  });
});
