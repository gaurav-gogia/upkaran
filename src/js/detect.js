const PDF_TYPES = new Set(["application/pdf"]);
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
  "image/tiff",
  "image/bmp",
  "image/x-ms-bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/jxl",
  "image/jp2",
  "image/jpx",
  "image/apng",
  "image/svg+xml"
]);

// MIME types for document-class files (office, rich-text, plain-text)
const DOCUMENT_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-powerpoint",
  "application/vnd.ms-excel",
  "text/plain",
  "text/rtf",
  "application/rtf"
]);

// MIME types for data files
const DATA_TYPES = new Set([
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "application/yaml",
  "text/yaml",
  "application/xml",
  "text/xml"
]);

// MIME types that map to "code" (many browsers send text/plain for source files)
const CODE_TYPES = new Set([
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "text/markdown",
  "application/typescript",
  "text/x-python",
  "text/x-java",
  "text/x-c",
  "text/x-c++",
  "text/x-go",
  "text/x-rust",
  "text/x-php",
  "text/x-ruby",
  "text/x-swift"
]);

const IMAGE_EXT_REGEX = /\.(png|jpe?g|webp|avif|gif|heic|heif|tiff?|bmp|ico|jxl|jp2|jpx|apng|svg)$/i;

// Extensions for office/document files
const DOCUMENT_EXT_REGEX = /\.(docx|pptx|xlsx|doc|ppt|xls|txt|rtf|odt|odp|ods)$/i;

// Extensions for data files
const DATA_EXT_REGEX = /\.(csv|tsv|json|yaml|yml|xml|geojson|ndjson|jsonl)$/i;

// Extensions for code/markup/config files
const CODE_EXT_REGEX =
  /\.(md|mdx|html?|css|scss|sass|less|js|mjs|cjs|jsx|ts|tsx|mts|cts|py|java|go|rs|php|rb|swift|kt|sh|bash|zsh|fish|c|cc|cpp|cxx|h|hh|hpp|sql|r|lua|pl|ex|exs|erl|hrl|clj|cljs|elm|hs|ml|fsharp?|dart|scala|groovy|m|vim|el|lisp|zig|v|toml|ini|env|conf|cfg|properties|nix|tf|hcl|Dockerfile|makefile|cmake|gradle)$/i;

function detectFromName(name = "") {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (IMAGE_EXT_REGEX.test(lower)) return "image";
  if (DOCUMENT_EXT_REGEX.test(lower)) return "document";
  if (DATA_EXT_REGEX.test(lower)) return "data";
  if (CODE_EXT_REGEX.test(lower)) return "code";
  // Bare filenames with no extension that are common code files
  const base = lower.split("/").pop() || lower;
  if (["dockerfile", "makefile", "gemfile", "procfile", "brewfile", "podfile", "vagrantfile"].includes(base)) return "code";
  return "other";
}

export function detectFileKind(file) {
  if (PDF_TYPES.has(file.type)) return "pdf";
  if (IMAGE_TYPES.has(file.type)) return "image";
  if (DOCUMENT_TYPES.has(file.type)) return "document";
  if (DATA_TYPES.has(file.type)) return "data";
  if (CODE_TYPES.has(file.type)) return "code";
  return detectFromName(file.name);
}

/** Human-readable label for a file kind. */
export function kindLabel(kind) {
  switch (kind) {
    case "pdf": return "PDF";
    case "image": return "Image";
    case "document": return "Document";
    case "data": return "Data file";
    case "code": return "Source code";
    case "other": return "File";
    default: return "File";
  }
}

export function enrichFiles(files) {
  return files.map((file, index) => ({
    id: `${file.name}-${file.size}-${index}`,
    file,
    kind: detectFileKind(file),
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream"
  }));
}

export function classifyFiles(items) {
  return items.reduce(
    (acc, item) => {
      const kind = item.kind || detectFileKind(item.file || item);
      if (kind === "pdf") acc.pdfCount += 1;
      else if (kind === "image") acc.imageCount += 1;
      else if (kind === "document" || kind === "data" || kind === "code") acc.contentCount += 1;
      else acc.otherCount += 1;
      return acc;
    },
    { pdfCount: 0, imageCount: 0, contentCount: 0, otherCount: 0 }
  );
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}
