import { PDFDocument } from "pdf-lib";

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

/**
 * Parse width/height from an SVG string.
 * Falls back to viewBox, then to sensible defaults.
 */
export function parseSvgDimensions(svgString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svg = doc.documentElement;

  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }

  const w = parseFloat(svg.getAttribute("width")) || 800;
  const h = parseFloat(svg.getAttribute("height")) || 600;
  return { width: w, height: h };
}

/**
 * Convert an SVG string to a PNG Blob via Canvas.
 * @param {string} svgString
 * @param {number} naturalWidth  – logical width  (SVG coordinate units)
 * @param {number} naturalHeight – logical height (SVG coordinate units)
 * @param {number} [scale=2]    – pixel-ratio for crisp output
 */
export async function svgToPngBlob(svgString, naturalWidth, naturalHeight, scale = 2) {
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(naturalWidth * scale);
    canvas.height = Math.ceil(naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, naturalWidth, naturalHeight);
    ctx.drawImage(img, 0, 0, naturalWidth, naturalHeight);
    return canvasToBlob(canvas, "image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// HTML element → PNG  (used for KaTeX preview capture)
// ---------------------------------------------------------------------------

/**
 * Serialize an HTML element to a PNG Blob via SVG foreignObject.
 * Inlines all accessible CSS so the canvas render matches the page.
 *
 * Note: Custom web-fonts (e.g. KaTeX fonts) must already be loaded by the
 * browser; `document.fonts.ready` is awaited before capturing.
 */
export async function elementToPngBlob(element, scale = 2) {
  await document.fonts.ready;

  const rect = element.getBoundingClientRect();
  const w = Math.max(Math.ceil(rect.width), 10);
  const h = Math.max(Math.ceil(rect.height), 10);

  // Collect all accessible CSS rules from loaded stylesheets
  let cssText = "";
  for (const sheet of document.styleSheets) {
    try {
      cssText += Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("\n");
    } catch {
      /* cross-origin sheet – skip */
    }
  }

  const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><style>* { box-sizing: border-box; } ${cssText}</style></defs>
  <foreignObject x="0" y="0" width="${w}" height="${h}">
    <div xmlns="http://www.w3.org/1999/xhtml"
         style="width:${w}px;height:${h}px;overflow:hidden;background:white;padding:0;margin:0;">
      ${element.outerHTML}
    </div>
  </foreignObject>
</svg>`;

  return svgToPngBlob(svgString, w, h, scale);
}

// ---------------------------------------------------------------------------
// PNG Blob → single-page A4 PDF
// ---------------------------------------------------------------------------

/**
 * Embed a PNG Blob into a new single-page A4 PDF (via pdf-lib).
 * The image is centred and scaled to fit with a 40pt margin.
 *
 * @param {Blob} pngBlob
 * @returns {Promise<Blob>} PDF Blob
 */
export async function pngBlobToPdf(pngBlob) {
  const pdfDoc = await PDFDocument.create();
  const pngBytes = await pngBlob.arrayBuffer();
  const pngImage = await pdfDoc.embedPng(pngBytes);

  const pageW = 595.28; // A4 width  (points)
  const pageH = 841.89; // A4 height (points)
  const margin = 40;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;

  const scale = Math.min(maxW / pngImage.width, maxH / pngImage.height, 1);
  const drawW = pngImage.width * scale;
  const drawH = pngImage.height * scale;

  const page = pdfDoc.addPage([pageW, pageH]);
  page.drawImage(pngImage, {
    x: (pageW - drawW) / 2,
    y: (pageH - drawH) / 2,
    width: drawW,
    height: drawH
  });

  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: "application/pdf" });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))), type);
  });
}

// ---------------------------------------------------------------------------
// Multi-page PDF from a tall DOM element
// ---------------------------------------------------------------------------

/**
 * Capture a DOM element and lay it out across multiple A4 pages in a PDF.
 *
 * The element is captured at 1× scale via `elementToPngBlob`.  The resulting
 * tall image is then split into A4-height strips which each become one PDF page.
 *
 * @param {HTMLElement} element
 * @returns {Promise<Blob>} Multi-page PDF blob
 */
export async function elementToMultiPagePdf(element) {
  const fullPng = await elementToPngBlob(element, 1);

  const url = URL.createObjectURL(fullPng);
  let img;
  try {
    img = await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  // A4 proportions at the element's pixel width
  const A4_RATIO = 841.89 / 595.28;
  const pageHeightPx = Math.floor(img.naturalWidth * A4_RATIO);
  const totalHeight = img.naturalHeight;
  const numPages = Math.max(1, Math.ceil(totalHeight / pageHeightPx));

  const pdfDoc = await PDFDocument.create();

  for (let i = 0; i < numPages; i++) {
    const srcY = i * pageHeightPx;
    const srcH = Math.min(pageHeightPx, totalHeight - srcY);

    const slice = document.createElement("canvas");
    slice.width = img.naturalWidth;
    slice.height = srcH;
    const ctx = slice.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(img, 0, -srcY);

    const sliceBlob = await canvasToBlob(slice, "image/png");
    const sliceBytes = await sliceBlob.arrayBuffer();
    const pngImage = await pdfDoc.embedPng(sliceBytes);

    // Scale image to A4 width, keeping aspect ratio for this strip
    const scale = 595.28 / img.naturalWidth;
    const page = pdfDoc.addPage([595.28, srcH * scale]);
    page.drawImage(pngImage, { x: 0, y: 0, width: 595.28, height: srcH * scale });
  }

  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: "application/pdf" });
}

// ---------------------------------------------------------------------------
// HTML string → multi-page A4 PDF
// Designed for ContentTools: takes a self-contained HTML string (with <style>
// in the <head>) and paginates it into A4 pages without going through the
// SVG-foreignObject DOM capture path (which can taint the canvas via
// @import rules collected from the outer page's stylesheets).
// ---------------------------------------------------------------------------

/**
 * Convert a self-contained HTML string to a multi-page A4 PDF.
 *
 * Rendering pipeline:
 *  1. DOMParser extracts <style> content and <body> innerHTML.
 *  2. An offscreen iframe measures the full scrollHeight.
 *  3. For each A4 page, an SVG with a shifted viewBox "scrolls" the
 *     foreignObject to render only that slice, then the SVG is drawn to
 *     canvas and embedded as a PNG page in the PDF.
 *
 * @param {string} htmlString – Self-contained HTML (from fileToHtml / htmlDoc)
 * @returns {Promise<Blob>} PDF Blob
 */
export async function htmlStringToMultiPagePdf(htmlString) {
  // A4 at 96 dpi: 750 logical pixels wide ≈ 595.28pt
  const A4_W = 750;
  const A4_RATIO = 841.89 / 595.28;
  const pageHeightPx = Math.floor(A4_W * A4_RATIO); // ≈1060px

  // 1. Parse HTML – extract CSS and sanitized body content.
  const parser = new DOMParser();
  const parsed = parser.parseFromString(htmlString, "text/html");

  const css = Array.from(parsed.querySelectorAll("style"))
    .map((s) => s.textContent)
    .join("\n")
    // Strip external resource references that could cause issues
    .replace(/@import\s[^;]+;/g, "")
    .replace(/@font-face\s*\{[^}]*\}/gs, "");

  const bodyContent = parsed.body.innerHTML
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*>/gi, "");

  // 2. Mount a hidden host div with the full document content.
  //    html2canvas reads the live DOM — it doesn't use SVG foreignObject,
  //    so the resulting canvas is never tainted.
  const host = document.createElement("div");
  host.style.cssText = [
    "position:absolute",
    "top:-99999px",
    "left:0",
    `width:${A4_W}px`,
    "background:white",
    "overflow:visible",
  ].join(";");

  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  host.appendChild(styleEl);

  const contentEl = document.createElement("div");
  contentEl.innerHTML = bodyContent;
  host.appendChild(contentEl);

  document.body.appendChild(host);

  try {
    // Wait for layout and system fonts
    await document.fonts.ready;
    await new Promise((r) => setTimeout(r, 120));

    const totalHeight = Math.max(host.scrollHeight, pageHeightPx);

    // 3. Render the full document to a clean canvas with html2canvas.
    //    html2canvas re-draws the DOM using canvas 2D primitives — no SVG,
    //    no foreignObject, no canvas taint.
    const { default: html2canvas } = await import("html2canvas");
    const fullCanvas = await html2canvas(host, {
      width: A4_W,
      height: totalHeight,
      windowWidth: A4_W,
      scale: 1,
      useCORS: false,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
      // Ignore offscreen position so it renders even at top:-99999px
      x: 0,
      y: 0,
      scrollX: 0,
      scrollY: 0,
    });

    // 4. Slice the full canvas into A4 pages and embed in pdf-lib.
    const numPages = Math.ceil(totalHeight / pageHeightPx);
    const pdfDoc = await PDFDocument.create();

    for (let i = 0; i < numPages; i++) {
      const offsetY = i * pageHeightPx;
      const sliceH = Math.min(pageHeightPx, totalHeight - offsetY);

      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = A4_W;
      pageCanvas.height = sliceH;
      const ctx = pageCanvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, A4_W, sliceH);
      ctx.drawImage(fullCanvas, 0, offsetY, A4_W, sliceH, 0, 0, A4_W, sliceH);

      const pngBlob = await canvasToBlob(pageCanvas, "image/png");
      const pngBytes = await pngBlob.arrayBuffer();
      const pngImage = await pdfDoc.embedPng(pngBytes);

      // Map A4_W px → 595.28pt
      const ptScale = 595.28 / A4_W;
      const pdfPageH = sliceH * ptScale;
      const page = pdfDoc.addPage([595.28, pdfPageH]);
      page.drawImage(pngImage, { x: 0, y: 0, width: 595.28, height: pdfPageH });
    }

    const bytes = await pdfDoc.save();
    return new Blob([bytes], { type: "application/pdf" });
  } finally {
    document.body.removeChild(host);
  }
}
