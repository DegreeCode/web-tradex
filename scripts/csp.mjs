import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { htmlElements, htmlFiles } from "./html.mjs";

function apiOrigins(value) {
  try {
    const api = new URL(value);
    if (!["http:", "https:"].includes(api.protocol)) throw new Error("unsupported protocol");
    const socket = new URL(api.origin);
    socket.protocol = api.protocol === "https:" ? "wss:" : "ws:";
    return `${api.origin} ${socket.origin}`;
  } catch {
    throw new Error("NEXT_PUBLIC_API_BASE_URL must be an absolute http(s) URL");
  }
}

function withCsp(html, origins, baseline) {
  const elements = [...htmlElements(html)];
  const head = elements.find((element) => element.name === "head");
  if (!head) throw new Error("Exported HTML is missing <head>");
  const hashes = new Set();
  for (const element of elements) {
    if (element.name !== "script" || element.attributes.has("src")) continue;
    // HTML parsing normalizes line endings before CSP checks the script text.
    const body = element.body.replace(/\r\n?/g, "\n");
    hashes.add(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
  }
  const policy = baseline.split(";").map((directive) => directive.trim()).filter(Boolean).flatMap((directive) => {
    const name = directive.split(/\s/)[0];
    if (["frame-ancestors", "report-uri", "upgrade-insecure-requests"].includes(name)) return [];
    if (name === "script-src") return [`script-src 'self'${hashes.size ? ` ${[...hashes].join(" ")}` : ""}`];
    if (name === "connect-src") return [`connect-src 'self' ${origins}`];
    return [directive];
  }).join("; ");
  const escapedPolicy = policy.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapedPolicy}">`;
  // Replace earlier generated policies, including ones moved by another tool.
  const previous = elements.filter((element) => element.name === "meta"
    && element.attributes.get("http-equiv")?.toLowerCase() === "content-security-policy");
  const first = elements.find((element) => element.start >= head.end && !previous.includes(element));
  // Keep the encoding declaration inside the browser's first 1024-byte scan.
  const insertionEnd = first?.name === "meta" && first.attributes.has("charset") ? first.end : head.end;
  let output = html;
  for (const element of previous.reverse()) output = output.slice(0, element.start) + output.slice(element.end);
  const offset = insertionEnd - previous.filter((element) => element.end <= insertionEnd)
    .reduce((bytes, element) => bytes + element.end - element.start, 0);
  return output.slice(0, offset) + meta + output.slice(offset);
}

try {
  // next build's environment is a child process. Load the same production env
  // files here so .env.local/.env.production deployments use the same API URL.
  const require = createRequire(import.meta.url);
  const nextRequire = createRequire(require.resolve("next/package.json"));
  nextRequire("@next/env").loadEnvConfig(process.cwd(), false);
  const origins = apiOrigins(process.env.NEXT_PUBLIC_API_BASE_URL);
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const baseline = config.headers.flatMap((rule) => rule.headers)
    .find((header) => header.key.toLowerCase() === "content-security-policy")?.value;
  if (!baseline) throw new Error("Missing baseline Content-Security-Policy in vercel.json");
  const files = htmlFiles("out");
  if (!files.length) throw new Error("No exported HTML in out/; run next build first");
  // Validate every page before writing any of them.
  const pages = files.map((file) => {
    try {
      return [join("out", file), withCsp(readFileSync(join("out", file), "utf8"), origins, baseline)];
    } catch (error) {
      throw new Error(`${file}: ${error.message}`);
    }
  });
  for (const [file, html] of pages) writeFileSync(file, html);
  console.log(`CSP: hashed inline scripts in ${pages.length} HTML files; connect-src 'self' ${origins}`);
} catch (error) {
  console.error(`CSP: ${error.message}`);
  process.exitCode = 1;
}
