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
  const files = unzipToMap(buffer);
  const docEntry = files["word/document.xml"];
  if (!docEntry) return "[No content found in DOCX]";

  const xml = strFromU8(docEntry);
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  // Build paragraphs from <w:p> elements
  const paragraphs = Array.from(doc.querySelectorAll("p")).map((p) => {
    return Array.from(p.querySelectorAll("t")).map((t) => t.textContent).join("");
  });
  return paragraphs.filter(Boolean).join("\n\n");
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

function htmlDoc(title, meta, bodyContent) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>${BASE_STYLES}</style></head><body>
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

// ── DOCX / PPTX / XLSX ──────────────────────────────────────────────────────

export async function docxToHtml(buffer, filename) {
  const text = await extractDocxText(buffer);
  return textToHtml(text, filename);
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
