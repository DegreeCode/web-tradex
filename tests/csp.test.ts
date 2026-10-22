import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/csp.mjs", import.meta.url));
const hash = (body: string) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`;

function fixture(t: test.TestContext, html = "<html><head></head><body></body></html>") {
  const cwd = mkdtempSync(join(tmpdir(), "tradex-csp-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, "out"));
  writeFileSync(join(cwd, "out/index.html"), html);
  return {
    cwd,
    run(apiBaseUrl: string | undefined = "https://api.example.invalid/v1") {
      const env = { ...process.env };
      delete env.NEXT_PUBLIC_API_BASE_URL;
      if (apiBaseUrl !== "MISSING") env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
      return spawnSync(process.execPath, [script], { cwd, env, encoding: "utf8" });
    },
    read: () => readFileSync(join(cwd, "out/index.html"), "utf8"),
  };
}

test("CSP follows the initial charset and hashes every inline script, preserving HTML bytes", (t) => {
  const hydration = 'self.__next_f.push([1,"한글<&>"]);';
  const theme = '\n(()=>{document.documentElement.className="dark"})()\n';
  const html = `<html><head><meta charset="utf-8"><script src="/_next/static/app.js">external fallback</script></head><body onclick="alert('handler')"><script>${hydration}</script><script data-label=">">${theme}</script><script>${theme}</script></body></html>`;
  const f = fixture(t, html);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const output = f.read();
  const meta = output.match(/<head><meta charset="utf-8">(<meta http-equiv="Content-Security-Policy" content="([^"]+)">)/);
  assert.ok(meta, output);
  const policy = meta[2];
  assert.ok(policy.includes(`script-src 'self' ${hash(hydration)} ${hash(theme)};`), policy);
  assert.equal(policy.split(hash(theme)).length - 1, 1);
  assert.ok(policy.includes("connect-src 'self' https://api.example.invalid wss://api.example.invalid;"));
  assert.ok(policy.includes("object-src 'none'"));
  assert.ok(policy.includes("worker-src 'self' blob:"));
  assert.ok(policy.includes("style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net"));
  assert.ok(!policy.includes("frame-ancestors"));
  assert.ok(!policy.includes("report-uri"));
  assert.ok(!policy.includes(hash("external fallback")));
  assert.ok(!policy.includes(hash("alert('handler')")));
  assert.ok(!policy.includes("'unsafe-hashes'"));
  assert.equal(output.replace(meta[1], ""), html);
});

test("a large CSP keeps the charset within 1024 bytes and precedes preload links and scripts", (t) => {
  const scripts = Array.from({ length: 30 }, (_, i) => `<script>console.log(${i})</script>`).join("");
  const html = `<html><head>\n<!-- encoding first --><meta charset='utf-8'><link rel="modulepreload" href="/app.js">${scripts}</head><body></body></html>`;
  const f = fixture(t, html);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const output = f.read();
  const charsetEnd = output.indexOf("<meta charset='utf-8'>") + "<meta charset='utf-8'>".length;
  const cspStart = output.indexOf('<meta http-equiv="Content-Security-Policy"');
  const cspEnd = output.indexOf(">", cspStart) + 1;
  assert.ok(cspEnd - cspStart > 1024);
  assert.ok(Buffer.byteLength(output.slice(0, charsetEnd)) < 1024);
  assert.equal(cspStart, charsetEnd);
  assert.ok(cspEnd <= output.indexOf('<link rel="modulepreload"'));
  assert.ok(cspEnd <= output.indexOf("<script>"));
  assert.equal(f.run().status, 0);
  assert.equal(f.read(), output);
});

test("CSP stays at the head start when the charset is not the first element", (t) => {
  const f = fixture(t, '<html><head><script>first()</script><meta charset="utf-8"></head><body></body></html>');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.read(), /<head><meta http-equiv="Content-Security-Policy" content="[^"]+"><script>/);
});

test("CSP reruns move an old leading policy after the initial charset", (t) => {
  const f = fixture(t, '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"><meta charset="utf-8"><script>hydrate()</script></head><body></body></html>');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.read(), /<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="[^"]+"><script>/);
  assert.equal(f.read().match(/http-equiv="Content-Security-Policy"/g)?.length, 1);
});

test("local HTTP API calls are not upgraded by the meta policy while the header keeps upgrades", (t) => {
  const f = fixture(t);
  const result = f.run("http://localhost:8080");
  assert.equal(result.status, 0, result.stderr);
  const policy = f.read().match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(policy);
  assert.ok(policy.includes("connect-src 'self' http://localhost:8080 ws://localhost:8080;"));
  assert.ok(!policy.includes("upgrade-insecure-requests"));
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const header = config.headers.flatMap((rule: { headers: { key: string; value: string }[] }) => rule.headers)
    .find((header: { key: string }) => header.key === "Content-Security-Policy");
  assert.ok(header.value.includes("upgrade-insecure-requests"));
});

test("Vercel explicitly runs the npm build command containing the CSP step", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(config.buildCommand, "npm run build");
  assert.ok(pkg.scripts.build.includes("&& node scripts/csp.mjs"));
});

test("CSP handles nested routes, mixed case, raw text and browser newline normalization", (t) => {
  const body = "console.log('line one');\r\nconsole.log('line two');\r";
  const html = `<!doctype html><HTML><HEAD data-note=">"><!-- <script>comment()</script> --><style>/* <script>css()</script> */</style><title>literal <script>title()</script></title></HEAD><BODY><SCRIPT type='module'>${body}</SCRIPT><SCRIPT SRC='app.js'></SCRIPT></BODY></HTML>`;
  const f = fixture(t, html);
  const nested = join(f.cwd, "out/market/symbol.html");
  mkdirSync(dirname(nested), { recursive: true });
  writeFileSync(nested, html);
  const result = f.run("http://localhost:8080/api");
  assert.equal(result.status, 0, result.stderr);
  const output = f.read();
  assert.match(output, /<HEAD data-note=">"><meta http-equiv="Content-Security-Policy"/);
  assert.ok(output.includes(hash(body.replace(/\r\n?/g, "\n"))));
  for (const fake of ["comment()", "css()", "title()", ""]) assert.ok(!output.includes(hash(fake)));
  assert.ok(output.includes("connect-src 'self' http://localhost:8080 ws://localhost:8080;"));
  assert.equal(readFileSync(nested, "utf8"), output);
});

test("CSP reruns replace the previous policy and update origins and hashes", (t) => {
  const f = fixture(t, "<html><head></head><body><script>first()</script></body></html>");
  assert.equal(f.run().status, 0);
  const first = f.read();
  assert.equal(f.run().status, 0);
  assert.equal(f.read(), first);
  writeFileSync(join(f.cwd, "out/index.html"), first.replace("first()", "second()"));
  const result = f.run("https://other.example:8443/api");
  assert.equal(result.status, 0, result.stderr);
  const output = f.read();
  assert.equal(output.match(/http-equiv="Content-Security-Policy"/g)?.length, 1);
  assert.ok(output.includes(hash("second()")));
  assert.ok(!output.includes(hash("first()")));
  assert.ok(!output.includes("api.example.invalid"));
  assert.ok(output.includes("https://other.example:8443 wss://other.example:8443"));
});

test("CSP fails for a missing or non-HTTP API URL before rewriting files", (t) => {
  const f = fixture(t);
  const original = f.read();
  for (const value of ["MISSING", "", "wss://api.example.invalid", "file:///tmp/api", "not a URL"]) {
    const result = f.run(value);
    assert.notEqual(result.status, 0, value);
    assert.match(result.stderr, /NEXT_PUBLIC_API_BASE_URL/);
    assert.equal(f.read(), original);
  }
});

test("CSP loads the production .env file used by Next builds", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, ".env.production"), "NEXT_PUBLIC_API_BASE_URL=https://env.example/api\n");
  const result = f.run("MISSING");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(f.read().includes("connect-src 'self' https://env.example wss://env.example;"));
});

test("CSP fails for missing output, empty output or HTML without a head", (t) => {
  const f = fixture(t, "<html><body>no head</body></html>");
  assert.notEqual(f.run().status, 0);
  rmSync(join(f.cwd, "out/index.html"));
  assert.notEqual(f.run().status, 0);
  rmSync(join(f.cwd, "out"), { recursive: true });
  assert.notEqual(f.run().status, 0);
});
