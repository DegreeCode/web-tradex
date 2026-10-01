import { compareDecimal } from "./format";
import type { Instrument } from "./types";

const UNSIGNED_DECIMAL = /^\d+(?:\.\d+)?$/;

/** A real quote: instruments show "0" until their first ticker arrives. */
export function isQuotedPrice(price: string | null | undefined): price is string {
  return typeof price === "string" && UNSIGNED_DECIMAL.test(price) && compareDecimal(price, "0") !== 0;
}

/** The curve spot price sits exactly on the band's upper bound (상한가). */
export function isAtCurveCeiling(instrument: Pick<Instrument, "curve_spot_price" | "curve_ceiling_price">): boolean {
  const ceiling = instrument.curve_ceiling_price;
  return (
    isQuotedPrice(instrument.curve_spot_price) &&
    typeof ceiling === "string" &&
    UNSIGNED_DECIMAL.test(ceiling) &&
    compareDecimal(instrument.curve_spot_price, ceiling) === 0
  );
}

/** The last execution differs from the spot price, so it is worth showing. */
export function hasDistinctLastTrade(instrument: Pick<Instrument, "last_price" | "curve_spot_price">): boolean {
  return (
    isQuotedPrice(instrument.last_price) &&
    UNSIGNED_DECIMAL.test(instrument.curve_spot_price) &&
    compareDecimal(instrument.last_price, instrument.curve_spot_price) !== 0
  );
}
