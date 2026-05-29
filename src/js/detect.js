const PDF_TYPES = new Set(["application/pdf"]);
const DJVU_TYPES = new Set([
  "image/vnd.djvu",
  "image/djvu",
  "image/x.djvu",
  "application/vnd.djvu",
  "application/x-djvu"
]);
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

const ARCHIVE_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed"
]);

const VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "video/x-msvideo",
  "video/mpeg",
  "video/ogg"
]);

const IMAGE_EXT_REGEX = /\.(png|jpe?g|webp|avif|gif|heic|heif|tiff?|bmp|ico|jxl|jp2|jpx|apng|svg)$/i;
const DJVU_EXT_REGEX = /\.djvu$/i;

// Extensions for office/document files
const DOCUMENT_EXT_REGEX = /\.(docx|pptx|xlsx|doc|ppt|xls|txt|rtf|odt|odp|ods)$/i;

// Extensions for data files
const DATA_EXT_REGEX = /\.(csv|tsv|json|yaml|yml|xml|geojson|ndjson|jsonl)$/i;

// Extensions for code/markup/config files
const CODE_EXT_REGEX =
  /\.(md|mdx|html?|css|scss|sass|less|js|mjs|cjs|jsx|ts|tsx|mts|cts|py|java|go|rs|php|rb|swift|kt|sh|bash|zsh|fish|c|cc|cpp|cxx|h|hh|hpp|sql|r|lua|pl|ex|exs|erl|hrl|clj|cljs|elm|hs|ml|fsharp?|dart|scala|groovy|m|vim|el|lisp|zig|v|toml|ini|env|conf|cfg|properties|nix|tf|hcl|Dockerfile|makefile|cmake|gradle)$/i;

const ARCHIVE_EXT_REGEX = /\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i;
const VIDEO_EXT_REGEX = /\.(mp4|webm|mov|mkv|avi|mpeg|mpg|m4v|ogv)$/i;

export const TYPE_TABS = {
  PDF: "pdf",
  IMAGE: "image",
  ARCHIVE: "archive",
  TEXT: "text",
  CODE: "code",
  VIDEO: "video",
  OTHER: "other"
};

const TYPE_TAB_ORDER = [
  TYPE_TABS.PDF,
  TYPE_TABS.IMAGE,
  TYPE_TABS.ARCHIVE,
  TYPE_TABS.TEXT,
  TYPE_TABS.CODE,
  TYPE_TABS.VIDEO,
  TYPE_TABS.OTHER
];

function detectFromName(name = "") {
  const lower = name.toLowerCase();
  if (DJVU_EXT_REGEX.test(lower)) return "djvu";
  if (lower.endsWith(".pdf")) return "pdf";
  if (IMAGE_EXT_REGEX.test(lower)) return "image";
  if (ARCHIVE_EXT_REGEX.test(lower)) return "archive";
  if (VIDEO_EXT_REGEX.test(lower)) return "video";
  if (DOCUMENT_EXT_REGEX.test(lower)) return "document";
  if (DATA_EXT_REGEX.test(lower)) return "data";
  if (CODE_EXT_REGEX.test(lower)) return "code";
  // Bare filenames with no extension that are common code files
  const base = lower.split("/").pop() || lower;
  if (["dockerfile", "makefile", "gemfile", "procfile", "brewfile", "podfile", "vagrantfile"].includes(base)) return "code";
  return "other";
}

export function detectFileKind(file) {
  if (DJVU_TYPES.has(file.type)) return "djvu";
  if (PDF_TYPES.has(file.type)) return "pdf";
  if (IMAGE_TYPES.has(file.type)) return "image";
  if (ARCHIVE_TYPES.has(file.type)) return "archive";
  if (VIDEO_TYPES.has(file.type)) return "video";
  if (DOCUMENT_TYPES.has(file.type)) return "document";
  if (DATA_TYPES.has(file.type)) return "data";
  if (CODE_TYPES.has(file.type)) return "code";
  return detectFromName(file.name);
}

export function mapKindToTypeTab(kind) {
  switch (kind) {
    case "djvu":
    case "pdf":
      return TYPE_TABS.PDF;
    case "image":
      return TYPE_TABS.IMAGE;
    case "archive":
      return TYPE_TABS.ARCHIVE;
    case "document":
    case "data":
      return TYPE_TABS.TEXT;
    case "code":
      return TYPE_TABS.CODE;
    case "video":
      return TYPE_TABS.VIDEO;
    default:
      return TYPE_TABS.OTHER;
  }
}

export function typeTabLabel(tab) {
  switch (tab) {
    case TYPE_TABS.PDF:
      return "PDF";
    case TYPE_TABS.IMAGE:
      return "Image";
    case TYPE_TABS.ARCHIVE:
      return "Archive";
    case TYPE_TABS.TEXT:
      return "Text";
    case TYPE_TABS.CODE:
      return "Code";
    case TYPE_TABS.VIDEO:
      return "Video";
    default:
      return "Other";
  }
}

export function summarizeTypeTabs(items) {
  const counts = new Map();
  for (const item of items || []) {
    const kind = item.kind || detectFileKind(item.file || item);
    const tab = mapKindToTypeTab(kind);
    counts.set(tab, (counts.get(tab) || 0) + 1);
  }

  return TYPE_TAB_ORDER
    .filter((tab) => counts.has(tab))
    .map((tab) => ({ tab, count: counts.get(tab) || 0 }));
}

/** Human-readable label for a file kind. */
export function kindLabel(kind) {
  switch (kind) {
    case "djvu": return "DjVu";
    case "pdf": return "PDF";
    case "image": return "Image";
    case "archive": return "Archive";
    case "video": return "Video";
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
      if (kind === "djvu") acc.djvuCount += 1;
      else if (kind === "pdf") acc.pdfCount += 1;
      else if (kind === "image") acc.imageCount += 1;
      else if (kind === "document" || kind === "data" || kind === "code") acc.contentCount += 1;
      else acc.otherCount += 1;
      return acc;
    },
    { djvuCount: 0, pdfCount: 0, imageCount: 0, contentCount: 0, otherCount: 0 }
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
