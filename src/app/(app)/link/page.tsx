"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check } from "lucide-react";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { toast } from "sonner";

import { useAuth } from "@/components/auth-provider";
import { BackLink, ErrorBlock, LoadingBlock, PageHeader, SkeletonRows, Surface } from "@/components/primitives";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { accountLabel } from "@/lib/accounts";
import { ApiError, errorMessage, postData, postIdempotentData } from "@/lib/api";
import {
  DEVICE_LINK_APPROVE_OPTIONS_PATH,
  DEVICE_LINK_APPROVE_PATH,
  DEVICE_LINK_DENY_PATH,
  DEVICE_LINK_LOOKUP_PATH,
  PERMISSION_LABELS,
  PERMISSION_ORDER,
  formatMinutes,
  formatRemaining,
  idleChoices,
  normalizeUserCode,
  permissionLocked,
  permissionSummary,
  pickChoice,
  remainingSeconds,
  scopeLimits,
  togglePermission,
  ttlChoices,
  type DeviceLinkLookup,
  type DeviceLinkScopeRequest,
} from "@/lib/device-link";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { useAccounts } from "@/lib/hooks";
import type { Account, LinkedPermission } from "@/lib/types";
import { getPasskeyAssertion, webauthnErrorMessage, type CeremonyEnvelope } from "@/lib/webauthn";

const PERMISSION_HINTS: Record<LinkedPermission, string> = {
  READ: "잔고, 주문 내역, 시세를 볼 수 있어요",
  TRADE: "매수·매도 주문을 내고 취소할 수 있어요",
  TRANSFER: "다른 계좌나 사용자에게 Credit을 보낼 수 있어요",
  MARGIN: "마진 포지션을 열고 닫을 수 있어요. 주문 권한이 함께 켜져요",
};

type Outcome = { kind: "approved"; scope: DeviceLinkScopeRequest; approvedAt: number } | { kind: "denied" };

function LinkApproval() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { linkedScope } = useAuth();
  const [codeInput, setCodeInput] = useState(() => searchParams.get("code") ?? "");
  const [code, setCode] = useState<string | null>(null);
  const [lookup, setLookup] = useState<DeviceLinkLookup | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function runLookup(raw: string) {
    const normalized = normalizeUserCode(raw);
    if (!normalized) {
      toast.error("코드 8자리를 입력해주세요");
      return;
    }
    setLookingUp(true);
    try {
      const result = await postData<DeviceLinkLookup>(DEVICE_LINK_LOOKUP_PATH, { user_code: normalized });
      setCode(normalized);
      setLookup(result);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLookingUp(false);
    }
  }

  function reset() {
    setCode(null);
    setLookup(null);
    setOutcome(null);
    setCodeInput("");
  }

  function finish(next: Outcome) {
    setOutcome(next);
    void queryClient.invalidateQueries({ queryKey: ["sessions"] });
  }

  if (linkedScope) {
    return (
      <Surface>
        <p className="text-[14px] font-semibold text-app-gray-900">연결된 기기에서는 승인할 수 없어요</p>
        <p className="mt-1 text-[13px] leading-relaxed break-keep text-app-gray-500">
          패스키로 로그인한 기기에서 승인해주세요. 연결된 기기가 다른 기기를 다시 연결할 수는 없어요.
        </p>
      </Surface>
    );
  }

  if (outcome) return <OutcomeView outcome={outcome} onAgain={reset} />;

  return (
    <div className="space-y-3">
      <Surface>
        <h2 className="text-[15px] font-bold text-app-gray-900">연결 코드</h2>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void runLookup(codeInput);
          }}
        >
          <Input
            value={code ?? codeInput}
            onChange={(event) => setCodeInput(event.target.value)}
            readOnly={code !== null}
            aria-label="연결 코드"
            placeholder="XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            className="numeric h-11 flex-1 rounded-xl text-[17px] font-bold tracking-[0.12em] uppercase"
          />
          {code === null ? (
            <Button
              type="submit"
              disabled={lookingUp}
              className="h-11 rounded-xl bg-app-blue px-4 text-[14px] font-bold text-white hover:bg-app-blue-hover"
            >
              {lookingUp ? "확인 중…" : "확인"}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={reset} className="h-11 rounded-xl px-4 text-[14px]">
              다시 입력
            </Button>
          )}
        </form>
        <p className="mt-2 text-[12px] leading-relaxed break-keep text-app-gray-500">
          로그인할 기기 화면에 보이는 코드예요. 승인 주소로 열었다면 자동으로 채워져요.
        </p>
      </Surface>

      {code && lookup ? (
        <ApprovalForm key={code} code={code} lookup={lookup} onDone={finish} onExpired={reset} />
      ) : null}
    </div>
  );
}

function ApprovalForm({
  code,
  lookup,
  onDone,
  onExpired,
}: {
  code: string;
  lookup: DeviceLinkLookup;
  onDone: (outcome: Outcome) => void;
  onExpired: () => void;
}) {
  const accounts = useAccounts();
  const limits = useMemo(() => scopeLimits(lookup), [lookup]);
  const ttlOptions = useMemo(() => ttlChoices(limits), [limits]);

  const [name, setName] = useState(lookup.device_summary);
  const [permissions, setPermissions] = useState<LinkedPermission[]>(["READ"]);
  const [accountIds, setAccountIds] = useState<string[] | null>(null);
  const [bindNetwork, setBindNetwork] = useState(true);
  const [ttl, setTtl] = useState(() => pickChoice(ttlOptions, limits.default_ttl_minutes) ?? limits.max_ttl_minutes);
  const [idlePreference, setIdlePreference] = useState(limits.default_idle_minutes);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const idleOptions = idleChoices(limits, ttl);
  const idle = pickChoice(idleOptions, idlePreference);
  const remaining = remainingSeconds(lookup.expires_at, now);
  const expired = remaining === 0;

  const accountList = accounts.data ?? [];
  // Until the person changes it, the selection is the primary account.
  const selectedAccounts =
    accountIds ?? accountList.filter((account) => account.is_primary).map((account) => account.account_id);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  function toggleAccount(id: string) {
    setAccountIds(
      selectedAccounts.includes(id) ? selectedAccounts.filter((value) => value !== id) : [...selectedAccounts, id],
    );
  }

  const trimmedName = name.trim();
  const problem =
    trimmedName.length === 0
      ? "이름을 입력해주세요"
      : selectedAccounts.length === 0
        ? "계좌를 하나 이상 골라주세요"
        : idle === null
          ? "사용 시간이 너무 짧아요"
          : null;

  async function approve() {
    if (problem || idle === null) {
      if (problem) toast.error(problem);
      return;
    }
    const scope: DeviceLinkScopeRequest = {
      name: trimmedName,
      permissions,
      account_ids: selectedAccounts,
      bind_to_requester_network: bindNetwork,
      ttl_minutes: ttl,
      idle_timeout_minutes: idle,
    };
    setBusy("approve");
    try {
      const options = await postData<CeremonyEnvelope<PublicKeyCredentialRequestOptionsJSON>>(
        DEVICE_LINK_APPROVE_OPTIONS_PATH,
        { user_code: code },
      );
      const assertion = await getPasskeyAssertion(options);
      await postIdempotentData(DEVICE_LINK_APPROVE_PATH, {
        user_code: code,
        ceremony_id: assertion.ceremonyId,
        credential: assertion.credential,
        scope,
      });
      onDone({ kind: "approved", scope, approvedAt: now });
    } catch (error) {
      toast.error(error instanceof ApiError ? errorMessage(error) : webauthnErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function deny() {
    setBusy("deny");
    try {
      await postData(DEVICE_LINK_DENY_PATH, { user_code: code });
      onDone({ kind: "denied" });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Surface>
        <h2 className="text-[15px] font-bold text-app-gray-900">요청한 기기</h2>
        <dl className="mt-3 grid grid-cols-[5.5rem_1fr] gap-y-2 text-[14px]">
          <dt className="text-app-gray-500">기기</dt>
          <dd className="font-medium text-app-gray-900">{lookup.device_summary}</dd>
          <dt className="text-app-gray-500">네트워크</dt>
          <dd className="font-medium break-keep text-app-gray-900">
            이 기기와{" "}
            <span className={lookup.same_network ? "text-app-gray-900" : "text-app-blue"}>
              {lookup.same_network ? "같은 네트워크" : "다른 네트워크"}
            </span>
            에서 요청했어요
          </dd>
          <dt className="text-app-gray-500">요청 시각</dt>
          <dd className="numeric font-medium text-app-gray-900">{fmtRelative(lookup.created_at)}</dd>
          <dt className="text-app-gray-500">남은 시간</dt>
          <dd className="numeric font-medium text-app-gray-900">{expired ? "만료됨" : formatRemaining(remaining)}</dd>
        </dl>
        <div className="mt-3 flex gap-2.5 rounded-xl bg-app-orange-light px-3.5 py-3 text-[13px] leading-relaxed break-keep text-app-gray-800">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-app-orange" />
          <p>
            <strong>직접 요청한 게 아니면 거부하세요.</strong> 누군가 코드를 알려주며 승인을 부탁했다면 계정을
            빼앗으려는 시도일 수 있어요.
          </p>
        </div>
      </Surface>

      <Surface>
        <h2 className="text-[15px] font-bold text-app-gray-900">이 기기에 줄 권한</h2>

        <Field label="이름">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            aria-label="연결 이름"
            className="h-11 rounded-xl"
          />
        </Field>

        <Field label="할 수 있는 일">
          <div className="space-y-1.5">
            {PERMISSION_ORDER.map((permission) => (
              <CheckRow
                key={permission}
                checked={permissions.includes(permission)}
                locked={permissionLocked(permission, permissions)}
                onToggle={() => setPermissions((current) => togglePermission(current, permission))}
                title={PERMISSION_LABELS[permission]}
                tag={permission === "READ" ? "항상 포함" : undefined}
                description={PERMISSION_HINTS[permission]}
              />
            ))}
          </div>
        </Field>

        <Field label="계좌">
          {accounts.isLoading ? (
            <SkeletonRows rows={1} />
          ) : accounts.isError ? (
            <ErrorBlock message={errorMessage(accounts.error)} onRetry={() => void accounts.refetch()} />
          ) : (
            <div className="space-y-1.5">
              {accountList.map((account: Account) => (
                <CheckRow
                  key={account.account_id}
                  checked={selectedAccounts.includes(account.account_id)}
                  onToggle={() => toggleAccount(account.account_id)}
                  title={accountLabel(account, accountList)}
                  description={account.account_id}
                  numericDescription
                />
              ))}
            </div>
          )}
        </Field>

        <Field label="접속 위치 제한">
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-app-gray-50 px-3.5 py-3">
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold text-app-gray-900">요청한 접속 위치에서만 허용</span>
              <span className="block text-[12px] text-app-gray-500">네트워크가 바뀌면 자동으로 끊겨요.</span>
            </span>
            <Switch checked={bindNetwork} onCheckedChange={setBindNetwork} aria-label="요청한 접속 위치에서만 허용" />
          </label>
        </Field>

        <Field label="최대 사용 시간" hint="쓰고 있어도 이 시간이 지나면 끊겨요">
          <Segmented
            value={String(ttl)}
            onChange={(value) => setTtl(Number(value))}
            options={ttlOptions.map((minutes) => ({ value: String(minutes), label: formatMinutes(minutes) }))}
          />
        </Field>

        <Field label="쓰지 않으면 끊기" hint="이 시간 동안 요청이 없으면 끊겨요">
          {idleOptions.length > 0 && idle !== null ? (
            <Segmented
              value={String(idle)}
              onChange={(value) => setIdlePreference(Number(value))}
              options={idleOptions.map((minutes) => ({ value: String(minutes), label: formatMinutes(minutes) }))}
            />
          ) : (
            <p className="text-[13px] text-app-gray-500">최대 사용 시간을 더 길게 골라주세요</p>
          )}
        </Field>
      </Surface>

      <p className="rounded-xl bg-app-blue-light px-3.5 py-3 text-[13px] leading-relaxed break-keep text-app-gray-800">
        {approvalSummary({ bindNetwork, ttl, idle, permissions, accountIds: selectedAccounts, accounts: accountList })}
      </p>

      {expired ? (
        <div className="space-y-2">
          <p className="text-center text-[13px] text-app-gray-500">코드가 만료됐어요. 요청한 기기에서 새 코드를 받아주세요.</p>
          <Button type="button" variant="outline" onClick={onExpired} className="h-12 w-full rounded-xl text-[15px]">
            새 코드 입력
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void deny()}
            disabled={busy !== null}
            className="h-12 rounded-xl text-[15px] font-bold"
          >
            {busy === "deny" ? "거부 중…" : "거부"}
          </Button>
          <Button
            type="button"
            onClick={() => void approve()}
            disabled={busy !== null || problem !== null}
            className="h-12 rounded-xl bg-app-blue text-[15px] font-bold text-white hover:bg-app-blue-hover"
          >
            {busy === "approve" ? "확인 중…" : "패스키로 승인"}
          </Button>
        </div>
      )}
    </>
  );
}

function approvalSummary({
  bindNetwork,
  ttl,
  idle,
  permissions,
  accountIds,
  accounts,
}: {
  bindNetwork: boolean;
  ttl: number;
  idle: number | null;
  permissions: LinkedPermission[];
  accountIds: string[];
  accounts: Account[];
}): string {
  const target =
    accountIds.length === 1
      ? accountLabel(accounts.find((account) => account.account_id === accountIds[0]) ?? { account_id: accountIds[0], is_primary: false }, accounts)
      : `계좌 ${accountIds.length}개`;
  const where = bindNetwork ? "지금 접속 위치에서 " : "";
  const what =
    permissions.length <= 1 ? `${target}를 조회만 할 수 있어요.` : `${target}에서 ${permissionSummary(permissions)}을 할 수 있어요.`;
  const idlePart = idle === null ? "" : ` 그 사이 ${formatMinutes(idle)} 동안 쓰지 않으면 먼저 끊겨요.`;
  return `승인하면 이 기기는 ${where}${formatMinutes(ttl)} 동안 ${what}${idlePart}`;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-semibold text-app-gray-700">{label}</p>
        {hint ? <p className="text-right text-[12px] text-app-gray-500">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

function CheckRow({
  checked,
  locked = false,
  onToggle,
  title,
  tag,
  description,
  numericDescription = false,
}: {
  checked: boolean;
  locked?: boolean;
  onToggle: () => void;
  title: string;
  tag?: string;
  description: string;
  numericDescription?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-xl bg-app-gray-50 px-3.5 py-3 ${locked ? "cursor-default" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={onToggle}
        className="mt-0.5 size-[18px] shrink-0 accent-app-blue"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[14px] font-semibold text-app-gray-900">
          {title}
          {tag ? (
            <span className="rounded-md bg-app-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-app-gray-500">
              {tag}
            </span>
          ) : null}
        </span>
        <span className={`block text-[12px] break-all text-app-gray-500 ${numericDescription ? "numeric" : "break-keep"}`}>
          {description}
        </span>
      </span>
    </label>
  );
}

function OutcomeView({ outcome, onAgain }: { outcome: Outcome; onAgain: () => void }) {
  if (outcome.kind === "denied") {
    return (
      <Surface className="text-center">
        <p className="text-[17px] font-bold text-app-gray-900">요청을 거부했어요</p>
        <p className="mt-1 text-[13px] text-app-gray-500">요청한 기기는 로그인되지 않아요.</p>
        <Button type="button" variant="outline" onClick={onAgain} className="mt-5 h-11 w-full rounded-xl">
          다른 코드 입력
        </Button>
      </Surface>
    );
  }
  const { scope } = outcome;
  // The session starts when the other browser picks it up, a few seconds later.
  const expiresAt = new Date(outcome.approvedAt + scope.ttl_minutes * 60_000).toISOString();
  return (
    <div className="space-y-3">
      <Surface className="text-center">
        <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-app-blue-light">
          <Check aria-hidden="true" className="size-7 text-app-blue" strokeWidth={2.5} />
        </div>
        <p className="text-[19px] font-bold text-app-gray-900">승인했어요</p>
        <p className="mt-1 text-[13px] text-app-gray-500">요청한 기기가 곧 자동으로 로그인돼요.</p>
        <dl className="mt-5 grid grid-cols-[5.5rem_1fr] gap-y-2 border-t border-app-gray-100 pt-4 text-left text-[14px]">
          <dt className="text-app-gray-500">이름</dt>
          <dd className="font-medium text-app-gray-900">{scope.name}</dd>
          <dt className="text-app-gray-500">권한</dt>
          <dd className="font-medium text-app-gray-900">{permissionSummary(scope.permissions)}</dd>
          <dt className="text-app-gray-500">계좌</dt>
          <dd className="font-medium text-app-gray-900">{scope.account_ids.length}개</dd>
          <dt className="text-app-gray-500">접속 위치</dt>
          <dd className="font-medium text-app-gray-900">{scope.bind_to_requester_network ? "요청한 위치로 제한" : "제한 없음"}</dd>
          <dt className="text-app-gray-500">끊기는 때</dt>
          <dd className="numeric font-medium break-keep text-app-gray-900">
            {fmtDateTime(expiresAt)}, 또는 {formatMinutes(scope.idle_timeout_minutes)} 미사용 시
          </dd>
        </dl>
      </Surface>
      <p className="text-center text-[13px] text-app-gray-500">
        연결된 기기는 보안 메뉴의 세션 목록에서 언제든 끊을 수 있어요.
      </p>
      <Link
        href="/security"
        prefetch={false}
        className="flex h-12 items-center justify-center rounded-xl bg-card text-[15px] font-bold text-app-gray-800 shadow-raised"
      >
        보안 메뉴로 가기
      </Link>
    </div>
  );
}

export default function LinkPage() {
  return (
    <div className="mx-auto max-w-[560px] space-y-4">
      <PageHeader
        title="기기 연결 승인"
        subtitle="패스키를 쓸 수 없는 기기를 이 기기의 승인으로 로그인시켜요"
        back={<BackLink href="/security" label="보안으로" />}
      />
      <Suspense fallback={<LoadingBlock />}>
        <LinkApproval />
      </Suspense>
    </div>
  );
}
