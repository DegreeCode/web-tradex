import { RELEASE_STAGE } from "@/lib/release";

/**
 * The TradeX wordmark plus the release-stage badge. Size, weight and link come
 * from the wrapping element; the badge scales with its font size.
 */
export function BrandLogo() {
  return (
    <>
      Trade<span className="text-app-blue">X</span>
      {RELEASE_STAGE ? (
        <span className="ml-[0.35em] inline-block rounded-[0.35em] bg-app-blue-light px-[0.45em] py-[0.2em] align-[0.35em] text-[0.42em] leading-none font-bold tracking-normal text-app-blue">
          {RELEASE_STAGE}
        </span>
      ) : null}
    </>
  );
}
