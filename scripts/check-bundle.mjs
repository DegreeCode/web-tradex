// Fails when a route's first-load JS exceeds its gzip budget.
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const budgets = {
  "index.html": 340,
  "market.html": 330,
  "market/symbol.html": 450,
  "login.html": 310,
  "portfolio.html": 340,
  "orders.html": 330,
  "margin.html": 370,
  "terms.html": 210,
};

let failed = false;
for (const [route, budgetKb] of Object.entries(budgets)) {
  const file = join("out", route);
  if (!existsSync(file)) {
    console.error(`missing ${file}; run npm run build first`);
    failed = true;
    continue;
  }
  const html = readFileSync(file, "utf8");
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  let bytes = 0;
  for (const src of scripts) {
    const path = join("out", src.replace(/^\//, ""));
    if (existsSync(path)) bytes += gzipSync(readFileSync(path), { level: 9 }).length;
  }
  const kb = bytes / 1024;
  const ok = kb <= budgetKb;
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${route.padEnd(22)} ${kb.toFixed(1)}KB / ${budgetKb}KB`);
}
if (failed) process.exit(1);
