/**
 * document-tools.js
 * Client-side parsing and HTML generation for document / data / code files.
 * All functions return an HTML string suitable for display and for capture
 * via elementToMultiPagePdf().
 */

import { strFromU8, unzipSync } from "fflate";

// ---------------------------------------------------------------------------
// Generic file-text reader
// ---------------------------------------------------------------------------

export async function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

// ---------------------------------------------------------------------------
// Office formats (OOXML = ZIP + XML)
// ---------------------------------------------------------------------------

function unzipToMap(buffer) {
  const uint8 = new Uint8Array(buffer);
  return unzipSync(uint8);
}

function docxFilesFromBuffer(buffer) {
  return unzipToMap(buffer);
}

function docxXmlDoc(buffer) {
  const files = docxFilesFromBuffer(buffer);
  const docEntry = files["word/document.xml"];
  if (!docEntry) return { files, doc: null };

  const xml = strFromU8(docEntry);
  return { files, doc: new DOMParser().parseFromString(xml, "application/xml") };
}

function docxAttr(el, ...names) {
  if (!el) return null;
  for (const name of names) {
    const value = el.getAttribute(name);
    if (value) return value;
  }
  for (const attr of Array.from(el.attributes || [])) {
    if (names.includes(attr.name) || names.includes(attr.localName)) return attr.value;
  }
  return null;
}

function docxLocalName(node) {
  return `${node?.localName || node?.tagName || ""}`.replace(/^.*:/, "").toLowerCase();
}

function docxCollectText(node) {
  const pieces = [];
  for (const child of Array.from(node?.childNodes || [])) {
    if (child.nodeType === Node.TEXT_NODE) {
      const value = child.textContent || "";
      if (value) pieces.push(value);
      continue;
    }

    const name = docxLocalName(child);
    if (name === "t") {
      pieces.push(child.textContent || "");
    } else if (name === "tab") {
      pieces.push("\t");
    } else if (name === "br" || name === "cr") {
      pieces.push("\n");
    } else {
      pieces.push(docxCollectText(child));
    }
  }

  return pieces.join("");
}

function docxRunHtml(run) {
  const text = escHtml(docxCollectText(run));
  if (!text) return "";

  const runProps = run.querySelector("rPr");
  const isBold = !!runProps?.querySelector("b");
  const isItalic = !!runProps?.querySelector("i");
  const isUnderline = !!runProps?.querySelector("u");
  let result = text.replace(/\n/g, "<br>");
  if (isUnderline) result = `<u>${result}</u>`;
  if (isItalic) result = `<em>${result}</em>`;
  if (isBold) result = `<strong>${result}</strong>`;
  return result;
}

function docxParagraphText(paragraph) {
  const runs = Array.from(paragraph?.querySelectorAll("r") || []);
  const text = runs.map((run) => docxCollectText(run)).join("").trim();
  if (text) return text;
  return docxCollectText(paragraph).trim();
}

function docxParagraphHtml(paragraph) {
  const style = docxAttr(paragraph?.querySelector("pStyle"), "val", "w:val") || "";
  const text = docxParagraphText(paragraph);
  const runs = Array.from(paragraph?.querySelectorAll("r") || []);
  const content = runs.map((run) => docxRunHtml(run)).join("") || escHtml(text);
  const listLevel = docxAttr(paragraph?.querySelector("ilvl"), "val", "w:val");
  const hasList = !!paragraph?.querySelector("numPr");

  if (/heading1/i.test(style)) return `<h2>${content}</h2>`;
  if (/heading2/i.test(style)) return `<h3>${content}</h3>`;
  if (/heading3/i.test(style)) return `<h4>${content}</h4>`;
  if (hasList) {
    const indent = Math.min(Number(listLevel || 0), 6);
    return `<p class="docx-list" style="margin-left:${indent * 1.2}rem">• ${content}</p>`;
  }

  return `<p>${content}</p>`;
}

function docxTableHtml(table) {
  const rows = Array.from(table?.querySelectorAll("tr") || []);
  if (!rows.length) return "";

  const body = rows.map((row) => {
    const cells = Array.from(row.querySelectorAll("tc"));
    const rendered = cells.map((cell) => {
      const text = docxCollectText(cell).trim();
      return `<td>${escHtml(text)}</td>`;
    }).join("");
    return `<tr>${rendered}</tr>`;
  }).join("");

  return `<table class="docx-table"><tbody>${body}</tbody></table>`;
}

function docxBlockHtml(block) {
  const name = docxLocalName(block);
  if (name === "p") return docxParagraphHtml(block);
  if (name === "tbl") return docxTableHtml(block);
  return "";
}

function docxBodyBlocks(doc) {
  const body = doc?.querySelector("body");
  if (!body) return [];
  return Array.from(body.children || []).filter((el) => ["p", "tbl"].includes(docxLocalName(el)));
}

function docxMediaInventory(files) {
  return Object.keys(files)
    .filter((key) => /^word\/media\//i.test(key))
    .map((path) => ({ path, ext: path.split(".").pop()?.toLowerCase() || "", size: files[path]?.length || 0 }));
}

function xmlText(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, "application/xml");
  return Array.from(doc.querySelectorAll("*"))
    .filter((el) => el.children.length === 0 && el.textContent.trim())
    .map((el) => el.textContent.trim())
    .join(" ");
}

/**
 * Extract text from a DOCX file.
 * Reads word/document.xml and extracts paragraph text.
 */
export async function extractDocxText(buffer) {
  const { doc } = docxXmlDoc(buffer);
  if (!doc) return "[No content found in DOCX]";

  const blocks = docxBodyBlocks(doc);
  const text = blocks.map((block) => {
    const name = docxLocalName(block);
    if (name === "tbl") {
      return Array.from(block.querySelectorAll("tr"))
        .map((row) => Array.from(row.querySelectorAll("tc")).map((cell) => docxCollectText(cell).trim()).filter(Boolean).join(" | "))
        .filter(Boolean)
        .join("\n");
    }

    return docxParagraphText(block);
  }).filter(Boolean).join("\n\n");

  return text || "[No content found in DOCX]";
}

export async function extractDocxMedia(buffer) {
  const { files } = docxXmlDoc(buffer);
  return docxMediaInventory(files);
}

/**
 * Extract text from a PPTX file (all slides).
 */
export async function extractPptxText(buffer) {
  const files = unzipToMap(buffer);
  const slideEntries = Object.keys(files)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => {
      const na = Number(a.match(/\d+/)?.[0] ?? 0);
      const nb = Number(b.match(/\d+/)?.[0] ?? 0);
      return na - nb;
    });

  const slides = [];
  for (let i = 0; i < slideEntries.length; i++) {
    const xml = strFromU8(files[slideEntries[i]]);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const text = Array.from(doc.querySelectorAll("t"))
      .map((t) => t.textContent.trim())
      .filter(Boolean)
      .join(" ");
    if (text) slides.push(`Slide ${i + 1}: ${text}`);
  }
  return slides.join("\n\n") || "[No text content found in PPTX]";
}

/**
 * Extract cell values from an XLSX file.
 * Returns a simple tab-separated representation.
 */
export async function extractXlsxText(buffer) {
  const files = unzipToMap(buffer);

  // Shared strings
  const ssEntry = files["xl/sharedStrings.xml"];
  const sharedStrings = [];
  if (ssEntry) {
    const xml = strFromU8(ssEntry);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    sharedStrings.push(...Array.from(doc.querySelectorAll("si")).map((si) =>
      Array.from(si.querySelectorAll("t")).map((t) => t.textContent).join("")
    ));
  }

  // First sheet
  const sheetEntry = files["xl/worksheets/sheet1.xml"];
  if (!sheetEntry) return "[No sheet data found in XLSX]";

  const xml = strFromU8(sheetEntry);
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  const rows = [];
  for (const row of doc.querySelectorAll("row")) {
    const cells = [];
    for (const cell of row.querySelectorAll("c")) {
      const t = cell.getAttribute("t");
      const vEl = cell.querySelector("v");
      if (!vEl) { cells.push(""); continue; }
      if (t === "s") {
        cells.push(sharedStrings[Number(vEl.textContent)] ?? "");
      } else if (t === "b") {
        cells.push(vEl.textContent === "1" ? "TRUE" : "FALSE");
      } else {
        cells.push(vEl.textContent ?? "");
      }
    }
    rows.push(cells);
  }

  return rows.map((r) => r.join("\t")).join("\n");
}

/**
 * Strip RTF control words and return plain text.
 */
export function stripRtf(rtf) {
  return rtf
    .replace(/\\[a-z]+[-]?\d*[ ]?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\\\n/g, "\n")
    .replace(/\\'/g, "'")
    .replace(/\r\n|\r/g, "\n")
    .trim();
}

// ---------------------------------------------------------------------------
// CSV / TSV parsing
// ---------------------------------------------------------------------------

/**
 * Parse CSV/TSV text to a 2-D array of strings.
 */
export function parseCsv(text, delimiter = ",") {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let inQuote = false;
    let current = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === delimiter && !inQuote) {
        cells.push(current); current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current);
    rows.push(cells);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// HTML generators
// All return a self-contained HTML string (no external resources needed).
// ---------------------------------------------------------------------------

const BASE_STYLES = `
  body {
    margin: 0; padding: 32px 40px;
    font-family: "Noto Sans", "Segoe UI", sans-serif;
    font-size: 13.5px; line-height: 1.7;
    color: #1a1b20; background: white;
    max-width: 720px;
  }
  h1 { font-size: 1.3rem; margin: 0 0 0.2rem; font-weight: 700; }
  h2 { font-size: 1rem; margin: 1.2rem 0 0.4rem; font-weight: 600; }
  h3 { font-size: 0.9rem; margin: 1rem 0 0.3rem; font-weight: 600; }
  p  { margin: 0.6rem 0; }
  pre { background: #f4f4f6; border-radius: 6px; padding: 10px 14px; overflow-x: auto; font-size: 12px; }
  code { font-family: "Cascadia Code", "Consolas", monospace; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th { background: #e8eaf0; font-weight: 600; text-align: left; }
  th, td { border: 1px solid #c5c6d1; padding: 5px 8px; }
  tr:nth-child(even) td { background: #f8f9fd; }
  .file-meta { font-size: 0.78rem; color: #757782; margin-bottom: 1.2rem; border-bottom: 1px solid #e0e0e0; padding-bottom: 0.6rem; }
  blockquote { border-left: 3px solid #c5c6d1; margin: 0.5rem 0; padding: 0.2rem 0.8rem; color: #555; }
  hr { border: none; border-top: 1px solid #e0e0e0; margin: 1rem 0; }
`;

function htmlDoc(title, meta, bodyContent, extraStyles = "") {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>${BASE_STYLES}${extraStyles ? `\n${extraStyles}` : ""}</style></head><body>
<h1>${escHtml(title)}</h1>
<p class="file-meta">${meta}</p>
${bodyContent}
</body></html>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Plain text ──────────────────────────────────────────────────────────────

export function textToHtml(text, filename) {
  const lines = text.split(/\r?\n/);
  const body = lines
    .map((l) => l.trim() ? `<p>${escHtml(l)}</p>` : "<p style='margin:0;height:0.4rem'></p>")
    .join("");
  return htmlDoc(filename, `${lines.length} lines`, body);
}

// ── Markdown ────────────────────────────────────────────────────────────────

export async function markdownToHtml(mdText, filename) {
  const { marked } = await import("marked");
  marked.setOptions({ gfm: true, breaks: false });
  const rendered = marked.parse(mdText);
  return htmlDoc(filename, `Markdown document`, rendered);
}

// ── CSV / TSV ───────────────────────────────────────────────────────────────

export function csvToHtml(text, filename, delimiter = ",") {
  const rows = parseCsv(text, delimiter);
  if (!rows.length) return htmlDoc(filename, "Empty file", "<p>No data.</p>");

  const [header, ...data] = rows;
  const thead = `<thead><tr>${header.map((h) => `<th>${escHtml(h)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${data
    .map((r) => `<tr>${r.map((c) => `<td>${escHtml(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  return htmlDoc(filename, `${data.length} rows · ${header.length} columns`, `<table>${thead}${tbody}</table>`);
}

// ── JSON ────────────────────────────────────────────────────────────────────

export function jsonToHtml(text, filename) {
  let pretty;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    pretty = text;
  }
  return htmlDoc(filename, "JSON file", `<pre><code>${escHtml(pretty)}</code></pre>`);
}

// ── YAML ────────────────────────────────────────────────────────────────────

export async function yamlToHtml(text, filename) {
  let pretty = text;
  try {
    const yaml = await import("js-yaml");
    const parsed = yaml.load(text);
    pretty = JSON.stringify(parsed, null, 2);
  } catch {
    // Show raw text
  }
  return htmlDoc(filename, "YAML file", `<pre><code>${escHtml(pretty)}</code></pre>`);
}

// ── XML ─────────────────────────────────────────────────────────────────────

export function xmlToHtml(text, filename) {
  const pretty = formatXml(text);
  return htmlDoc(filename, "XML file", `<pre><code>${escHtml(pretty)}</code></pre>`);
}

function formatXml(xml) {
  let indent = 0;
  return xml
    .replace(/(>)(<)/g, "$1\n$2")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("</")) indent = Math.max(0, indent - 1);
      const result = "  ".repeat(indent) + trimmed;
      if (!trimmed.startsWith("</") && !trimmed.endsWith("/>") && !trimmed.startsWith("<?") && trimmed.includes("<") && !trimmed.includes("</")) {
        indent++;
      }
      return result;
    })
    .join("\n");
}

// ── Source code / markup ────────────────────────────────────────────────────

export async function codeToHtml(text, filename, lang = "") {
  const hljs = (await import("highlight.js")).default;
  // Use highlight.js CSS injected inline
  const hljsCss = await fetchHljsCss();

  let highlighted;
  try {
    if (lang && hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(text, { language: lang }).value;
    } else {
      highlighted = hljs.highlightAuto(text, {
        subset: ["javascript", "typescript", "python", "java", "go", "rust", "c", "cpp",
          "html", "css", "bash", "sql", "json", "yaml", "xml", "markdown"]
      }).value;
    }
  } catch {
    highlighted = escHtml(text);
  }

  const lineNumbers = text.split("\n").map((_, i) =>
    `<span class="ln">${i + 1}</span>`
  ).join("\n");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(filename)}</title>
<style>
${BASE_STYLES}
${hljsCss}
.code-wrap { display: grid; grid-template-columns: auto 1fr; gap: 0; border-radius: 8px; overflow: hidden; border: 1px solid #dde; font-size: 12.5px; }
.line-nums { background: #f0f0f3; padding: 12px 8px 12px 12px; text-align: right; color: #aaa; font-family: "Cascadia Code","Consolas",monospace; user-select: none; white-space: pre; line-height: 1.55; }
pre.hljs { margin: 0; padding: 12px 16px; overflow: hidden; border-radius: 0; background: #fafafa; line-height: 1.55; }
.ln { display: block; }
</style></head><body>
<h1>${escHtml(filename)}</h1>
<p class="file-meta">Source code · ${text.split("\n").length} lines${lang ? " · " + lang : ""}</p>
<div class="code-wrap">
  <div class="line-nums">${lineNumbers}</div>
  <pre class="hljs"><code>${highlighted}</code></pre>
</div>
</body></html>`;
}

// ── HTML / SVG files ─────────────────────────────────────────────────────────

export async function markupToHtml(text, filename) {
  // Show as source code (don't render as HTML)
  return codeToHtml(text, filename, "html");
}

/**
 * Fetch a remote HTML/text URL and convert it into a local HTML snapshot.
 *
 * The result is intentionally sanitized so the downstream PDF export path can
 * render a stable, static snapshot without executing scripts.
 */
export async function urlToHtml(urlInput) {
  const url = normalizeHttpUrl(urlInput);
  const response = await fetch(url.href, {
    mode: "cors",
    credentials: "omit",
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`URL request failed with ${response.status} ${response.statusText}`.trim());
  }

  const contentType = `${response.headers.get("content-type") || ""}`.toLowerCase();
  const raw = await response.text();

  if (contentType.includes("text/plain")) {
    return textToHtml(raw, url.hostname);
  }

  if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    throw new Error("Only HTML or plain-text URLs can be converted here. Download PDFs in the PDF tools instead.");
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(raw, "text/html");
  const title = parsed.querySelector("title")?.textContent?.trim() || url.hostname;

  const styleContent = Array.from(parsed.querySelectorAll("style"))
    .map((styleEl) => styleEl.textContent || "")
    .join("\n")
    .replace(/@import\s[^;]+;/g, "")
    .replace(/@font-face\s*\{[^}]*\}/gs, "");

  const body = parsed.body;
  if (!body) {
    throw new Error("The URL did not return a readable HTML body.");
  }

  body.querySelectorAll("script, noscript, iframe, object, embed, link[rel='stylesheet']").forEach((el) => el.remove());

  body.querySelectorAll("[src], [href]").forEach((el) => {
    for (const attr of ["src", "href"]) {
      if (!el.hasAttribute(attr)) continue;
      const value = el.getAttribute(attr)?.trim();
      if (!value || value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("mailto:") || value.startsWith("javascript:")) {
        continue;
      }

      try {
        el.setAttribute(attr, new URL(value, url.href).href);
      } catch {
        // Leave invalid URLs untouched.
      }
    }
  });

  return htmlDoc(title, `Fetched from ${escHtml(url.href)}`, body.innerHTML, styleContent);
}

// ── DOCX / PPTX / XLSX ──────────────────────────────────────────────────────

export async function docxToHtml(buffer, filename) {
  const { doc, files } = docxXmlDoc(buffer);
  if (!doc) return htmlDoc(filename, "DOCX document", "<p>No content found in DOCX.</p>");

  const blocks = docxBodyBlocks(doc);
  const media = docxMediaInventory(files);
  const body = blocks.map(docxBlockHtml).filter(Boolean).join("\n");
  const mediaBadge = media.length ? ` · ${media.length} embedded image${media.length === 1 ? "" : "s"}` : "";
  const extraStyles = `
    .docx-table { border-collapse: collapse; width: 100%; margin: 0.8rem 0; font-size: 0.93rem; }
    .docx-table td { border: 1px solid #c5c6d1; padding: 0.45rem 0.55rem; vertical-align: top; }
    .docx-list { margin-top: 0.35rem; margin-bottom: 0.35rem; }
    .docx-note { font-size: 0.78rem; color: #5f6472; margin-top: -0.2rem; }
  `;

  return htmlDoc(
    filename,
    `DOCX document · structure-aware preview${mediaBadge}`,
    `${media.length ? `<p class="docx-note">Embedded media detected: ${media.length} file${media.length === 1 ? "" : "s"}.</p>` : ""}${body || "<p>No content found in DOCX.</p>"}`,
    extraStyles
  );
}

export async function pptxToHtml(buffer, filename) {
  const text = await extractPptxText(buffer);
  return textToHtml(text, filename);
}

export async function xlsxToHtml(buffer, filename) {
  const text = await extractXlsxText(buffer);
  // XLSX is tab-separated; render as a simple table
  const rows = text.split("\n").map((r) => r.split("\t"));
  if (!rows.length) return htmlDoc(filename, "Empty spreadsheet", "<p>No data.</p>");
  const [header, ...data] = rows;
  const thead = `<thead><tr>${header.map((h) => `<th>${escHtml(h)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${data
    .map((r) => `<tr>${r.map((c) => `<td>${escHtml(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  return htmlDoc(filename, `Spreadsheet (Sheet 1) · ${data.length} rows`, `<table>${thead}${tbody}</table>`);
}

// ---------------------------------------------------------------------------
// Extension → processing function map
// ---------------------------------------------------------------------------

export function getExtension(filename) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function detectLang(filename) {
  const ext = getExtension(filename);
  const MAP = {
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    ts: "typescript", tsx: "typescript",
    py: "python", rb: "ruby", go: "go", rs: "rust", swift: "swift",
    java: "java", kt: "kotlin", c: "c", cc: "cpp", cpp: "cpp", cxx: "cpp",
    h: "c", hh: "cpp", hpp: "cpp",
    sh: "bash", bash: "bash", zsh: "bash",
    html: "html", htm: "html", css: "css", scss: "scss",
    sql: "sql", r: "r", lua: "lua", php: "php",
    tf: "hcl", dockerfile: "dockerfile"
  };
  return MAP[ext] ?? ext;
}

/**
 * High-level entry point: given an enriched file entry, produce an HTML string.
 * @param {Object} entry  - { file, name, kind }
 * @returns {Promise<string>} HTML string
 */
export async function fileToHtml(entry) {
  const { file, name, kind } = entry;
  const ext = getExtension(name);

  if (kind === "document") {
    if (["docx"].includes(ext)) {
      return docxToHtml(await file.arrayBuffer(), name);
    }
    if (["pptx"].includes(ext)) {
      return pptxToHtml(await file.arrayBuffer(), name);
    }
    if (["xlsx"].includes(ext)) {
      return xlsxToHtml(await file.arrayBuffer(), name);
    }
    if (["rtf"].includes(ext)) {
      const raw = await readFileText(file);
      return textToHtml(stripRtf(raw), name);
    }
    // TXT and anything else
    return textToHtml(await readFileText(file), name);
  }

  if (kind === "data") {
    const text = await readFileText(file);
    if (ext === "csv") return csvToHtml(text, name, ",");
    if (ext === "tsv") return csvToHtml(text, name, "\t");
    if (ext === "json" || ext === "geojson" || ext === "jsonl") return jsonToHtml(text, name);
    if (ext === "yaml" || ext === "yml") return yamlToHtml(text, name);
    if (ext === "xml") return xmlToHtml(text, name);
    return textToHtml(text, name);
  }

  if (kind === "code") {
    const text = await readFileText(file);
    if (ext === "md" || ext === "mdx") return markdownToHtml(text, name);
    if (ext === "html" || ext === "htm" || ext === "svg") return markupToHtml(text, name);
    return codeToHtml(text, name, detectLang(name));
  }

  // Fallback
  const text = await readFileText(file);
  return textToHtml(text, name);
}

function normalizeHttpUrl(input) {
  const raw = `${input ?? ""}`.trim();
  if (!raw) {
    throw new Error("Enter a URL before previewing or converting.");
  }

  const withScheme = /^https?:\/\//i.test(raw) || raw.startsWith("//")
    ? raw
    : `https://${raw}`;

  const resolved = new URL(withScheme.startsWith("//") ? `https:${withScheme}` : withScheme);
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported.");
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Lazy-load highlight.js CSS (github theme)
// ---------------------------------------------------------------------------

let _hljsCss = null;
async function fetchHljsCss() {
  if (_hljsCss) return _hljsCss;
  try {
    // Try to grab the CSS from the module itself
    const styles = await import("highlight.js/styles/github.css?inline");
    _hljsCss = styles.default ?? "";
  } catch {
    // fallback: basic colours
    _hljsCss = `
      .hljs { color: #24292e; }
      .hljs-keyword, .hljs-selector-tag { color: #d73a49; font-weight: 600; }
      .hljs-string, .hljs-attr { color: #032f62; }
      .hljs-number, .hljs-literal { color: #005cc5; }
      .hljs-comment { color: #6a737d; font-style: italic; }
      .hljs-function, .hljs-title { color: #6f42c1; }
      .hljs-built_in, .hljs-type { color: #e36209; }
    `;
  }
  return _hljsCss;
}
