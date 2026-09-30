"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { InstrumentList } from "@/components/instrument-list";
import { EmptyState, ErrorBlock, SkeletonRows } from "@/components/primitives";
import { Segmented } from "@/components/segmented";
import { errorMessage } from "@/lib/api";
import { useInstruments, useTickerOrder } from "@/lib/hooks";
import type { Instrument, TickerSort } from "@/lib/types";

const SORT_OPTIONS: { value: TickerSort; label: string }[] = [
  { value: "recent", label: "최근 상장" },
  { value: "popular", label: "인기순" },
  { value: "volume", label: "거래량순" },
  { value: "gainers", label: "상승률순" },
  { value: "losers", label: "하락률순" },
];

const INITIAL_VISIBLE = 25;
const VISIBLE_STEP = 25;
const MAX_VISIBLE = 100;

export default function MarketPage() {
  const instrumentsQuery = useInstruments();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TickerSort>("recent");
  const [revealState, setRevealState] = useState({ key: "recent:", count: INITIAL_VISIBLE });
  const tickerOrderQuery = useTickerOrder(sort);

  const instruments = useMemo(() => instrumentsQuery.data ?? [], [instrumentsQuery.data]);
  const instrumentsBySymbol = useMemo(
    () => new Map(instruments.map((instrument) => [instrument.symbol, instrument])),
    [instruments],
  );

  const revealKey = `${sort}:${query}`;
  const visibleCount = revealState.key === revealKey ? revealState.count : INITIAL_VISIBLE;

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const orderedSymbols = tickerOrderQuery.data ?? [];
    const rankedSymbols = new Set(orderedSymbols);
    const ordered = orderedSymbols
      .map((symbol) => instrumentsBySymbol.get(symbol))
      .filter((instrument): instrument is Instrument => Boolean(instrument));
    const unranked = instruments.filter((instrument) => !rankedSymbols.has(instrument.symbol));
    const source = ordered.length > 0 ? [...ordered, ...unranked] : instruments;
    return source.filter((instrument) => {
      if (!keyword) return true;
      return (
        instrument.name.toLowerCase().includes(keyword) ||
        instrument.symbol.toLowerCase().includes(keyword) ||
        instrument.tags.some((tag) => tag.toLowerCase().includes(keyword))
      );
    });
  }, [instruments, instrumentsBySymbol, query, tickerOrderQuery.data]);

  const visible = filtered.slice(0, Math.min(visibleCount, MAX_VISIBLE));
  const canShowMore = visibleCount < Math.min(filtered.length, MAX_VISIBLE);

  function handleShowMore() {
    if (visibleCount < Math.min(filtered.length, MAX_VISIBLE)) {
      setRevealState({
        key: revealKey,
        count: Math.min(visibleCount + VISIBLE_STEP, MAX_VISIBLE),
      });
    }
  }

  const tradingCount = instruments.filter((instrument) => instrument.state === "TRADING").length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-extrabold tracking-[-0.03em] text-app-gray-900">마켓</h1>
        <p className="mt-1 text-[13px] text-app-gray-500">
          {instrumentsQuery.isLoading ? "종목 정보를 불러오는 중이에요" : `거래중 ${tradingCount}개 · 전체 ${instruments.length}개 종목`}
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-app-gray-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="종목명, 심볼, 태그로 검색"
          className="h-12 w-full rounded-xl bg-card pr-4 pl-10 text-base md:text-[14px] text-app-gray-900 shadow-[0_1px_2px_0_rgba(25,31,40,0.03)] outline-none placeholder:text-app-gray-400 focus:ring-2 focus:ring-app-blue/30"
        />
      </div>

      <Segmented<TickerSort>
        value={sort}
        onChange={setSort}
        options={SORT_OPTIONS}
      />

      {tickerOrderQuery.isLoading ? (
        <p role="status" className="text-[12px] text-app-gray-500">정렬 순위를 불러오는 중이에요</p>
      ) : tickerOrderQuery.isError ? (
        <ErrorBlock message={errorMessage(tickerOrderQuery.error)} onRetry={() => void tickerOrderQuery.refetch()} />
      ) : null}

      {instrumentsQuery.isLoading ? (
        <SkeletonRows rows={6} />
      ) : instrumentsQuery.isError && instruments.length === 0 ? (
        <ErrorBlock
          message={errorMessage(instrumentsQuery.error)}
          onRetry={() => void instrumentsQuery.refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="조건에 맞는 종목이 없어요"
          description={query ? "다른 검색어로 시도해보세요" : "아직 상장된 종목이 없어요"}
        />
      ) : (
        <>
          <InstrumentList instruments={visible} twoColumn />
          {canShowMore ? (
            <button
              type="button"
              onClick={handleShowMore}
              className="h-11 w-full rounded-xl bg-card text-[13px] font-semibold text-app-gray-600 shadow-[0_1px_2px_0_rgba(25,31,40,0.03)] disabled:opacity-50"
            >
              더보기
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
