import { AppError, insufficientPoints } from "./errors.js";

// Representation/storage bounds, not product reward budgets.
export const PG_REWARD_INTEGER_MAX = 2147483647;
const safeXpMaximum = BigInt(Number.MAX_SAFE_INTEGER);

export function assertRewardGrantAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > PG_REWARD_INTEGER_MAX) throw new AppError("REWARD_AMOUNT_INVALID", "A grant must be a positive whole amount representable by the PostgreSQL integer ledger column.", 400);
}

export function exactSafeXpTotal(databaseText: string): number {
  if (!/^\d+$/.test(databaseText)) throw new AppError("XP_TOTAL_UNSAFE", "Stored XP requires reconciliation before a safe grant or state response.", 409);
  const exact = BigInt(databaseText);
  if (exact > safeXpMaximum) throw new AppError("XP_TOTAL_UNSAFE", "Stored XP exceeds the exact numeric API range; reconcile it without rounding.", 409);
  return Number(exact);
}

export function checkedXpGrant(total: number, amount: number): number {
  assertRewardGrantAmount(amount);
  if (!Number.isSafeInteger(total) || total < 0) throw new AppError("XP_TOTAL_UNSAFE", "Stored XP is not an exact nonnegative integer.", 409);
  const result = BigInt(total) + BigInt(amount);
  if (result > safeXpMaximum) throw new AppError("XP_TOTAL_LIMIT_EXCEEDED", "The XP grant cannot be represented exactly. No part of the transaction was awarded; review before retrying.", 409);
  return Number(result);
}

export function checkedPointChange(balance: number, amount: number, direction: "CREDIT" | "DEBIT"): number {
  assertRewardGrantAmount(amount);
  if (!Number.isSafeInteger(balance) || balance < 0 || balance > PG_REWARD_INTEGER_MAX) throw new AppError("SP_BALANCE_UNSAFE", "Stored Synapse balance is outside its integer storage range.", 409);
  const result = BigInt(balance) + (direction === "CREDIT" ? BigInt(amount) : -BigInt(amount));
  if (result < 0n) throw insufficientPoints();
  if (result > BigInt(PG_REWARD_INTEGER_MAX)) throw new AppError("SP_BALANCE_LIMIT_EXCEEDED", "The Synapse grant exceeds wallet storage capacity. No part of the transaction was awarded; review before retrying.", 409);
  return Number(result);
}
