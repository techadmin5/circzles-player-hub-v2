import { describe, expect, it, vi } from "vitest";
import { MissionEventProcessor, MissionProcessorRunner, conditionsMatch, isMissionVisibleAt, missionMatchesEvent, periodKeyFor, validateMissionDefinition, validateMissionRule, type MissionEventProcessorRepository, type MissionPeriodType } from "../src/domain/missions.js";

type Definition = { missionId: string; category: string; periodType: MissionPeriodType; active: boolean; startsAt: Date | null; endsAt: Date | null; displayOrder: number };
type Rule = { eventType: string; targetCount: number; sourceType: string | null; puzzleId: string | null; levelId: number | null; conditions: Record<string, unknown>; active: boolean };
type Event = { id: string; playerId: string; eventType: string; sourceType: string; payload: Record<string, unknown>; createdAt: Date; processed: boolean };

class EvaluatorHarness implements MissionEventProcessorRepository {
  definitions: Array<{ mission: Definition; rule: Rule }> = [];
  events: Event[] = [];
  progress = new Map<string, { current: number; target: number; status: string }>();
  completedEvents: string[] = [];
  fail = false;
  async processBatch(size: number) {
    let count = 0;
    for (const event of this.events.filter((item) => !item.processed).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).slice(0, size)) {
      if (this.fail) throw new Error("failed");
      for (const { mission, rule } of this.definitions) {
        if (!mission.active || !rule.active || !missionMatchesEvent(event, mission, rule as never)) continue;
        const period = periodKeyFor(mission.periodType, event.createdAt, mission.missionId);
        const key = `${event.playerId}:${mission.missionId}:${period}`;
        const current = this.progress.get(key) ?? { current: 0, target: rule.targetCount, status: "IN_PROGRESS" };
        const before = current.current;
        current.current = Math.min(current.target, current.current + 1);
        if (before < current.target && current.current === current.target) {
          current.status = "CLAIMABLE";
          this.completedEvents.push(`mission.completed:${key}`);
        }
        this.progress.set(key, current);
      }
      event.processed = true; count += 1;
    }
    return count;
  }
}

const mission = (overrides: Partial<Definition> = {}): Definition => ({ missionId: "mission-1", category: "DAILY", periodType: "DAILY", active: true, startsAt: null, endsAt: null, displayOrder: 0, ...overrides });
const rule = (overrides: Partial<Rule> = {}): Rule => ({ eventType: "submission.approved", targetCount: 2, sourceType: null, puzzleId: null, levelId: null, conditions: {}, active: true, ...overrides });
const event = (id: string, at: string, overrides: Partial<Event> = {}): Event => ({ id, playerId: "player-1", eventType: "submission.approved", sourceType: "SUBMISSION_REVIEW", payload: { puzzleId: "puzzle-1", levelId: 3.5, decision: "APPROVED" }, createdAt: new Date(at), processed: false, ...overrides });

describe("mission configuration and period keys", () => {
  it.each(["DAILY", "WEEKLY", "LIFETIME", "FIXED"] as const)("accepts %s period type", (periodType) => expect(() => validateMissionDefinition(mission({ periodType }))).not.toThrow());
  it("rejects unsupported categories and periods", () => {
    expect(() => validateMissionDefinition({ ...mission(), category: "NOPE" })).toThrow();
    expect(() => validateMissionDefinition({ ...mission(), periodType: "NOPE" as MissionPeriodType })).toThrow();
  });
  it("requires positive targets and safe scalar conditions", () => {
    expect(() => validateMissionRule(rule({ targetCount: 0 }))).toThrow();
    expect(() => conditionsMatch({ nested: { unsafe: true } }, {})).toThrow();
    expect(conditionsMatch({ decision: "APPROVED", levelId: 3.5 }, { decision: "APPROVED", levelId: 3.5 })).toBe(true);
  });
  it("creates deterministic UTC daily, ISO weekly, lifetime, and fixed keys", () => {
    const at = new Date("2026-09-09T23:30:00-05:00");
    expect(periodKeyFor("DAILY", at, "m1")).toBe("2026-09-10");
    expect(periodKeyFor("WEEKLY", new Date("2026-09-09T00:00:00Z"), "m1")).toBe("2026-W37");
    expect(periodKeyFor("LIFETIME", at, "m1")).toBe("lifetime");
    expect(periodKeyFor("FIXED", at, "m1")).toBe("fixed:m1");
  });
  it("excludes future, expired, and inactive missions from current reads", () => {
    const now = new Date("2026-09-09T12:00:00Z");
    expect(isMissionVisibleAt({ active: true, startsAt: null, endsAt: null }, now)).toBe(true);
    expect(isMissionVisibleAt({ active: true, startsAt: null, endsAt: new Date("2026-09-09T12:00:00Z") }, now)).toBe(false);
    expect(isMissionVisibleAt({ active: true, startsAt: new Date("2026-09-10T00:00:00Z"), endsAt: null }, now)).toBe(false);
    expect(isMissionVisibleAt({ active: false, startsAt: null, endsAt: null }, now)).toBe(false);
  });
});

describe("mission event evaluator", () => {
  async function run(definitions: EvaluatorHarness["definitions"], events: Event[]) { const repo = new EvaluatorHarness(); repo.definitions = definitions; repo.events = events; await new MissionEventProcessor(repo).processBatch(50); return repo; }
  it("increments matching progress, caps the target, and emits completion once", async () => {
    const repo = await run([{ mission: mission(), rule: rule() }], [event("e1", "2026-09-09T01:00:00Z"), event("e2", "2026-09-09T02:00:00Z"), event("e3", "2026-09-09T03:00:00Z")]);
    expect([...repo.progress.values()][0]).toEqual({ current: 2, target: 2, status: "CLAIMABLE" }); expect(repo.completedEvents).toHaveLength(1);
  });
  it.each([
    ["unrelated", mission(), rule({ eventType: "puzzle.added" })],
    ["inactive mission", mission({ active: false }), rule()],
    ["inactive rule", mission(), rule({ active: false })],
    ["source", mission(), rule({ sourceType: "OTHER" })],
    ["puzzle", mission(), rule({ puzzleId: "puzzle-2" })],
    ["level", mission(), rule({ levelId: 4.5 })],
    ["condition", mission(), rule({ conditions: { decision: "REJECTED" } })],
  ] as const)("does not advance for %s mismatch", async (_name, definition, configuredRule) => expect((await run([{ mission: definition, rule: configuredRule }], [event("e1", "2026-09-09T01:00:00Z")])).progress.size).toBe(0));
  it("matches source, puzzle, fractional levelId, and scalar conditions", async () => expect((await run([{ mission: mission(), rule: rule({ targetCount: 1, sourceType: "SUBMISSION_REVIEW", puzzleId: "puzzle-1", levelId: 3.5, conditions: { decision: "APPROVED" } }) }], [event("e1", "2026-09-09T01:00:00Z")])).progress.size).toBe(1));
  it("uses event time for start and end eligibility", async () => {
    const window = mission({ startsAt: new Date("2026-09-09T00:00:00Z"), endsAt: new Date("2026-09-10T00:00:00Z") });
    const repo = await run([{ mission: window, rule: rule() }], [event("before", "2026-09-08T23:59:59Z"), event("inside", "2026-09-09T01:00:00Z"), event("after", "2026-09-10T00:00:00Z")]);
    expect([...repo.progress.values()][0]?.current).toBe(1); expect(repo.events.every((item) => item.processed)).toBe(true);
  });
  it("advances two eligible missions from one event", async () => expect((await run([{ mission: mission(), rule: rule() }, { mission: mission({ missionId: "mission-2" }), rule: rule() }], [event("e1", "2026-09-09T01:00:00Z")])).progress.size).toBe(2));
  it("creates separate daily and weekly periods", async () => {
    const daily = await run([{ mission: mission(), rule: rule() }], [event("e1", "2026-09-06T01:00:00Z"), event("e2", "2026-09-07T01:00:00Z")]); expect(daily.progress.size).toBe(2);
    const weekly = await run([{ mission: mission({ periodType: "WEEKLY" }), rule: rule() }], [event("e1", "2026-09-06T01:00:00Z"), event("e2", "2026-09-07T01:00:00Z")]); expect(weekly.progress.size).toBe(2);
  });
  it("keeps an existing target snapshot after rule changes", async () => {
    const repo = await run([{ mission: mission(), rule: rule({ targetCount: 3 }) }], [event("e1", "2026-09-09T01:00:00Z")]); repo.definitions[0].rule.targetCount = 9; repo.events.push(event("e2", "2026-09-09T02:00:00Z")); await repo.processBatch(1); expect([...repo.progress.values()][0].target).toBe(3);
  });
  it("marks unmatched events processed and leaves failed events pending", async () => {
    const unmatched = await run([], [event("e1", "2026-09-09T01:00:00Z")]); expect(unmatched.events[0].processed).toBe(true);
    const failed = new EvaluatorHarness(); failed.fail = true; failed.events = [event("e2", "2026-09-09T01:00:00Z")]; await expect(failed.processBatch(1)).rejects.toThrow(); expect(failed.events[0].processed).toBe(false);
  });
  it("does not replay an already processed event", async () => { const repo = await run([{ mission: mission(), rule: rule() }], [event("e1", "2026-09-09T01:00:00Z")]); await repo.processBatch(1); expect([...repo.progress.values()][0].current).toBe(1); });
});

describe("mission processor runner", () => {
  it("prevents overlapping ticks and reports errors without throwing", async () => {
    let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
    const processBatch = vi.fn(async () => { await wait; return 0; }); const errors = vi.fn();
    const runner = new MissionProcessorRunner(new MissionEventProcessor({ processBatch }), 1000, 10, errors);
    const first = runner.tick(); expect(await runner.tick()).toBe(false); release(); expect(await first).toBe(true); expect(processBatch).toHaveBeenCalledTimes(1); expect(errors).not.toHaveBeenCalled();
  });
});
