// Fails when a route's first-load JS exceeds its gzip budget.
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve, sep } from "node:path";
import { htmlElements, htmlFiles } from "./html.mjs";

const budgets = {
  // Round measured gzip KiB up with 10% headroom to catch meaningful growth.
  "404.html": 194,
  "_not-found.html": 194,
  "accounts.html": 336,
  "index.html": 342,
  "invite.html": 263,
  "link.html": 343,
  "listings/new.html": 341,
  "login.html": 294,
  "margin.html": 388,
  "market.html": 336,
  "market/symbol.html": 459,
  "notifications.html": 333,
  "orders.html": 342,
  "portfolio.html": 344,
  "privacy.html": 194,
  "recover.html": 263,
  "security.html": 338,
  "settings.html": 332,
  "signup.html": 268,
  "support.html": 335,
  "terms.html": 194,
  "transfers.html": 332,
};

let failed = false;
const sizes = new Map();
const root = resolve("out");
try {
  const routes = htmlFiles("out");
  for (const route of Object.keys(budgets)) {
    if (!existsSync(join(root, route))) {
      console.error(`missing out/${route}; run npm run build first`);
      failed = true;
    }
  }
  for (const route of routes) {
    if (!Object.hasOwn(budgets, route)) {
      console.error(`${route}: missing bundle budget`);
      failed = true;
      continue;
    }
    try {
      const html = readFileSync(join(root, route), "utf8");
      const scripts = new Set();
      for (const element of htmlElements(html)) {
        if (element.name !== "script" || !element.attributes.has("src")) continue;
        const src = element.attributes.get("src");
        const url = new URL(src, `https://export.invalid/${route}`);
        if (!src || url.origin !== "https://export.invalid") {
          throw new Error(`script must reference a local export file: ${src}`);
        }
        const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (!path.startsWith(`${root}${sep}`)) throw new Error(`script outside export: ${src}`);
        if (!existsSync(path)) throw new Error(`missing referenced script: ${src}`);
        scripts.add(path);
      }
      let bytes = 0;
      for (const path of scripts) {
        if (!sizes.has(path)) sizes.set(path, gzipSync(readFileSync(path), { level: 9 }).length);
        bytes += sizes.get(path);
      }
      const kb = bytes / 1024;
      const budgetKb = budgets[route];
      const ok = kb <= budgetKb;
      if (!ok) failed = true;
      console.log(`${ok ? "ok  " : "FAIL"} ${route.padEnd(22)} ${kb.toFixed(1)}KB / ${budgetKb}KB`);
    } catch (error) {
      console.error(`${route}: ${error.message}`);
      failed = true;
    }
  }
} catch (error) {
  console.error(`Bundle check: ${error.message}`);
  failed = true;
}
if (failed) process.exitCode = 1;
