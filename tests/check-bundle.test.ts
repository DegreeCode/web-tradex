import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const script = fileURLToPath(new URL("../scripts/check-bundle.mjs", import.meta.url));
const csp = fileURLToPath(new URL("../scripts/csp.mjs", import.meta.url));

function fixture(t: test.TestContext) {
  const cwd = mkdtempSync(join(tmpdir(), "tradex-bundle-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  function write(path: string, content: string | Buffer) {
    const file = join(cwd, "out", path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  // Every configured route must exist; unrelated missing routes cannot mask failures.
  const budgets = [...readFileSync(script, "utf8").matchAll(/"([^"]+\.html)":\s*(\d+)/g)];
  for (const [, route] of budgets) write(route, "<html><head></head><body></body></html>");
  return {
    cwd, write,
    run: () => spawnSync(process.execPath, [script], { cwd, encoding: "utf8" }),
  };
}

test("bundle checker fails on missing referenced scripts", (t) => {
  const f = fixture(t);
  f.write("index.html", '<html><head><script src="/_next/static/missing.js"></script></head></html>');
  const result = f.run();
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /index\.html.*missing.*missing\.js/i);
});

test("bundle checker counts each script once and strips query strings and fragments", (t) => {
  const f = fixture(t);
  const body = Array.from({ length: 2000 }, (_, i) => `console.log(${i});`).join("\n");
  f.write("_next/static/app.js", body);
  f.write("index.html", '<html><head><script src="/_next/static/app.js"></script><script src="/_next/static/app.js"></script><script src="/_next/static/app.js?v=1#bundle"></script></head></html>');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const kb = (gzipSync(body, { level: 9 }).length / 1024).toFixed(1);
  assert.match(result.stdout, new RegExp(`index\\.html\\s+${kb.replace(".", "\\.")}KB /`));
});

test("bundle checker fails when any nested HTML route lacks a budget", (t) => {
  const f = fixture(t);
  f.write("new/route.html", "<html><head></head></html>");
  const result = f.run();
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /new\/route\.html.*budget/i);
});

test("bundle checker supports quoted attributes, relative URLs and ignores comment scripts", (t) => {
  const f = fixture(t);
  const body = Array.from({ length: 2000 }, (_, i) => `console.log(${i});`).join("\n");
  f.write("market/app.js", body);
  f.write("market/symbol.html", '<html><head><!-- <script src="missing.js"></script> --><SCRIPT data-label=">" SRC=\'app.js\'></SCRIPT></head></html>');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const kb = (gzipSync(body, { level: 9 }).length / 1024).toFixed(1);
  assert.match(result.stdout, new RegExp(`market/symbol\\.html\\s+${kb.replace(".", "\\.")}KB /`));
});

test("bundle checker fails for scripts outside the export instead of skipping them", (t) => {
  const f = fixture(t);
  f.write("index.html", '<html><head><script src="https://cdn.example/app.js"></script></head></html>');
  const result = f.run();
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /index\.html.*(external|local|origin)/i);
});

test("bundle checker still fails for a missing budgeted route and oversized bundles", (t) => {
  const f = fixture(t);
  rmSync(join(f.cwd, "out/index.html"));
  let result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing.*index\.html/i);
  const body = Buffer.alloc(1024 * 1024);
  let seed = 1;
  for (let i = 0; i < body.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    body[i] = seed & 255;
  }
  f.write("_next/static/large.js", body);
  f.write("index.html", '<html><head><script src="/_next/static/large.js"></script></head></html>');
  result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL index\.html/);
});

test("CSP meta insertion leaves bundle measurements unchanged", (t) => {
  const f = fixture(t);
  f.write("_next/static/app.js", "console.log('bundle')");
  f.write("index.html", '<html><head><script src="/_next/static/app.js"></script></head><body><script>self.__next_f.push([0])</script></body></html>');
  const before = f.run();
  assert.equal(before.status, 0, before.stderr);
  const result = spawnSync(process.execPath, [csp], {
    cwd: f.cwd, encoding: "utf8",
    env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: "https://api.example.invalid" },
  });
  assert.equal(result.status, 0, result.stderr);
  const after = f.run();
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, before.stdout);
});
