import { readdirSync } from "node:fs";
import { join } from "node:path";

export function htmlFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) return htmlFiles(join(directory, entry.name), path);
    return entry.isFile() && entry.name.endsWith(".html") ? [path] : [];
  }).sort();
}

function attributeValue(value) {
  const entities = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (reference, name) => {
    if (!name.startsWith("#")) return entities[name.toLowerCase()];
    const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
  });
}

// Read exported HTML without rewriting it. Skip comments and raw text so apparent
// tags inside CSS, JavaScript or titles cannot become scripts or CSP elements.
export function* htmlElements(html) {
  const tags = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-z][a-z\d:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  let match;
  while ((match = tags.exec(html))) {
    if (!match[1] || match[0].startsWith("</")) continue;
    const name = match[1].toLowerCase();
    const attributes = new Map();
    const source = match[0].slice(match[1].length + 1, -1);
    const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const attribute of source.matchAll(pattern)) {
      const key = attribute[1].toLowerCase();
      if (!attributes.has(key)) attributes.set(key, attributeValue(attribute[2] ?? attribute[3] ?? attribute[4] ?? ""));
    }
    const element = { name, attributes, start: match.index, end: tags.lastIndex, body: "" };
    if (["script", "style", "title", "textarea", "xmp", "iframe", "noembed", "noframes"].includes(name)) {
      const closing = new RegExp(`</${name}(?:\\s[^>]*|/?)>`, "gi");
      closing.lastIndex = tags.lastIndex;
      const end = closing.exec(html);
      if (!end) throw new Error(`Unclosed <${name}> in exported HTML`);
      element.body = html.slice(tags.lastIndex, end.index);
      tags.lastIndex = closing.lastIndex;
    }
    yield element;
  }
}
