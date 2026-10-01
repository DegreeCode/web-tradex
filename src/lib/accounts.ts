import type { Account } from "./types";

/**
 * Display name for an account: the primary account, then the extra accounts
 * numbered in list order ("추가 계좌 2") when there is more than one.
 */
export function accountLabel(account: Pick<Account, "account_id" | "is_primary">, accounts: readonly Pick<Account, "account_id" | "is_primary">[]): string {
  if (account.is_primary) return "대표 계좌";
  const extras = accounts.filter((row) => !row.is_primary);
  if (extras.length <= 1) return "추가 계좌";
  const order = extras.findIndex((row) => row.account_id === account.account_id) + 1;
  return order > 0 ? `추가 계좌 ${order}` : "추가 계좌";
}

/** The account a form starts on: the primary one, else the first. */
export function defaultAccountId(accounts: readonly Pick<Account, "account_id" | "is_primary">[]): string {
  return accounts.find((account) => account.is_primary)?.account_id ?? accounts[0]?.account_id ?? "";
}
