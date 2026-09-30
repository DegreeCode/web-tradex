import test from "node:test";
import assert from "node:assert/strict";
import { API_BASE_URL, apiAssetUrl } from "../src/lib/api";
import { safeRedirectPath } from "../src/lib/routes";

test("post-login redirects stay on this site", () => {
  assert.equal(safeRedirectPath("/market/symbol?symbol=ABC.M#trades"), "/market/symbol?symbol=ABC.M#trades");
  assert.equal(safeRedirectPath("/portfolio"), "/portfolio");
  for (const hostile of [
    null, "", "portfolio", "https://evil.example", "//evil.example", "/\\evil.example",
    "/\t/evil.example", "javascript:alert(1)", " /portfolio",
  ]) {
    assert.equal(safeRedirectPath(hostile), "/", String(hostile));
  }
});

test("asset paths only resolve against the API origin", () => {
  assert.equal(apiAssetUrl("/api/v1/market/icons/ico_1"), `${API_BASE_URL}/api/v1/market/icons/ico_1`);
  for (const hostile of [null, "", "@evil.example/x.png", "//evil.example/x.png", "/\\evil.example", "https://evil.example/x.png", "/a b"]) {
    assert.equal(apiAssetUrl(hostile), null, String(hostile));
  }
});
