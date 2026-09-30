const formatters = new Map<number, Intl.NumberFormat>();

function formatter(maxFrac: number): Intl.NumberFormat {
  const cached = formatters.get(maxFrac);
  if (cached) return cached;
  const created = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxFrac,
    minimumFractionDigits: 0,
  });
  formatters.set(maxFrac, created);
  return created;
}

export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function fmtDecimal(value: string | number | null | undefined, maxFrac = 6): string {
  if (value === null || value === undefined || value === "") return "0";
  if (typeof value === "string" && decimalParts(value)) {
    const units = decimalToScaledInteger(value, maxFrac, true)!;
    const text = signedScaledIntegerToDecimal(units, maxFrac);
    const [integer, fraction] = text.split(".");
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return fraction ? `${grouped}.${fraction}` : grouped;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  return formatter(maxFrac).format(parsed);
}

export function fmtCredit(value: string | number | null | undefined, maxFrac = 16): string {
  return fmtDecimal(value, maxFrac);
}

export function fmtPrice(value: string | number | null | undefined): string {
  return fmtDecimal(value, 8);
}

export function fmtQuantity(value: string | number | null | undefined): string {
  return fmtDecimal(value, 8);
}

/** Returns the documented decimal precision of a price/share string (max 8). */
export function decimalPrecision(value: string | number | null | undefined, max = 8): number {
  if (value === null || value === undefined) return 0;
  const text = String(value).trim();
  const fraction = text.match(/^[+-]?\d+\.(\d+)$/)?.[1].length ?? 0;
  return Math.min(max, fraction);
}

export function fmtSigned(value: string | number | null | undefined, maxFrac = 6): string {
  const parsed = toNumber(value);
  const formatted = fmtDecimal(value, maxFrac);
  return parsed > 0 ? `+${formatted}` : formatted;
}

export function fmtCompact(value: string | number | null | undefined): string {
  const parsed = toNumber(value);
  const abs = Math.abs(parsed);
  if (abs >= 1_000_000_000_000) return `${fmtDecimal(parsed / 1_000_000_000_000, 1)}조`;
  if (abs >= 100_000_000) return `${fmtDecimal(parsed / 100_000_000, 1)}억`;
  if (abs >= 10_000) return `${fmtDecimal(parsed / 10_000, 1)}만`;
  return fmtDecimal(parsed, 2);
}

export function fmtPercentFromPPM(ppm: number | null | undefined, maxFrac = 2): string {
  if (ppm === null || ppm === undefined) return "-";
  return `${fmtDecimal(ppm / 10_000, maxFrac)}%`;
}

export function ppmFromPercent(percent: string): number {
  const scaled = decimalToScaledInteger(percent, 4, true);
  return scaled === null ? 0 : Number(scaled);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const diff = Date.now() - date.getTime();
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < 3_600_000) return `${Math.max(1, Math.floor(ahead / 60_000))}분 후`;
    if (ahead < 86_400_000) return `${Math.floor(ahead / 3_600_000)}시간 후`;
    return `${Math.floor(ahead / 86_400_000)}일 후`;
  }
  if (diff < 60_000) return "방금 전";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}일 전`;
  return fmtDate(iso);
}

export function fmtDeadline(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return "만료됨";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}분 남음`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 남음`;
  return `${Math.floor(diff / 86_400_000)}일 남음`;
}

export function shortId(id: string | null | undefined): string {
  if (!id) return "-";
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function trimDecimal(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

export function scaleDecimal(value: string, ratio: number, maxFrac = 6): string {
  const left = decimalParts(value);
  const right = decimalParts(String(ratio));
  if (!left || !right || left.negative || right.negative) return "0";
  const numerator = left.units * right.units;
  const sourceScale = left.scale + right.scale;
  return scaledIntegerToDecimal(rescaleFloor(numerator, sourceScale, maxFrac), maxFrac);
}

export function multiplyDecimal(a: string, b: string, maxFrac = 6): string {
  const left = decimalParts(a);
  const right = decimalParts(b);
  if (!left || !right) return "0";
  const negative = left.negative !== right.negative;
  const units = rescaleFloor(left.units * right.units, left.scale + right.scale, maxFrac);
  return `${negative && units !== 0n ? "-" : ""}${scaledIntegerToDecimal(units, maxFrac)}`;
}

export function divideDecimal(a: string, b: string, maxFrac = 6): string {
  const left = decimalParts(a);
  const right = decimalParts(b);
  if (!left || !right || right.units === 0n) return "0";
  const numerator = left.units * 10n ** BigInt(right.scale + maxFrac);
  const denominator = right.units * 10n ** BigInt(left.scale);
  const units = numerator / denominator;
  const negative = left.negative !== right.negative;
  return `${negative && units !== 0n ? "-" : ""}${scaledIntegerToDecimal(units, maxFrac)}`;
}

export function compareDecimal(a: string, b: string): number {
  const left = decimalParts(a);
  const right = decimalParts(b);
  if (!left || !right) return 0;
  const scale = Math.max(left.scale, right.scale);
  const leftUnits = signedUnits(left) * 10n ** BigInt(scale - left.scale);
  const rightUnits = signedUnits(right) * 10n ** BigInt(scale - right.scale);
  return leftUnits < rightUnits ? -1 : leftUnits > rightUnits ? 1 : 0;
}

/** Adds decimal strings without converting through an imprecise JS number. */
export function addDecimal(a: string, b: string): string {
  const left = decimalParts(a);
  const right = decimalParts(b);
  if (!left || !right) return "0";
  const scale = Math.max(left.scale, right.scale);
  const units =
    signedUnits(left) * 10n ** BigInt(scale - left.scale) +
    signedUnits(right) * 10n ** BigInt(scale - right.scale);
  return signedScaledIntegerToDecimal(units, scale);
}

export function isDecimalInput(value: string, maxFrac: number): boolean {
  if (value === "") return false;
  if (!/^\d*\.?\d*$/.test(value)) return false;
  const fraction = value.split(".")[1];
  return !fraction || fraction.length <= maxFrac;
}

export function isPositiveDecimal(value: string): boolean {
  const parts = decimalParts(value);
  return Boolean(parts && !parts.negative && parts.units > 0n);
}

interface DecimalParts {
  negative: boolean;
  units: bigint;
  scale: number;
}

function decimalParts(value: string): DecimalParts | null {
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!match || (!match[2] && !match[3])) return null;
  const fraction = match[3] ?? "";
  return {
    negative: match[1] === "-",
    units: BigInt(`${match[2] || "0"}${fraction}`),
    scale: fraction.length,
  };
}

function signedUnits(parts: DecimalParts): bigint {
  return parts.negative ? -parts.units : parts.units;
}

function rescaleFloor(units: bigint, sourceScale: number, targetScale: number): bigint {
  if (sourceScale === targetScale) return units;
  if (sourceScale < targetScale) return units * 10n ** BigInt(targetScale - sourceScale);
  return units / 10n ** BigInt(sourceScale - targetScale);
}

function scaledIntegerToDecimal(units: bigint, scale: number): string {
  if (scale === 0) return units.toString();
  const padded = units.toString().padStart(scale + 1, "0");
  return trimDecimal(`${padded.slice(0, -scale)}.${padded.slice(-scale)}`);
}

function signedScaledIntegerToDecimal(units: bigint, scale: number): string {
  if (units < 0n) return `-${scaledIntegerToDecimal(-units, scale)}`;
  return scaledIntegerToDecimal(units, scale);
}

function decimalToScaledInteger(value: string, scale: number, round: boolean): bigint | null {
  const parts = decimalParts(value);
  if (!parts) return null;
  let units: bigint;
  if (parts.scale <= scale) {
    units = parts.units * 10n ** BigInt(scale - parts.scale);
  } else {
    const divisor = 10n ** BigInt(parts.scale - scale);
    units = parts.units / divisor;
    if (round && parts.units % divisor >= divisor / 2n) units += 1n;
  }
  return parts.negative ? -units : units;
}

export function changePercent(from: string, to: string): number | null {
  const start = toNumber(from);
  const end = toNumber(to);
  if (start <= 0) return null;
  return ((end - start) / start) * 100;
}
