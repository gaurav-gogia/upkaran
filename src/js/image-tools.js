function mimeFromFormat(format) {
  switch (format) {
    case "svg":
      return "image/svg+xml";
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    default:
      return "image/png";
  }
}

function isLossyMime(type) {
  return type === "image/jpeg" || type === "image/webp" || type === "image/avif";
}

function isLosslessMime(type) {
  return type === "image/png";
}

const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence"
]);

function extensionFromName(name = "") {
  const match = name.toLowerCase().match(/\.([^.]+)$/);
  return match ? match[1] : "";
}

function isSvgLike(file) {
  const ext = extensionFromName(file?.name);
  return file?.type === "image/svg+xml" || ext === "svg";
}

function isHeicLike(file) {
  const ext = extensionFromName(file?.name);
  return HEIC_MIME_TYPES.has(file?.type) || ext === "heic" || ext === "heif";
}

let heicDecoderPromise;

function resolveHeicDecoder(moduleValue) {
  if (typeof moduleValue === "function") return moduleValue;
  if (!moduleValue || typeof moduleValue !== "object") return null;

  if (typeof moduleValue.default === "function") return moduleValue.default;
  if (typeof moduleValue.heic2any === "function") return moduleValue.heic2any;

  const nestedDefault = moduleValue.default;
  if (nestedDefault && typeof nestedDefault === "object") {
    if (typeof nestedDefault.default === "function") return nestedDefault.default;
    if (typeof nestedDefault.heic2any === "function") return nestedDefault.heic2any;
  }

  return null;
}

async function loadHeicDecoder() {
  if (!heicDecoderPromise) {
    heicDecoderPromise = (async () => {
      const mod = await import("heic2any");
      const decoder = resolveHeicDecoder(mod);
      if (typeof decoder === "function") return decoder;
      throw new Error("HEIC decoder export was not callable.");
    })();
  }

  return heicDecoderPromise;
}

async function decodeHeicBlob(file) {
  let heic2any;
  try {
    heic2any = await loadHeicDecoder();
  } catch (error) {
    throw new Error(`Failed to load HEIC/HEIF decoder: ${error?.message || "Unknown import error."}`);
  }

  let output;
  try {
    output = await heic2any({
      blob: file,
      toType: "image/png"
    });
  } catch (error) {
    throw new Error(`HEIC/HEIF decode failed: ${error?.message || "Unknown decode error."}`);
  }

  if (output instanceof Blob) return output;
  if (Array.isArray(output) && output[0] instanceof Blob) return output[0];
  throw new Error("Unable to decode HEIC/HEIF image.");
}

function resolveFileBlob(entryOrFile) {
  const file = entryOrFile?.file instanceof Blob ? entryOrFile.file : entryOrFile;
  if (!(file instanceof Blob)) {
    throw new Error("Invalid image input.");
  }
  return file;
}

function resolveSourceType(entryOrFile) {
  if (entryOrFile && typeof entryOrFile === "object" && typeof entryOrFile.type === "string") {
    return entryOrFile.type;
  }

  const file = entryOrFile?.file instanceof Blob ? entryOrFile.file : entryOrFile;
  return file?.type || "";
}

async function drawViaImageElement(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Unsupported image format."));
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext("2d", { alpha: true, colorSpace: "srgb" });
    ctx.drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function drawToCanvas(file) {
  let sourceBlob = file;

  if (isHeicLike(file)) {
    sourceBlob = await decodeHeicBlob(file);
  }

  try {
    const bitmap = await createImageBitmap(sourceBlob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { alpha: true, colorSpace: "srgb" });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  } catch {
    // Fallback helps with formats createImageBitmap may skip on some browsers.
    return drawViaImageElement(sourceBlob);
  }
}

export async function drawImageToCanvas(entryOrFile) {
  const file = resolveFileBlob(entryOrFile);
  return drawToCanvas(file);
}

function normalizeOutputType(type) {
  if (!type || type === "image/heic" || type === "image/heif") return "image/jpeg";
  return type;
}

async function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function escapeXml(value) {
  return `${value}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image data for SVG conversion."));
    reader.onload = () => resolve(`${reader.result || ""}`);
    reader.readAsDataURL(blob);
  });
}

async function rasterCanvasToSvgBlob(canvas) {
  const pngBlob = await canvasToBlob(canvas, "image/png", 1);
  if (!pngBlob) {
    throw new Error("Unable to export image data for SVG conversion.");
  }

  const dataUrl = await blobToDataUrl(pngBlob);
  const width = Math.max(1, Math.round(canvas.width));
  const height = Math.max(1, Math.round(canvas.height));
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<image width="${width}" height="${height}" href="${escapeXml(dataUrl)}"/>`
    + `</svg>`;

  return new Blob([svg], { type: "image/svg+xml" });
}

async function exportFromCanvas(canvas, preferredTypes, quality) {
  for (const type of preferredTypes) {
    const blob = await canvasToBlob(canvas, type, quality);
    if (!blob) continue;

    // Some browsers silently fall back to PNG for unsupported output types.
    // Treat that as a miss unless PNG was explicitly requested.
    if (type !== "image/png" && blob.type === "image/png") continue;
    return blob;
  }

  const pngBlob = await canvasToBlob(canvas, "image/png", quality);
  if (pngBlob) return pngBlob;
  throw new Error("Image export failed for all supported browser output formats.");
}

function resolveCompressionStrategy(entry, options = {}) {
  const mode = options.mode || "balanced";
  const sourceType = normalizeOutputType(entry?.type || "");

  if (mode === "best-quality") {
    return {
      quality: 0.9,
      preferredTypes: [sourceType, "image/webp", "image/jpeg", "image/avif"]
    };
  }

  if (mode === "best-compression") {
    return {
      // Hard floor at 50% quality as a practical max-compression guardrail.
      quality: 0.5,
      preferredTypes: ["image/avif", "image/webp", "image/jpeg", sourceType, "image/png"]
    };
  }

  if (mode === "extreme-compression") {
    return {
      quality: 0.25,
      preferredTypes: ["image/avif", "image/webp", "image/jpeg", sourceType, "image/png"]
    };
  }

  return {
    quality: 0.75,
    preferredTypes: ["image/webp", "image/avif", "image/jpeg", sourceType, "image/png"]
  };
}

export function getCompressionRecommendation(entry) {
  const sourceType = normalizeOutputType(entry?.type || "");

  if (isLosslessMime(sourceType)) {
    return {
      format: "jpeg",
      reason: "JPEG is recommended for broad compatibility across apps and devices. WebP/AVIF may produce even smaller files when compatibility is not a concern."
    };
  }

  if (sourceType === "image/jpeg") {
    return {
      format: "webp",
      reason: "JPEG can often be reduced further by converting to WebP/AVIF at similar visual quality."
    };
  }

  if (sourceType === "image/webp") {
    return {
      format: "avif",
      reason: "WebP is efficient, but AVIF can still be smaller for many images."
    };
  }

  if (sourceType === "image/avif") {
    return {
      format: "avif",
      reason: "AVIF is already highly compressed. Use best compression mode for maximum size reduction."
    };
  }

  if (isLossyMime(sourceType)) {
    return {
      format: "webp",
      reason: "A modern lossy format like WebP/AVIF usually provides a better size-quality balance."
    };
  }

  return {
    format: "webp",
    reason: "WebP is a good default for balanced image compression."
  };
}

export async function compressImage(entryOrFile, options = {}) {
  const file = resolveFileBlob(entryOrFile);
  const sourceType = resolveSourceType(entryOrFile) || file.type;
  const canvas = await drawToCanvas(file);
  const strategy = resolveCompressionStrategy({ type: sourceType }, options);
  const quality = typeof options.quality === "number"
    ? Math.max(0.25, Math.min(1, options.quality))
    : strategy.quality;
  const preferred = strategy.preferredTypes;
  return exportFromCanvas(canvas, preferred, quality);
}

export async function cropImage(entryOrFile, rect) {
  const file = resolveFileBlob(entryOrFile);
  const sourceType = resolveSourceType(entryOrFile) || file.type;
  const source = await drawToCanvas(file);
  const safeRect = {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.max(1, Math.floor(rect.width)),
    height: Math.max(1, Math.floor(rect.height))
  };
  const canvas = document.createElement("canvas");
  canvas.width = safeRect.width;
  canvas.height = safeRect.height;
  const ctx = canvas.getContext("2d", { alpha: true, colorSpace: "srgb" });
  ctx.drawImage(
    source,
    safeRect.x,
    safeRect.y,
    safeRect.width,
    safeRect.height,
    0,
    0,
    safeRect.width,
    safeRect.height
  );
  const preferred = [normalizeOutputType(sourceType), "image/png", "image/jpeg"];
  return exportFromCanvas(canvas, preferred, 0.95);
}

export async function cropImageByNormalizedRect(entryOrFile, normalizedRect) {
  const source = await drawImageToCanvas(entryOrFile);
  const rect = {
    x: Math.round(source.width * normalizedRect.x),
    y: Math.round(source.height * normalizedRect.y),
    width: Math.round(source.width * normalizedRect.width),
    height: Math.round(source.height * normalizedRect.height)
  };

  const bounded = {
    x: Math.max(0, Math.min(rect.x, source.width - 1)),
    y: Math.max(0, Math.min(rect.y, source.height - 1)),
    width: Math.max(1, Math.min(rect.width, source.width - rect.x)),
    height: Math.max(1, Math.min(rect.height, source.height - rect.y))
  };

  return cropImage(entryOrFile, bounded);
}

export async function convertImage(entryOrFile, targetFormat = "webp", quality = 0.85) {
  const file = resolveFileBlob(entryOrFile);
  if (targetFormat === "svg") {
    if (isSvgLike(file)) {
      return file.slice(0, file.size, "image/svg+xml");
    }

    const canvas = await drawToCanvas(file);
    return rasterCanvasToSvgBlob(canvas);
  }

  const canvas = await drawToCanvas(file);
  const targetType = mimeFromFormat(targetFormat);
  const fallback = targetType === "image/jpeg" ? "image/webp" : "image/jpeg";
  return exportFromCanvas(canvas, [targetType, fallback], quality);
}
