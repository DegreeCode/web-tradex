"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/segmented";
import { useExchangeInfo, transferAllowed } from "@/lib/exchange-info";
import { ExchangeInfoNotice } from "@/components/exchange-policy";
import { ErrorBlock } from "@/components/primitives";
import { accountLabel, defaultAccountId as pickDefaultAccount } from "@/lib/accounts";
import { errorMessage } from "@/lib/api";
import { noteSelfAction } from "@/lib/live-notifications";
import { compareDecimal, fmtCredit, fmtPercentFromPPM, fmtQuantity, isDecimalInput, isPositiveDecimal } from "@/lib/format";
import { findPosition, useAccounts, useCreateTransfer, usePortfolio } from "@/lib/hooks";
import { useSessionAccess } from "@/components/session-access";

export function TransferDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl">
        <TransferForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function TransferForm({ onDone }: { onDone: () => void }) {
  const { data: exchangeInfo } = useExchangeInfo();
  const accountsQuery = useAccounts();
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [asset, setAsset] = useState<"CREDIT" | "STOCK">("CREDIT");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const createTransfer = useCreateTransfer();
  const transferAccess = useSessionAccess("TRANSFER");

  const accountId = selectedAccountId || pickDefaultAccount(accounts);

  const portfolio = usePortfolio(accountId || undefined, Boolean(accountId));
  const availableCredit = portfolio.data?.available_credit ?? "0";
  const canonicalSymbol = normalizeSymbol(symbol);
  const position = portfolio.data && canonicalSymbol
    ? findPosition(portfolio.data, canonicalSymbol)
    : undefined;
  const otherAccounts = accounts.filter((account) => account.account_id !== accountId);

  const sameOwner = otherAccounts.some((account) => account.account_id === recipient.trim());
  const allowed = transferAllowed(asset, sameOwner, exchangeInfo?.transfer.asset_policy);

  function submit() {
    if (!allowed) { toast.error("현재 거래소 정책상 다른 사용자에게 이 자산을 보낼 수 없어요"); return; }
    if (!recipient.trim()) {
      toast.error("받는 계좌 ID를 입력해주세요");
      return;
    }

    if (asset === "CREDIT") {
      if (!isDecimalInput(amount, 16) || !isPositiveDecimal(amount)) {
        toast.error("보낼 금액을 입력해주세요");
        return;
      }
      if (compareDecimal(amount, availableCredit) > 0) {
        toast.error("Credit 잔액이 부족해요");
        return;
      }
    } else {
      if (!/^[A-Za-z]{1,8}(?:\.M)?$/.test(symbol.trim())) {
        toast.error("심볼을 영문 1~8자 또는 .M 형식으로 입력해주세요");
        return;
      }
      if (!isDecimalInput(quantity, 8) || !isPositiveDecimal(quantity)) {
        toast.error("보낼 수량을 입력해주세요");
        return;
      }
      if (!position || compareDecimal(quantity, position.available_quantity) > 0) {
        toast.error("보유 수량이 부족해요");
        return;
      }
    }

    noteSelfAction("transfer.updated");
    createTransfer.mutate(
      {
        account_id: accountId || undefined,
        recipient_account_id: recipient.trim(),
        asset,
        ...(asset === "CREDIT"
          ? { amount: amount.trim() }
          : { symbol: canonicalSymbol, quantity: quantity.trim() }),
      },
      {
        onSuccess: (transfer) => {
          toast.success(
            transfer.status === "COMPLETED" ? "송금을 완료했어요" : "송금 요청을 보냈어요",
          );
          onDone();
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>송금하기</DialogTitle>
        <DialogDescription>
          {sameOwner ? "본인 계좌 간에는 수수료·승인 없이 바로 이동해요." : !exchangeInfo ? "송금 조건은 거래소 설정을 확인해주세요." : exchangeInfo.transfer.approval_mode === "MANUAL" ? "받는 사람의 수락과 관리자 승인이 필요해요. 완료 전, 만료 시각까지 취소할 수 있어요." : "받는 사람이 수락하면 잔액이 이동해요. 완료 전, 만료 시각까지 취소할 수 있어요."}
        </DialogDescription>
      </DialogHeader>

      <div className="mt-3 space-y-3.5">
        {exchangeInfo && !sameOwner && <div className="space-y-1 text-[12px] leading-5 text-app-gray-500">
          <p>송금 수수료 {fmtPercentFromPPM(exchangeInfo.transfer.fee_ppm, 4)} · 요청 유효기간 {exchangeInfo.transfer.expiry_hours}시간</p>
          <p>다른 사용자에게 보낼 수 있는 자산: {{ BOTH: "Credit · 주식", CREDIT_ONLY: "Credit", STOCK_ONLY: "주식", DISABLED: "외부 송금 중지" }[exchangeInfo.transfer.asset_policy]}</p>
          {asset === "STOCK" && <p>주식 송금 수수료는 곡선 기준 평가금액에 따라 Credit으로 부과돼요.</p>}
        </div>}
        <ExchangeInfoNotice />
        {accountsQuery.isLoading || (accountId && portfolio.isLoading) ? <p role="status" className="text-[13px] text-app-gray-500">계좌 정보를 불러오는 중이에요…</p> : null}
        {accountsQuery.isError ? <ErrorBlock message={errorMessage(accountsQuery.error)} onRetry={() => void accountsQuery.refetch()} /> : portfolio.isError ? <ErrorBlock message={errorMessage(portfolio.error)} onRetry={() => void portfolio.refetch()} /> : null}
        {!allowed && <p role="status" className="text-[12px] text-app-red">현재 정책에서는 이 자산을 다른 사용자에게 보낼 수 없어요. 본인 계좌 간 이동은 가능해요.</p>}
        {accounts.length > 1 ? (
          <div>
            <p id="transfer-from-label" className="mb-1.5 text-[13px] font-semibold text-app-gray-500">보내는 계좌</p>
            <div role="group" aria-labelledby="transfer-from-label" className="flex gap-2 overflow-x-auto pb-1">
              {accounts.map((account) => (
                <button
                  key={account.account_id}
                  type="button"
                  onClick={() => setSelectedAccountId(account.account_id)}
                  aria-pressed={accountId === account.account_id}
                  className={
                    accountId === account.account_id
                      ? "shrink-0 rounded-xl bg-app-blue-light px-3 py-2 text-[13px] font-semibold text-app-blue-dark"
                      : "shrink-0 rounded-xl bg-app-gray-100 px-3 py-2 text-[13px] font-semibold text-app-gray-600"
                  }
                >
                  {accountLabel(account, accounts)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <Segmented<"CREDIT" | "STOCK">
          value={asset}
          onChange={(next) => setAsset(next)}
          options={[
            { value: "CREDIT", label: "Credit" },
            { value: "STOCK", label: "주식" },
          ]}
        />

        <div className="space-y-1.5">
          <Label htmlFor="transfer-recipient">받는 계좌 ID</Label>
          <Input
            id="transfer-recipient"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="acc_..."
            autoComplete="off"
            spellCheck={false}
            className="numeric h-11 rounded-xl"
          />
          {otherAccounts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {otherAccounts.map((account) => (
                <button
                  key={account.account_id}
                  type="button"
                  onClick={() => setRecipient(account.account_id)}
                  aria-pressed={recipient === account.account_id}
                  className={recipient === account.account_id ? "min-h-9 rounded-lg bg-app-blue-light px-2.5 py-1 text-[11px] font-semibold text-app-blue-dark ring-1 ring-app-blue" : "min-h-9 rounded-lg bg-app-gray-100 px-2.5 py-1 text-[11px] font-semibold text-app-gray-600 hover:bg-app-gray-200"}
                >
                  내 {accountLabel(account, accounts)}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {asset === "CREDIT" ? (
          <div className="space-y-1.5">
            <Label htmlFor="transfer-amount">보낼 금액</Label>
            <Input
              id="transfer-amount"
              value={amount}
              onChange={(event) => {
                const next = event.target.value;
                if (next === "" || isDecimalInput(next, 16)) setAmount(next);
              }}
              inputMode="decimal"
              placeholder="0"
              className="numeric h-11 rounded-xl"
            />
            <p className="break-all text-[12px] text-app-gray-400">
              보낼 수 있는 금액 {portfolio.data ? `${fmtCredit(availableCredit, 2)} Credit` : "—"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="transfer-symbol">심볼</Label>
              <Input
                id="transfer-symbol"
                value={symbol}
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                placeholder="ABC"
                autoCapitalize="characters"
                autoComplete="off"
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="transfer-quantity">수량</Label>
              <Input
                id="transfer-quantity"
                value={quantity}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === "" || isDecimalInput(next, 8)) setQuantity(next);
                }}
                inputMode="decimal"
                placeholder="0"
                className="numeric h-11 rounded-xl"
              />
            </div>
            {canonicalSymbol && portfolio.data ? (
              <p className="col-span-2 text-[12px] text-app-gray-400">
                {position
                  ? `보낼 수 있는 수량 ${fmtQuantity(position.available_quantity)}주`
                  : `${canonicalSymbol}을 이 계좌에 보유하고 있지 않아요`}
              </p>
            ) : null}
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!transferAccess.allowed || createTransfer.isPending || !allowed || !portfolio.data || accountsQuery.isError || portfolio.isError}
          className="h-12 w-full rounded-xl bg-app-blue text-[15px] font-bold text-white hover:opacity-90 disabled:opacity-40 pressable"
        >
          {createTransfer.isPending ? "보내는 중…" : "송금하기"}
        </button>
      </div>
    </>
  );
}

function normalizeSymbol(value: string): string {
  const upper = value.trim().toUpperCase();
  return upper && !upper.endsWith(".M") ? `${upper}.M` : upper;
}
