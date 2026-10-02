import type { LinkedPermission, SessionScope } from "./types";

/** A scope permission, or FULL for actions only a passkey session may take. */
export type SessionNeed = LinkedPermission | "FULL";

export const SESSION_DENIED: Record<SessionNeed, string> = {
  READ: "이 연결된 기기에는 조회 권한이 없어요",
  TRADE: "이 연결된 기기에는 주문 권한이 없어요",
  TRANSFER: "이 연결된 기기에는 송금 권한이 없어요",
  MARGIN: "이 연결된 기기에는 마진 권한이 없어요",
  FULL: "패스키로 로그인한 기기에서만 할 수 있어요",
};

/** A full (passkey) session, which has no scope, may do everything. */
export function sessionAllows(scope: SessionScope | null, need: SessionNeed): boolean {
  if (scope === null) return true;
  return need !== "FULL" && scope.permissions.includes(need);
}
