import { fileToHtml } from "./document-tools.js";

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set([
  "application/json",
  "application/xml",
  "application/yaml",
  "application/javascript",
  "application/typescript",
]);

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "rtf", "csv", "tsv", "json", "jsonl", "ndjson", "xml", "yaml", "yml",
  "html", "htm", "css", "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "go", "java",
  "rb", "rs", "c", "cpp", "h", "hpp", "sql", "sh", "toml", "ini", "env",
]);

function isPdfEntry(entry) {
  if (!entry) return false;
  const type = `${entry.type || entry.file?.type || ""}`.toLowerCase();
  const name = `${entry.name || entry.file?.name || ""}`.toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf") || entry.kind === "pdf";
}

function isImageEntry(entry) {
  if (!entry) return false;
  const type = `${entry.type || entry.file?.type || ""}`.toLowerCase();
  return type.startsWith("image/") || entry.kind === "image";
}

function extensionOf(name = "") {
  const match = `${name}`.toLowerCase().match(/\.([a-z0-9]+)$/i);
  return match ? match[1] : "";
}

export function isTextComparable(entry) {
  if (!entry) return false;
  const type = `${entry.type || entry.file?.type || ""}`.toLowerCase();

  if (TEXT_MIME_EXACT.has(type)) return true;
  if (TEXT_MIME_PREFIXES.some((prefix) => type.startsWith(prefix))) return true;

  const ext = extensionOf(entry.name || entry.file?.name || "");
  return TEXT_EXTENSIONS.has(ext);
}

export function resolveCompareMode(leftEntry, rightEntry) {
  if (!leftEntry || !rightEntry) return "unsupported";

  if (isTextComparable(leftEntry) && isTextComparable(rightEntry)) {
    return "text";
  }

  if (isPdfEntry(leftEntry) && isPdfEntry(rightEntry)) {
    return "pdf";
  }

  if (isImageEntry(leftEntry) && isImageEntry(rightEntry)) {
    return "image";
  }

  return "text-fallback";
}

function decodeText(bytes) {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return decoder.decode(bytes);
}

async function readEntryText(entry, maxBytes) {
  const file = entry?.file;
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("Invalid compare input.");
  }

  if (file.size > maxBytes) {
    const clipped = await file.slice(0, maxBytes).arrayBuffer();
    return `${decodeText(clipped)}\n\n[... clipped at ${(maxBytes / (1024 * 1024)).toFixed(1)} MB for compare ...]`;
  }

  const bytes = await file.arrayBuffer();
  return decodeText(bytes);
}

function htmlToText(html = "") {
  return `${html}`
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function entryMetadataText(entry) {
  const file = entry?.file;
  return [
    `Name: ${entry?.name || file?.name || "unknown"}`,
    `Kind: ${entry?.kind || "unknown"}`,
    `Type: ${entry?.type || file?.type || "unknown"}`,
    `Size: ${file?.size ?? entry?.size ?? 0}`,
    `LastModified: ${file?.lastModified ?? "unknown"}`,
  ].join("\n");
}

async function readEntryComparableText(entry, maxBytes) {
  if (isTextComparable(entry)) {
    return {
      text: await readEntryText(entry, maxBytes),
      source: "text",
    };
  }

  try {
    const html = await fileToHtml(entry);
    const normalized = htmlToText(html);
    if (normalized) {
      return {
        text: normalized,
        source: "normalized",
      };
    }
  } catch {
    // Fall through to metadata fallback.
  }

  return {
    text: entryMetadataText(entry),
    source: "metadata",
  };
}

function splitLines(text) {
  return `${text}`.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function buildLcsTable(leftLines, rightLines) {
  const n = leftLines.length;
  const m = rightLines.length;
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (leftLines[i] === rightLines[j]) {
        table[i][j] = table[i + 1][j + 1] + 1;
      } else {
        table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
  }

  return table;
}

function buildOps(leftLines, rightLines, table) {
  const ops = [];
  let i = 0;
  let j = 0;

  while (i < leftLines.length && j < rightLines.length) {
    if (leftLines[i] === rightLines[j]) {
      ops.push({ type: "equal", text: leftLines[i] });
      i += 1;
      j += 1;
      continue;
    }

    if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: "remove", text: leftLines[i] });
      i += 1;
    } else {
      ops.push({ type: "add", text: rightLines[j] });
      j += 1;
    }
  }

  while (i < leftLines.length) {
    ops.push({ type: "remove", text: leftLines[i] });
    i += 1;
  }

  while (j < rightLines.length) {
    ops.push({ type: "add", text: rightLines[j] });
    j += 1;
  }

  return ops;
}

function pairOps(ops) {
  const rows = [];
  let leftNumber = 1;
  let rightNumber = 1;

  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];

    if (op.type === "equal") {
      rows.push({
        type: "equal",
        leftNumber,
        rightNumber,
        leftText: op.text,
        rightText: op.text,
      });
      leftNumber += 1;
      rightNumber += 1;
      continue;
    }

    if (op.type === "remove") {
      const next = ops[i + 1];
      if (next && next.type === "add") {
        rows.push({
          type: "replace",
          leftNumber,
          rightNumber,
          leftText: op.text,
          rightText: next.text,
        });
        leftNumber += 1;
        rightNumber += 1;
        i += 1;
        continue;
      }

      rows.push({
        type: "remove",
        leftNumber,
        rightNumber: null,
        leftText: op.text,
        rightText: "",
      });
      leftNumber += 1;
      continue;
    }

    rows.push({
      type: "add",
      leftNumber: null,
      rightNumber,
      leftText: "",
      rightText: op.text,
    });
    rightNumber += 1;
  }

  return rows;
}

export async function compareTextEntries(leftEntry, rightEntry, options = {}) {
  const maxBytes = Number(options.maxBytes) || 2 * 1024 * 1024;
  const maxLines = Number(options.maxLines) || 1200;

  const [leftComparable, rightComparable] = await Promise.all([
    readEntryComparableText(leftEntry, maxBytes),
    readEntryComparableText(rightEntry, maxBytes),
  ]);

  const leftLines = splitLines(leftComparable.text);
  const rightLines = splitLines(rightComparable.text);
  const leftTruncated = leftLines.length > maxLines;
  const rightTruncated = rightLines.length > maxLines;
  const limitedLeft = leftTruncated ? leftLines.slice(0, maxLines) : leftLines;
  const limitedRight = rightTruncated ? rightLines.slice(0, maxLines) : rightLines;

  const table = buildLcsTable(limitedLeft, limitedRight);
  const ops = buildOps(limitedLeft, limitedRight, table);
  const rows = pairOps(ops);

  const counts = rows.reduce((acc, row) => {
    if (row.type === "equal") acc.equal += 1;
    else if (row.type === "replace") acc.replace += 1;
    else if (row.type === "add") acc.add += 1;
    else if (row.type === "remove") acc.remove += 1;
    return acc;
  }, { equal: 0, replace: 0, add: 0, remove: 0 });

  return {
    mode: "text",
    compareSource: {
      left: leftComparable.source,
      right: rightComparable.source,
      truncated: leftTruncated || rightTruncated,
      maxLines,
    },
    leftName: leftEntry.name,
    rightName: rightEntry.name,
    rows,
    counts,
  };
}

export function compareTextContent(leftText, rightText, options = {}) {
  const maxLines = Number(options.maxLines) || 1200;
  const leftLines = splitLines(leftText || "");
  const rightLines = splitLines(rightText || "");
  const leftTruncated = leftLines.length > maxLines;
  const rightTruncated = rightLines.length > maxLines;
  const limitedLeft = leftTruncated ? leftLines.slice(0, maxLines) : leftLines;
  const limitedRight = rightTruncated ? rightLines.slice(0, maxLines) : rightLines;

  const table = buildLcsTable(limitedLeft, limitedRight);
  const ops = buildOps(limitedLeft, limitedRight, table);
  const rows = pairOps(ops);

  const counts = rows.reduce((acc, row) => {
    if (row.type === "equal") acc.equal += 1;
    else if (row.type === "replace") acc.replace += 1;
    else if (row.type === "add") acc.add += 1;
    else if (row.type === "remove") acc.remove += 1;
    return acc;
  }, { equal: 0, replace: 0, add: 0, remove: 0 });

  return {
    mode: "text",
    compareSource: {
      left: "input",
      right: "input",
      truncated: leftTruncated || rightTruncated,
      maxLines,
    },
    leftName: "Left text",
    rightName: "Right text",
    rows,
    counts,
  };
}
