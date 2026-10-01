export const FONT_ORIGIN = "https://cdn.jsdelivr.net";

// The unminified file is served as stored in the tagged release; jsDelivr's
// .min.css is generated on the fly, so its bytes (and hash) are not stable.
export const FONT_STYLESHEET = {
  href: `${FONT_ORIGIN}/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css`,
  integrity: "sha384-2nNKoOPayicGa+aRguOQuiZP+RqQ4G3jalfDeOgftkKD7zBM2gJXTwcFqCZltdv0",
};
