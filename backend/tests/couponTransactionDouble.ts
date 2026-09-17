import { couponOwnerships, gameEvents, rewardDefinitions } from "../src/db/schema.js";
import type { GameStateTransaction } from "../src/domain/gameState.js";

type CouponRow = typeof couponOwnerships.$inferSelect;
type GameEventRow = typeof gameEvents.$inferSelect;
type CouponInsert = Omit<CouponRow, "couponOwnershipId" | "status" | "redeemedAt" | "revokedAt">;
type GameEventInsert = Omit<GameEventRow, "gameEventId" | "createdAt" | "processedAt">;

function limited<T>(rows: T[], count: number) {
  const selected = rows.slice(0, count);
  const result = Promise.resolve(selected) as Promise<T[]> & { for: () => Promise<T[]> };
  result.for = async () => selected;
  return result;
}

export class CouponTransactionDouble {
  couponRows: CouponRow[] = [];
  eventRows: GameEventRow[] = [];
  rewardType: "COUPON" | "FRAME" = "COUPON";
  executeCalls = 0;
  private couponSelectResults: CouponRow[][] = [];
  private couponSequence = 0;
  private eventSequence = 0;

  queueCouponSelects(...results: CouponRow[][]) {
    this.couponSelectResults.push(...results);
  }

  transaction() {
    return this as unknown as GameStateTransaction;
  }

  async execute() {
    this.executeCalls += 1;
    return [];
  }

  select() {
    return {
      from: (table: unknown) => {
        if (table === couponOwnerships) {
          const rows = this.couponSelectResults.shift() ?? [];
          return { where: () => ({ orderBy: async () => rows, limit: (count: number) => limited(rows, count) }) };
        }
        if (table === rewardDefinitions) {
          return { where: () => ({ limit: (count: number) => limited([{ rewardType: this.rewardType }], count) }) };
        }
        if (table === gameEvents) {
          return { where: () => ({ limit: (count: number) => limited(this.eventRows, count) }) };
        }
        throw new Error("Unexpected table selected by coupon production code.");
      },
    };
  }

  insert(table: unknown) {
    if (table === couponOwnerships) {
      return {
        values: (values: CouponInsert[]) => ({
          returning: async () => values.map((value) => {
            const row: CouponRow = {
              couponOwnershipId: `coupon-${++this.couponSequence}`,
              status: "ACTIVE",
              redeemedAt: null,
              revokedAt: null,
              ...value,
            };
            this.couponRows.push(row);
            return row;
          }),
        }),
      };
    }
    if (table === gameEvents) {
      return {
        values: (value: GameEventInsert) => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              const duplicate = this.eventRows.some((row) => row.playerId === value.playerId && row.idempotencyKey === value.idempotencyKey);
              if (duplicate) return [];
              const row: GameEventRow = { gameEventId: `event-${++this.eventSequence}`, createdAt: new Date("2026-09-17T12:00:00.000Z"), processedAt: null, ...value };
              this.eventRows.push(row);
              return [row];
            },
          }),
        }),
      };
    }
    throw new Error("Unexpected table inserted by coupon production code.");
  }
}
