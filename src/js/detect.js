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

const IMAGE_EXT_REGEX = /\.(png|jpe?g|webp|avif|gif|heic|heif|tiff?|bmp|ico|jxl|jp2|jpx|apng|svg)$/;

function detectFromName(name = "") {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (IMAGE_EXT_REGEX.test(lower)) return "image";
  return "other";
}

export function detectFileKind(file) {
  if (PDF_TYPES.has(file.type)) return "pdf";
  if (IMAGE_TYPES.has(file.type)) return "image";
  return detectFromName(file.name);
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
      else acc.otherCount += 1;
      return acc;
    },
    { pdfCount: 0, imageCount: 0, otherCount: 0 }
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
