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

/** Ignore a remembered account if it is no longer available to this user. */
export function resolveAccountId(
  accounts: readonly Pick<Account, "account_id" | "is_primary">[],
  preferredId?: string,
): string {
  return accounts.find((account) => account.account_id === preferredId)?.account_id ?? defaultAccountId(accounts);
}

/** Heading where one account is shown without a picker, by its own name. */
export function singleAccountHeading(
  pending: boolean,
  account: Pick<Account, "account_id" | "is_primary"> | undefined,
  accounts: readonly Pick<Account, "account_id" | "is_primary">[],
): string {
  if (pending) return "계좌 불러오는 중…";
  return account ? accountLabel(account, accounts) : "계좌가 없어요";
}
