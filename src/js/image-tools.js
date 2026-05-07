function mimeFromFormat(format) {
  switch (format) {
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

function isHeicLike(file) {
  const ext = extensionFromName(file?.name);
  return HEIC_MIME_TYPES.has(file?.type) || ext === "heic" || ext === "heif";
}

async function decodeHeicBlob(file) {
  const heic2any = (await import("heic2any")).default;
  const output = await heic2any({
    blob: file,
    toType: "image/png"
  });

  if (output instanceof Blob) return output;
  if (Array.isArray(output) && output[0] instanceof Blob) return output[0];
  throw new Error("Unable to decode HEIC/HEIF image.");
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
  const file = entryOrFile?.file instanceof Blob ? entryOrFile.file : entryOrFile;
  if (!(file instanceof Blob)) {
    throw new Error("Invalid image input.");
  }
  return drawToCanvas(file);
}

function normalizeOutputType(type) {
  if (!type || type === "image/heic" || type === "image/heif") return "image/jpeg";
  return type;
}

async function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
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

export async function compressImage(entry, options = {}) {
  const canvas = await drawToCanvas(entry.file);
  const strategy = resolveCompressionStrategy(entry, options);
  const quality = typeof options.quality === "number"
    ? Math.max(0.25, Math.min(1, options.quality))
    : strategy.quality;
  const preferred = strategy.preferredTypes;
  return exportFromCanvas(canvas, preferred, quality);
}

export async function cropImage(entry, rect) {
  const source = await drawToCanvas(entry.file);
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
  const preferred = [normalizeOutputType(entry.type), "image/png", "image/jpeg"];
  return exportFromCanvas(canvas, preferred, 0.95);
}

export async function cropImageByNormalizedRect(entry, normalizedRect) {
  const source = await drawToCanvas(entry.file);
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

  return cropImage(entry, bounded);
}

export async function convertImage(entry, targetFormat = "webp", quality = 0.85) {
  const canvas = await drawToCanvas(entry.file);
  const targetType = mimeFromFormat(targetFormat);
  const fallback = targetType === "image/jpeg" ? "image/webp" : "image/jpeg";
  return exportFromCanvas(canvas, [targetType, fallback], quality);
}
