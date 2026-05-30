import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { invokeWasm, loadWasmModule } from "./wasm-loader.js";

let pdfRuntimePromise;

async function getPdfRuntime() {
  if (pdfRuntimePromise) {
    return pdfRuntimePromise;
  }

  pdfRuntimePromise = (async () => {
    const pdfjs = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();

  return pdfRuntimePromise;
}

function mimeFromFormat(format) {
  switch (format) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function extFromFormat(format) {
  if (format === "jpg") return "jpeg";
  return format;
}

export async function mergePdfs(entries, onProgress = () => {}) {
  const out = await PDFDocument.create();

  for (let i = 0; i < entries.length; i += 1) {
    const sourceBytes = await entries[i].file.arrayBuffer();
    const source = await PDFDocument.load(sourceBytes);
    const pageIndices = source.getPageIndices();
    const pages = await out.copyPages(source, pageIndices);
    pages.forEach((page) => out.addPage(page));
    onProgress(Math.round(((i + 1) / entries.length) * 100));
  }

  const mergedBytes = await out.save();
  return new Blob([mergedBytes], { type: "application/pdf" });
}

function buildPerPageRanges(pageCount) {
  return Array.from({ length: pageCount }, (_, i) => [i, i]);
}

function parseCustomRanges(selection, pageCount) {
  if (!selection || !selection.trim()) {
    throw new Error("Enter page selections like 1-2,3,4-5.");
  }

  const tokens = selection
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!tokens.length) {
    throw new Error("Enter page selections like 1-2,3,4-5.");
  }

  return tokens.map((token) => {
    const match = token.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) {
      throw new Error(`Invalid page selection \"${token}\". Use numbers or ranges like 2-4.`);
    }

    let start = Number.parseInt(match[1], 10);
    let end = match[2] ? Number.parseInt(match[2], 10) : start;

    if (Number.isNaN(start) || Number.isNaN(end)) {
      throw new Error(`Invalid page selection \"${token}\".`);
    }

    if (start > end) {
      [start, end] = [end, start];
    }

    if (start < 1 || end > pageCount) {
      throw new Error(`Page selection \"${token}\" is out of range. This PDF has ${pageCount} pages.`);
    }

    return [start - 1, end - 1];
  });
}

function buildAllPagesRange(pageCount) {
  if (pageCount < 1) return [];
  return [[0, pageCount - 1]];
}

function expandRangesToIndices(ranges, pageCount, { dedupe = false } = {}) {
  const indices = [];
  const seen = new Set();

  for (const [start, end] of ranges) {
    for (let i = start; i <= end && i < pageCount; i += 1) {
      if (dedupe) {
        if (seen.has(i)) continue;
        seen.add(i);
      }
      indices.push(i);
    }
  }

  return indices;
}

function parseSelectionOrAll(selection, pageCount) {
  if (!selection || !selection.trim()) {
    return buildAllPagesRange(pageCount);
  }
  return parseCustomRanges(selection, pageCount);
}

export async function getPdfPageCount(entry) {
  const bytes = await entry.file.arrayBuffer();
  const source = await PDFDocument.load(bytes);
  return source.getPageCount();
}

export function summarizeCustomSplitSelection(selection, pageCount) {
  const ranges = parseCustomRanges(selection, pageCount);
  const pages = ranges.reduce((total, [start, end]) => total + (end - start + 1), 0);
  return {
    groups: ranges.length,
    pages
  };
}

export function buildAllPagesSelection(pageCount) {
  if (!Number.isFinite(pageCount) || pageCount < 1) return "";
  return Array.from({ length: pageCount }, (_, i) => `${i + 1}`).join(",");
}

export async function splitPdf(entry, options = {}, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const source = await PDFDocument.load(bytes);
  const pageCount = source.getPageCount();
  const mode = options.mode === "custom" || options.mode === "size" ? options.mode : "per-page";

  if (mode === "size") {
    const maxChunkMb = Number.parseFloat(options.maxChunkMb ?? "0");
    if (!Number.isFinite(maxChunkMb) || maxChunkMb <= 0) {
      throw new Error("Enter a split size greater than 0 MB.");
    }

    const maxBytes = Math.max(1, Math.floor(maxChunkMb * 1024 * 1024));
    const sourceIndices = source.getPageIndices();
    const results = [];
    let currentIndices = [];

    const buildChunk = async (indices) => {
      const target = await PDFDocument.create();
      const pages = await target.copyPages(source, indices);
      pages.forEach((page) => target.addPage(page));
      const outBytes = await target.save();
      return new Blob([outBytes], { type: "application/pdf" });
    };

    for (let i = 0; i < sourceIndices.length; i += 1) {
      const pageIndex = sourceIndices[i];
      const candidate = [...currentIndices, pageIndex];
      const candidateBlob = await buildChunk(candidate);

      if (currentIndices.length > 0 && candidateBlob.size > maxBytes) {
        const finalizedBlob = await buildChunk(currentIndices);
        results.push(finalizedBlob);
        currentIndices = [pageIndex];
      } else {
        currentIndices = candidate;
      }

      onProgress(Math.round(((i + 1) / sourceIndices.length) * 100));
    }

    if (currentIndices.length > 0) {
      results.push(await buildChunk(currentIndices));
    }

    if (!results.length) {
      throw new Error("No pages selected for splitting.");
    }

    return results;
  }

  const ranges = mode === "custom"
    ? parseCustomRanges(options.selection ?? "", pageCount)
    : buildPerPageRanges(pageCount);

  if (!ranges.length) {
    throw new Error("No pages selected for splitting.");
  }

  const results = [];

  for (let i = 0; i < ranges.length; i += 1) {
    const [start, end] = ranges[i];
    const target = await PDFDocument.create();
    const indices = [];
    for (let p = start; p <= end && p < source.getPageCount(); p += 1) {
      indices.push(p);
    }
    const pages = await target.copyPages(source, indices);
    pages.forEach((page) => target.addPage(page));
    results.push(new Blob([await target.save()], { type: "application/pdf" }));
    onProgress(Math.round(((i + 1) / ranges.length) * 100));
  }

  return results;
}

export async function extractPdfPages(entry, selection, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const source = await PDFDocument.load(bytes);
  const pageCount = source.getPageCount();
  const ranges = parseCustomRanges(selection ?? "", pageCount);
  const indices = expandRangesToIndices(ranges, pageCount, { dedupe: false });

  if (indices.length < 1) {
    throw new Error("No pages selected for extraction.");
  }

  const target = await PDFDocument.create();
  const pages = await target.copyPages(source, indices);
  pages.forEach((page, i) => {
    target.addPage(page);
    onProgress(Math.round(((i + 1) / pages.length) * 100));
  });

  return new Blob([await target.save()], { type: "application/pdf" });
}

export async function removePdfPages(entry, selection, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const source = await PDFDocument.load(bytes);
  const pageCount = source.getPageCount();
  const ranges = parseCustomRanges(selection ?? "", pageCount);
  const removeSet = new Set(expandRangesToIndices(ranges, pageCount, { dedupe: true }));
  const keepIndices = source.getPageIndices().filter((index) => !removeSet.has(index));

  if (keepIndices.length < 1) {
    throw new Error("Cannot remove all pages. Keep at least one page.");
  }

  const target = await PDFDocument.create();
  const pages = await target.copyPages(source, keepIndices);
  pages.forEach((page, i) => {
    target.addPage(page);
    onProgress(Math.round(((i + 1) / pages.length) * 100));
  });

  return new Blob([await target.save()], { type: "application/pdf" });
}

export async function rotatePdfPages(entry, selection, angle = 90, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const doc = await PDFDocument.load(bytes);
  const pageCount = doc.getPageCount();
  const ranges = parseSelectionOrAll(selection ?? "", pageCount);
  const indices = expandRangesToIndices(ranges, pageCount, { dedupe: true });

  if (indices.length < 1) {
    throw new Error("No pages selected for rotation.");
  }

  const normalizedAngle = Number.parseInt(angle, 10);
  if (![90, 180, 270].includes(normalizedAngle)) {
    throw new Error("Rotation angle must be 90, 180, or 270.");
  }

  for (let i = 0; i < indices.length; i += 1) {
    const page = doc.getPage(indices[i]);
    const current = page.getRotation()?.angle ?? 0;
    page.setRotation(degrees((current + normalizedAngle) % 360));
    onProgress(Math.round(((i + 1) / indices.length) * 100));
  }

  return new Blob([await doc.save()], { type: "application/pdf" });
}

export async function cropPdfPages(entry, options = {}, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const doc = await PDFDocument.load(bytes);
  const pageCount = doc.getPageCount();
  const ranges = parseSelectionOrAll(options.selection ?? "", pageCount);
  const indices = expandRangesToIndices(ranges, pageCount, { dedupe: true });

  if (indices.length < 1) {
    throw new Error("No pages selected for cropping.");
  }

  const marginTop = Math.max(0, Number.parseFloat(options.top ?? 0) || 0);
  const marginRight = Math.max(0, Number.parseFloat(options.right ?? 0) || 0);
  const marginBottom = Math.max(0, Number.parseFloat(options.bottom ?? 0) || 0);
  const marginLeft = Math.max(0, Number.parseFloat(options.left ?? 0) || 0);

  for (let i = 0; i < indices.length; i += 1) {
    const page = doc.getPage(indices[i]);
    const width = page.getWidth();
    const height = page.getHeight();

    const cropWidth = width - marginLeft - marginRight;
    const cropHeight = height - marginTop - marginBottom;

    if (cropWidth <= 2 || cropHeight <= 2) {
      throw new Error("Crop margins are too large for at least one selected page.");
    }

    page.setCropBox(marginLeft, marginBottom, cropWidth, cropHeight);
    onProgress(Math.round(((i + 1) / indices.length) * 100));
  }

  return new Blob([await doc.save()], { type: "application/pdf" });
}

function numberingPositionCoords(page, textWidth, fontSize, position, margin) {
  const width = page.getWidth();
  const height = page.getHeight();

  const leftX = margin;
  const centerX = Math.max(margin, (width - textWidth) / 2);
  const rightX = Math.max(margin, width - textWidth - margin);
  const topY = Math.max(margin, height - fontSize - margin);
  const middleY = Math.max(margin, (height - fontSize) / 2);
  const bottomY = margin;

  switch (position) {
    case "top-left":
      return { x: leftX, y: topY };
    case "top-right":
      return { x: rightX, y: topY };
    case "middle-center":
      return { x: centerX, y: middleY };
    case "bottom-left":
      return { x: leftX, y: bottomY };
    case "bottom-right":
      return { x: rightX, y: bottomY };
    case "bottom-center":
    default:
      return { x: centerX, y: bottomY };
  }
}

export async function addPdfPageNumbers(entry, options = {}, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const doc = await PDFDocument.load(bytes);
  const pageCount = doc.getPageCount();

  const selection = options.selection ?? "";
  const ranges = parseSelectionOrAll(selection, pageCount);
  const indices = expandRangesToIndices(ranges, pageCount, { dedupe: true });
  if (indices.length < 1) {
    throw new Error("No pages selected for numbering.");
  }

  const startNumber = Number.parseInt(options.startNumber ?? "1", 10);
  if (!Number.isFinite(startNumber) || startNumber < 1) {
    throw new Error("Start number must be 1 or greater.");
  }

  const fontSize = Number.parseInt(options.fontSize ?? "12", 10);
  const margin = Number.parseInt(options.margin ?? "20", 10);
  const position = options.position ?? "bottom-center";
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < indices.length; i += 1) {
    const page = doc.getPage(indices[i]);
    const label = `${startNumber + i}`;
    const textWidth = font.widthOfTextAtSize(label, fontSize);
    const coords = numberingPositionCoords(page, textWidth, fontSize, position, margin);

    page.drawText(label, {
      x: coords.x,
      y: coords.y,
      size: fontSize,
      font,
      color: rgb(0.16, 0.16, 0.16)
    });

    onProgress(Math.round(((i + 1) / indices.length) * 100));
  }

  return new Blob([await doc.save()], { type: "application/pdf" });
}

function sanitizeHeaderFooterText(value, label, maxLength = 120) {
  const text = `${value ?? ""}`.trim();
  if (!text) return "";
  if (text.length > maxLength) {
    throw new Error(`${label} is too long. Keep it under ${maxLength} characters.`);
  }
  return text;
}

function headerFooterPresetText(preset, options, pageIndex, totalPages) {
  const date = new Date().toISOString().slice(0, 10);
  const headerText = sanitizeHeaderFooterText(options.headerText, "Header text");
  const footerText = sanitizeHeaderFooterText(options.footerText, "Footer text");

  if (preset === "confidential") {
    return {
      header: "CONFIDENTIAL",
      footer: `Page ${pageIndex + 1} of ${totalPages}`
    };
  }

  if (preset === "page-date") {
    return {
      header: headerText || `${options.fileName || "Document"}`,
      footer: `${date} • Page ${pageIndex + 1}`
    };
  }

  if (preset === "custom") {
    if (!headerText && !footerText) {
      throw new Error("Custom header/footer preset requires header text or footer text.");
    }
    return {
      header: headerText,
      footer: footerText
    };
  }

  return {
    header: headerText || `${options.fileName || "Document"}`,
    footer: footerText || `Page ${pageIndex + 1} of ${totalPages}`
  };
}

export async function addPdfHeaderFooter(entry, options = {}, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const doc = await PDFDocument.load(bytes);
  const pageCount = doc.getPageCount();
  const ranges = parseSelectionOrAll(options.selection ?? "", pageCount);
  const indices = expandRangesToIndices(ranges, pageCount, { dedupe: true });
  if (indices.length < 1) {
    throw new Error("No pages selected for header/footer.");
  }

  const preset = `${options.preset || "standard"}`;
  if (!["standard", "confidential", "page-date", "custom"].includes(preset)) {
    throw new Error(`Unsupported header/footer preset: ${preset}.`);
  }

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = Math.min(18, Math.max(8, Number.parseInt(options.fontSize ?? "10", 10) || 10));
  const margin = Math.min(120, Math.max(8, Number.parseInt(options.margin ?? "20", 10) || 20));
  const color = rgb(0.2, 0.2, 0.2);

  for (let i = 0; i < indices.length; i += 1) {
    const page = doc.getPage(indices[i]);
    const text = headerFooterPresetText(preset, {
      headerText: options.headerText,
      footerText: options.footerText,
      fileName: entry.name
    }, i, indices.length);

    if (text.header) {
      const w = font.widthOfTextAtSize(text.header, fontSize);
      page.drawText(text.header, {
        x: Math.max(margin, (page.getWidth() - w) / 2),
        y: Math.max(margin, page.getHeight() - margin - fontSize),
        size: fontSize,
        font,
        color
      });
    }

    if (text.footer) {
      const w = font.widthOfTextAtSize(text.footer, fontSize);
      page.drawText(text.footer, {
        x: Math.max(margin, (page.getWidth() - w) / 2),
        y: margin,
        size: fontSize,
        font,
        color
      });
    }

    onProgress(Math.round(((i + 1) / indices.length) * 100));
  }

  return new Blob([await doc.save()], { type: "application/pdf" });
}

function normalizeMetadataField(value, label, maxLength = 256) {
  const text = `${value ?? ""}`.trim();
  if (!text) return "";
  if (text.length > maxLength) {
    throw new Error(`${label} is too long. Keep it under ${maxLength} characters.`);
  }
  return text;
}

function normalizeMetadataKeywords(value) {
  const text = `${value ?? ""}`.trim();
  if (!text) return [];

  const tokens = text
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (tokens.length > 32) {
    throw new Error("Too many keywords. Keep it to 32 or fewer.");
  }

  for (const token of tokens) {
    if (token.length > 64) {
      throw new Error("Each keyword must be 64 characters or fewer.");
    }
  }

  return tokens;
}

export async function applyPdfMetadata(entry, metadata = {}, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const doc = await PDFDocument.load(bytes);

  const title = normalizeMetadataField(metadata.title, "Title");
  const author = normalizeMetadataField(metadata.author, "Author");
  const subject = normalizeMetadataField(metadata.subject, "Subject");
  const keywords = normalizeMetadataKeywords(metadata.keywords);

  onProgress(35);

  doc.setTitle(title);
  doc.setAuthor(author);
  doc.setSubject(subject);
  doc.setKeywords(keywords);

  const out = await doc.save();
  onProgress(100);
  return new Blob([out], { type: "application/pdf" });
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function parseImageRotation(value) {
  const parsed = Number.parseFloat(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolvePlacementForPage(placementByPage, pageNum) {
  if (!placementByPage || typeof placementByPage !== "object") return null;
  const direct = placementByPage[pageNum];
  if (direct) return direct;
  const stringKey = placementByPage[String(pageNum)];
  if (stringKey) return stringKey;
  return null;
}

function resolveImageExt(file) {
  const type = `${file?.type || ""}`.toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";

  const name = `${file?.name || ""}`.toLowerCase();
  if (name.endsWith(".png")) return "png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpg";
  return "";
}

function parseHexColor(value) {
  const input = `${value || ""}`.trim();
  const normalized = input.startsWith("#") ? input.slice(1) : input;

  if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
    const r = Number.parseInt(`${normalized[0]}${normalized[0]}`, 16) / 255;
    const g = Number.parseInt(`${normalized[1]}${normalized[1]}`, 16) / 255;
    const b = Number.parseInt(`${normalized[2]}${normalized[2]}`, 16) / 255;
    return rgb(r, g, b);
  }

  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
    const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
    const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
    return rgb(r, g, b);
  }

  return rgb(0.42, 0.42, 0.42);
}

function textWatermarkPositionCoords(page, textWidth, fontSize, position, margin) {
  const width = page.getWidth();
  const height = page.getHeight();

  const leftX = margin;
  const centerX = Math.max(margin, (width - textWidth) / 2);
  const rightX = Math.max(margin, width - textWidth - margin);
  const topY = Math.max(margin, height - fontSize - margin);
  const middleY = Math.max(margin, (height - fontSize) / 2);
  const bottomY = margin;

  switch (position) {
    case "top-left":
      return { x: leftX, y: topY };
    case "top-center":
      return { x: centerX, y: topY };
    case "top-right":
      return { x: rightX, y: topY };
    case "bottom-left":
      return { x: leftX, y: bottomY };
    case "bottom-right":
      return { x: rightX, y: bottomY };
    case "bottom-center":
      return { x: centerX, y: bottomY };
    case "center":
    default:
      return { x: centerX, y: middleY };
  }
}

export async function addPdfImageWatermark(entry, imageFile, options = {}, onProgress = () => {}) {
  if (!(imageFile instanceof Blob)) {
    throw new Error("Pick a PNG or JPEG image to place on the PDF.");
  }

  const pdfBytes = await entry.file.arrayBuffer();
  const doc = await PDFDocument.load(pdfBytes);
  const pageCount = doc.getPageCount();

  const ranges = parseSelectionOrAll(options.selection ?? "", pageCount);
  const indices = expandRangesToIndices(ranges, pageCount, { dedupe: true });
  if (indices.length < 1) {
    throw new Error("No pages selected for watermark placement.");
  }

  const imageBytes = await imageFile.arrayBuffer();
  const imageExt = resolveImageExt(imageFile);
  if (!imageExt) {
    throw new Error("Only PNG and JPEG watermark images are supported.");
  }

  const embeddedImage = imageExt === "png"
    ? await doc.embedPng(imageBytes)
    : await doc.embedJpg(imageBytes);

  const defaultPlacement = options.defaultPlacement || {};
  const defaultOpacity = clampNumber(Number.parseFloat(options.defaultOpacity ?? 1), 0, 1);
  const defaultRotation = parseImageRotation(options.defaultRotation ?? 0);
  const placementByPage = options.placementByPage || {};

  for (let i = 0; i < indices.length; i += 1) {
    const pageIndex = indices[i];
    const pageNum = pageIndex + 1;
    const page = doc.getPage(pageIndex);
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();

    const pagePlacement = resolvePlacementForPage(placementByPage, pageNum) || defaultPlacement;

    const widthNorm = clampNumber(Number.parseFloat(pagePlacement.width ?? 0.22), 0.02, 1);
    const heightNorm = clampNumber(Number.parseFloat(pagePlacement.height ?? 0.12), 0.02, 1);
    const leftNorm = clampNumber(Number.parseFloat(pagePlacement.x ?? 0.74), 0, 1 - widthNorm);
    const topNorm = clampNumber(Number.parseFloat(pagePlacement.y ?? 0.84), 0, 1 - heightNorm);

    const drawWidth = widthNorm * pageWidth;
    const drawHeight = heightNorm * pageHeight;
    const drawX = leftNorm * pageWidth;
    const drawYTop = topNorm * pageHeight;
    const drawY = pageHeight - drawYTop - drawHeight;

    const opacity = clampNumber(Number.parseFloat(pagePlacement.opacity ?? defaultOpacity), 0, 1);
    const rotation = parseImageRotation(pagePlacement.rotation ?? defaultRotation);

    page.drawImage(embeddedImage, {
      x: drawX,
      y: drawY,
      width: drawWidth,
      height: drawHeight,
      opacity,
      rotate: degrees(rotation)
    });

    onProgress(Math.round(((i + 1) / indices.length) * 100));
  }

  return new Blob([await doc.save()], { type: "application/pdf" });
}

export async function addPdfTextWatermark(entry, options = {}, onProgress = () => {}) {
  const label = `${options.text || ""}`.trim();
  if (!label) {
    throw new Error("Enter watermark text before applying.");
  }

  const pdfBytes = await entry.file.arrayBuffer();
  const doc = await PDFDocument.load(pdfBytes);
  const pageCount = doc.getPageCount();

  const ranges = parseSelectionOrAll(options.selection ?? "", pageCount);
  const indices = expandRangesToIndices(ranges, pageCount, { dedupe: true });
  if (indices.length < 1) {
    throw new Error("No pages selected for text watermark placement.");
  }

  const requestedFontSize = clampNumber(Number.parseFloat(options.fontSize ?? 40), 8, 240);
  const opacity = clampNumber(Number.parseFloat(options.opacity ?? 0.25), 0, 1);
  const rotation = parseImageRotation(options.rotation ?? -28);
  const margin = clampNumber(Number.parseFloat(options.margin ?? 24), 0, 200);
  const position = `${options.position || "center"}`;
  const color = parseHexColor(options.colorHex ?? "#6b7280");
  const font = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let i = 0; i < indices.length; i += 1) {
    const page = doc.getPage(indices[i]);
    const maxWidth = Math.max(20, page.getWidth() - margin * 2);
    const measuredWidth = font.widthOfTextAtSize(label, requestedFontSize);
    const scale = measuredWidth > maxWidth ? maxWidth / measuredWidth : 1;
    const drawSize = requestedFontSize * scale;
    const drawWidth = font.widthOfTextAtSize(label, drawSize);
    const coords = textWatermarkPositionCoords(page, drawWidth, drawSize, position, margin);

    page.drawText(label, {
      x: coords.x,
      y: coords.y,
      size: drawSize,
      font,
      color,
      opacity,
      rotate: degrees(rotation)
    });

    onProgress(Math.round(((i + 1) / indices.length) * 100));
  }

  return new Blob([await doc.save()], { type: "application/pdf" });
}

export async function compressPdf(entry, _quality = 0.75, onProgress = () => {}) {
  onProgress(30);
  const bytes = await entry.file.arrayBuffer();

  const wasmCompressed = await invokeWasm("pdf", "wasmCompressPDF", new Uint8Array(bytes), Math.round(_quality * 100));
  if (wasmCompressed instanceof Uint8Array) {
    onProgress(100);
    return new Blob([wasmCompressed], { type: "application/pdf" });
  }

  const doc = await PDFDocument.load(bytes);
  onProgress(70);

  // Placeholder strategy: re-save document for structural cleanup.
  const compressed = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  onProgress(100);
  return new Blob([compressed], { type: "application/pdf" });
}

const PDFA_PROFILES = new Set(["pdfa-1b", "pdfa-2b", "pdfa-3b"]);

export async function exportPdfA(entry, options = {}, onProgress = () => {}, runtimeOptions = {}) {
  const profile = `${options.profile || "pdfa-2b"}`.toLowerCase();
  if (!PDFA_PROFILES.has(profile)) {
    throw new Error(`Unsupported PDF/A profile: ${profile}.`);
  }

  const moduleLoader = typeof runtimeOptions?.moduleLoader === "function" ? runtimeOptions.moduleLoader : loadWasmModule;
  const exportFn = typeof runtimeOptions?.exportFn === "function" ? runtimeOptions.exportFn : globalThis.wasmExportPDFA;

  onProgress(10);
  const bytes = new Uint8Array(await entry.file.arrayBuffer());
  onProgress(35);

  const mod = await moduleLoader("pdf");
  if (!mod || typeof exportFn !== "function") {
    const err = new Error(
      "PDF/A export is not available in this build. Rebuild the PDF WASM module and refresh."
    );
    err.exportStatus = "limited";
    err.exportCode = "pdfa_unavailable";
    throw err;
  }

  let result;
  try {
    result = exportFn(bytes, profile);
  } catch (e) {
    throw new Error(`PDF/A export failed: ${e?.message ?? e}`);
  }

  if (result instanceof Error) {
    throw new Error(`PDF/A export failed: ${result.message}`);
  }

  if (!(result instanceof Uint8Array)) {
    throw new Error("PDF/A export produced unexpected output.");
  }

  onProgress(100);
  return new Blob([result], { type: "application/pdf" });
}

export async function pdfToImages(entry, format = "png", onProgress = () => {}) {
  const { getDocument } = await getPdfRuntime();
  const bytes = await entry.file.arrayBuffer();
  const loadingTask = getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const results = [];
  const ext = extFromFormat(format);
  const mime = mimeFromFormat(ext);

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.8 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.9));
    if (blob) {
      results.push({
        name: `${entry.name.replace(/\.pdf$/i, "")}-page-${pageNum}.${ext}`,
        blob
      });
    }
    onProgress(Math.round((pageNum / pdf.numPages) * 100));
  }

  return results;
}

export async function renderPdfPreviewPage(entry, options = {}) {
  const { getDocument } = await getPdfRuntime();
  const bytes = await entry.file.arrayBuffer();
  const loadingTask = getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const requestedPage = Number.parseInt(options.page ?? "1", 10);
  const pageNum = Math.max(1, Math.min(totalPages, Number.isFinite(requestedPage) ? requestedPage : 1));
  const scale = Number.isFinite(options.scale) ? options.scale : 1.2;

  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  return {
    page: pageNum,
    totalPages,
    width: canvas.width,
    height: canvas.height,
    dataUrl: canvas.toDataURL("image/png")
  };
}

export async function reorderPdfPages(entry, orderedPages, onProgress = () => {}) {
  const bytes = await entry.file.arrayBuffer();
  const source = await PDFDocument.load(bytes);
  const pageCount = source.getPageCount();

  if (!Array.isArray(orderedPages) || orderedPages.length !== pageCount) {
    throw new Error("Page order must include every page exactly once.");
  }

  const indices = orderedPages.map((pageNum) => {
    const parsed = Number.parseInt(pageNum, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > pageCount) {
      throw new Error(`Invalid page number in order: ${pageNum}.`);
    }
    return parsed - 1;
  });

  const unique = new Set(indices);
  if (unique.size !== pageCount) {
    throw new Error("Page order must not contain duplicates.");
  }

  const out = await PDFDocument.create();
  const pages = await out.copyPages(source, indices);
  pages.forEach((page, i) => {
    out.addPage(page);
    onProgress(Math.round(((i + 1) / pages.length) * 100));
  });

  return new Blob([await out.save()], { type: "application/pdf" });
}

// ---------------------------------------------------------------------------
// PDF Unlocker
// ---------------------------------------------------------------------------

/**
 * Attempt to unlock / remove restrictions from a PDF.
 *
 * Strategy:
 *  1. Try pdf-lib load → if it succeeds the PDF has no user-password (only
 *     owner restrictions at most).  Re-saving strips the encryption metadata.
 *  2. If pdf-lib throws (user-password protected), fall through to pdfjs which
 *     can decrypt with a supplied password.  Each page is rendered to Canvas
 *     and embedded as a PNG image in a new, unrestricted pdf-lib PDF.
 *
 * @param {import("../js/detect.js").EnrichedFile} entry
 * @param {string} [password=""]  User password (leave empty to try without)
 * @param {(n: number) => void}   [onProgress]
 * @returns {Promise<Blob>}  Unlocked PDF blob
 */
export async function unlockPdf(entry, password = "", onProgress = () => {}, options = {}) {
  const forceRuntime = options?.forceRuntime === true;
  const runtimeOverride = options?.runtime || null;
  const createCanvas =
    typeof options?.createCanvas === "function"
      ? options.createCanvas
      : () => {
          if (typeof document === "undefined") {
            throw new Error("Unlock runtime requires a browser canvas context.");
          }
          return document.createElement("canvas");
        };
  const fetchImpl = typeof options?.fetch === "function" ? options.fetch : fetch;

  const bytes = await entry.file.arrayBuffer();

  // ── Strategy 1: pdf-lib (owner-restricted or unprotected) ──────────────
  if (!forceRuntime) {
    try {
      const doc = await PDFDocument.load(bytes);
      onProgress(90);
      const out = await doc.save();
      onProgress(100);
      return new Blob([out], { type: "application/pdf" });
    } catch (e) {
      // If pdf-lib fails for any reason other than password protection,
      // still try the pdfjs path, which is more permissive.
    }
  }

  // ── Strategy 2: pdfjs with password → render → re-create ───────────────
  const { getDocument } = runtimeOverride || (await getPdfRuntime());
  onProgress(5);

  const loadOptions = { data: new Uint8Array(bytes) };
  if (password) loadOptions.password = password;

  let pdf;
  try {
    pdf = await getDocument(loadOptions).promise;
  } catch (e) {
    if (e && e.name === "PasswordException") {
      if (!password) {
        throw Object.assign(new Error("This PDF is password-protected. Enter the password to unlock it."), { needsPassword: true });
      }
      throw new Error("Incorrect password. Please try again.");
    }
    throw new Error(`Could not open PDF: ${e?.message ?? e}`);
  }

  const newDoc = await PDFDocument.create();

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onProgress(Math.round(5 + (pageNum / pdf.numPages) * 85));

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas();
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
    if (!ctx) {
      throw new Error("Unlock runtime could not create a 2D canvas context.");
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const pngDataUrl = canvas.toDataURL("image/png");
    const pngResponse = await fetchImpl(pngDataUrl);
    const pngBytes = await pngResponse.arrayBuffer();
    const pngImage = await newDoc.embedPng(pngBytes);

    // Logical page size = half of the 2× canvas (original viewport)
    const logW = viewport.width / 2;
    const logH = viewport.height / 2;
    const newPage = newDoc.addPage([logW, logH]);
    newPage.drawImage(pngImage, { x: 0, y: 0, width: logW, height: logH });
  }

  onProgress(95);
  const out = await newDoc.save();
  onProgress(100);
  return new Blob([out], { type: "application/pdf" });
}

/**
 * Encrypt a PDF with a password using the Go/WASM pdfcpu backend.
 *
 * @param {import("../js/detect.js").EnrichedFile} entry
 * @param {string} password
 * @param {(n: number) => void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function lockPdf(entry, password, onProgress = () => {}) {
  const trimmed = `${password ?? ""}`.trim();
  if (!trimmed) {
    throw new Error("Enter a password to lock this PDF.");
  }

  onProgress(10);
  const bytes = new Uint8Array(await entry.file.arrayBuffer());
  onProgress(35);

  // Load the module explicitly so we can distinguish "module unavailable"
  // from "encryption failed" and surface the real pdfcpu error to the user.
  const mod = await loadWasmModule("pdf");
  if (!mod) {
    throw new Error(
      "PDF lock requires the WASM PDF module, which could not be loaded. " +
      "Run \`npm run build:wasm\` to build it, then refresh."
    );
  }

  const fn = typeof globalThis.wasmLockPDF === "function" ? globalThis.wasmLockPDF : null;
  if (!fn) {
    throw new Error(
      "wasmLockPDF is not registered. " +
      "Run \`npm run build:wasm\` to rebuild the PDF WASM module, then refresh."
    );
  }

  let result;
  try {
    result = fn(bytes, trimmed);
  } catch (e) {
    throw new Error(`PDF encryption failed: ${e?.message ?? e}`);
  }

  if (result instanceof Error) {
    throw new Error(`PDF encryption failed: ${result.message}`);
  }

  if (!(result instanceof Uint8Array)) {
    throw new Error("PDF encryption produced unexpected output.");
  }

  onProgress(100);
  return new Blob([result], { type: "application/pdf" });
}

/**
 * Attempt to repair a potentially malformed PDF.
 *
 * Outcomes:
 * - unchanged: input parses with pdf-lib, no structural recovery needed.
 * - repaired: recovered by re-rendering pages via pdf.js into a fresh PDF.
 * - unrecoverable: cannot be opened/recovered safely.
 *
 * @param {import("../js/detect.js").EnrichedFile} entry
 * @param {(n: number) => void} [onProgress]
 * @returns {Promise<{ blob: Blob, status: "unchanged" | "repaired", note: string, method: string }>}
 */
export async function repairPdf(entry, onProgress = () => {}, options = {}) {
  const forceRuntime = options?.forceRuntime === true;
  const runtimeOverride = options?.runtime || null;
  const createCanvas =
    typeof options?.createCanvas === "function"
      ? options.createCanvas
      : () => {
          if (typeof document === "undefined") {
            throw new Error("Repair runtime requires a browser canvas context.");
          }
          return document.createElement("canvas");
        };
  const fetchImpl = typeof options?.fetch === "function" ? options.fetch : fetch;

  const bytes = await entry.file.arrayBuffer();

  // Fast path: if pdf-lib can parse it, treat as structurally healthy.
  if (!forceRuntime) {
    try {
      await PDFDocument.load(bytes);
      onProgress(100);
      return {
        blob: new Blob([bytes], { type: "application/pdf" }),
        status: "unchanged",
        note: "No structural repair was required.",
        method: "validation"
      };
    } catch {
      // Continue to recovery path.
    }
  }

  onProgress(10);

  let getDocument;
  try {
    ({ getDocument } = runtimeOverride || (await getPdfRuntime()));
  } catch (e) {
    const err = new Error(`PDF recovery runtime unavailable: ${e?.message ?? e}`);
    err.repairStatus = "unrecoverable";
    throw err;
  }
  let pdf;
  try {
    pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  } catch (e) {
    if (e && e.name === "PasswordException") {
      const err = new Error("This PDF is password-protected. Unlock it first, then run repair.");
      err.repairStatus = "unrecoverable";
      throw err;
    }
    const err = new Error(`PDF could not be recovered: ${e?.message ?? e}`);
    err.repairStatus = "unrecoverable";
    throw err;
  }

  const repaired = await PDFDocument.create();
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    onProgress(Math.round(10 + (pageNum / Math.max(1, pdf.numPages)) * 80));

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas();
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
    if (!ctx) {
      const err = new Error("Repair runtime could not create a 2D canvas context.");
      err.repairStatus = "unrecoverable";
      throw err;
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const pngDataUrl = canvas.toDataURL("image/png");
    const pngResponse = await fetchImpl(pngDataUrl);
    const pngBytes = await pngResponse.arrayBuffer();
    const pngImage = await repaired.embedPng(pngBytes);

    const logicalWidth = viewport.width / 2;
    const logicalHeight = viewport.height / 2;
    const repairedPage = repaired.addPage([logicalWidth, logicalHeight]);
    repairedPage.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: logicalWidth,
      height: logicalHeight
    });
  }

  onProgress(95);
  const out = await repaired.save();
  onProgress(100);

  return {
    blob: new Blob([out], { type: "application/pdf" }),
    status: "repaired",
    note: "Recovered by rasterizing pages into a clean PDF. Searchable text may be reduced.",
    method: "raster-rebuild"
  };
}

/**
 * OCR pilot entrypoint.
 *
 * This function intentionally reports a limited status when an OCR engine is
 * not bundled or not enabled, so users get explicit guidance instead of a
 * silent failure.
 */
export async function ocrPdfPilot(entry, options = {}, onProgress = () => {}) {
  const language = `${options.language || "eng"}`;
  const strategy = `${options.strategy || "searchable-overlay"}`;

  onProgress(8);
  const bytes = await entry.file.arrayBuffer();

  let pageCount = 0;
  try {
    const { getDocument } = await getPdfRuntime();
    const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
    pageCount = pdf.numPages || 0;
  } catch {
    onProgress(100);
    return {
      status: "limited",
      language,
      strategy,
      pageCount,
      note: "OCR runtime is unavailable in this environment. The OCR pilot is currently disabled."
    };
  }

  onProgress(100);
  return {
    status: "limited",
    language,
    strategy,
    pageCount,
    note: "OCR engine is not bundled in this build yet. Pilot entrypoint is active with explicit capability messaging."
  };
}
