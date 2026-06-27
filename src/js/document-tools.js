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

function pptxLocalName(node) {
  return `${node?.localName || node?.tagName || ""}`.replace(/^.*:/, "").toLowerCase();
}

function pptxCollectText(node) {
  const pieces = [];
  for (const child of Array.from(node?.childNodes || [])) {
    if (child.nodeType === Node.TEXT_NODE) {
      const value = child.textContent || "";
      if (value) pieces.push(value);
      continue;
    }

    const name = pptxLocalName(child);
    if (name === "t") {
      pieces.push(child.textContent || "");
    } else if (name === "tab") {
      pieces.push("\t");
    } else if (name === "br" || name === "cr") {
      pieces.push("\n");
    } else {
      pieces.push(pptxCollectText(child));
    }
  }

  return pieces.join("");
}

function pptxAttr(el, ...names) {
  if (!el) return null;
  for (const name of names) {
    const value = el.getAttribute(name);
    if (value != null && value !== "") return value;
  }
  for (const attr of Array.from(el.attributes || [])) {
    if (names.includes(attr.name) || names.includes(attr.localName)) return attr.value;
  }
  return null;
}

function pptxAllByLocalName(root, name) {
  const wanted = `${name}`.toLowerCase();
  return Array.from(root?.querySelectorAll("*") || []).filter((el) => pptxLocalName(el) === wanted);
}

function pptxFirstByLocalName(root, name) {
  return pptxAllByLocalName(root, name)[0] || null;
}

function pptxDirname(path) {
  const idx = `${path}`.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx + 1) : "";
}

function pptxNormalizePartPath(path) {
  const parts = `${path}`.split("/");
  const out = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

function pptxResolvePartPath(basePartPath, targetPath) {
  if (!targetPath) return "";
  if (targetPath.startsWith("/")) return pptxNormalizePartPath(targetPath.replace(/^\/+/, ""));
  return pptxNormalizePartPath(`${pptxDirname(basePartPath)}${targetPath}`);
}

function pptxRelationships(files, relsPartPath) {
  const items = pptxRelationshipItems(files, relsPartPath);
  const rels = new Map();
  for (const item of items) {
    rels.set(item.id, item.target);
  }
  return rels;
}

function pptxRelationshipItems(files, relsPartPath) {
  const relsBytes = files[relsPartPath];
  if (!relsBytes) return [];

  const relsXml = strFromU8(relsBytes);
  const relsDoc = new DOMParser().parseFromString(relsXml, "application/xml");
  const items = [];
  for (const rel of pptxAllByLocalName(relsDoc, "relationship")) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    const type = rel.getAttribute("Type") || "";
    if (!id || !target) continue;
    items.push({ id, target, type });
  }
  return items;
}

function pptxRelationshipTargetByType(files, relsPartPath, typeSuffix) {
  const items = pptxRelationshipItems(files, relsPartPath);
  const hit = items.find((item) => item.type.toLowerCase().endsWith(`/${`${typeSuffix}`.toLowerCase()}`));
  return hit?.target || "";
}

function pptxXmlDocFromPart(files, partPath) {
  const bytes = files[partPath];
  if (!bytes) return null;
  return new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
}

function pptxRelsPartPath(partPath) {
  const dir = pptxDirname(partPath);
  const file = partPath.slice(dir.length);
  return `${dir}_rels/${file}.rels`;
}

function pptxToBase64(uint8) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < uint8.length; i += chunk) {
    const slice = uint8.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function pptxMimeFromPath(path) {
  const ext = `${path}`.split(".").pop()?.toLowerCase() || "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  return "application/octet-stream";
}

function pptxDataUriForPart(files, partPath) {
  const bytes = files[partPath];
  if (!bytes || !bytes.length) return "";
  const mime = pptxMimeFromPath(partPath);
  return `data:${mime};base64,${pptxToBase64(bytes)}`;
}

function pptxPresentationSize(files) {
  const presentationXml = files["ppt/presentation.xml"] ? strFromU8(files["ppt/presentation.xml"]) : "";
  if (!presentationXml) {
    return { cx: 9144000, cy: 6858000 };
  }

  const presentationDoc = new DOMParser().parseFromString(presentationXml, "application/xml");
  const sldSz = pptxFirstByLocalName(presentationDoc, "sldsz");
  const cx = Number(pptxAttr(sldSz, "cx"));
  const cy = Number(pptxAttr(sldSz, "cy"));

  if (Number.isFinite(cx) && cx > 0 && Number.isFinite(cy) && cy > 0) {
    return { cx, cy };
  }

  return { cx: 9144000, cy: 6858000 };
}

function pptxThemeColors(files, themePartPath = "") {
  const chosenThemePath = themePartPath && files[themePartPath] ? themePartPath : "ppt/theme/theme1.xml";
  const themeXml = files[chosenThemePath] ? strFromU8(files[chosenThemePath]) : "";
  if (!themeXml) return new Map();

  const themeDoc = new DOMParser().parseFromString(themeXml, "application/xml");
  const clrScheme = pptxFirstByLocalName(themeDoc, "clrscheme");
  const colors = new Map();

  for (const node of Array.from(clrScheme?.children || [])) {
    const key = pptxLocalName(node);
    if (!key) continue;
    const srgb = pptxFirstByLocalName(node, "srgbclr");
    const sys = pptxFirstByLocalName(node, "sysclr");
    const hex = `${pptxAttr(srgb, "val") || pptxAttr(sys, "lastClr") || ""}`.trim();
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      colors.set(key, `#${hex.toUpperCase()}`);
    }
  }

  return colors;
}

function pptxHexToRgb(hex) {
  const raw = `${hex || ""}`.replace(/^#/, "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16)
  };
}

function pptxRgbToHex(rgb) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(rgb.r), clamp(rgb.g), clamp(rgb.b)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function pptxApplyLumTransform(rgb, colorNode) {
  const lumModNode = pptxFirstByLocalName(colorNode, "lummod");
  const lumOffNode = pptxFirstByLocalName(colorNode, "lumoff");
  const tintNode = pptxFirstByLocalName(colorNode, "tint");
  const shadeNode = pptxFirstByLocalName(colorNode, "shade");

  const lumMod = Number(pptxAttr(lumModNode, "val"));
  const lumOff = Number(pptxAttr(lumOffNode, "val"));
  const tint = Number(pptxAttr(tintNode, "val"));
  const shade = Number(pptxAttr(shadeNode, "val"));

  let out = { ...rgb };

  if (Number.isFinite(lumMod) || Number.isFinite(lumOff)) {
    const mod = Number.isFinite(lumMod) ? lumMod / 100000 : 1;
    const off = Number.isFinite(lumOff) ? lumOff / 100000 : 0;
    out = {
      r: out.r * mod + 255 * off,
      g: out.g * mod + 255 * off,
      b: out.b * mod + 255 * off
    };
  }

  if (Number.isFinite(tint)) {
    const t = Math.max(0, Math.min(1, tint / 100000));
    out = {
      r: out.r + (255 - out.r) * t,
      g: out.g + (255 - out.g) * t,
      b: out.b + (255 - out.b) * t
    };
  }

  if (Number.isFinite(shade)) {
    const s = Math.max(0, Math.min(1, shade / 100000));
    out = {
      r: out.r * s,
      g: out.g * s,
      b: out.b * s
    };
  }

  return out;
}

function pptxResolveColorNode(colorNode, themeColors) {
  if (!colorNode) return null;
  const srgb = pptxFirstByLocalName(colorNode, "srgbclr");
  const sys = pptxFirstByLocalName(colorNode, "sysclr");
  const scheme = pptxFirstByLocalName(colorNode, "schemeclr");

  let base = null;
  if (srgb) {
    const hex = `${pptxAttr(srgb, "val") || ""}`.trim();
    if (/^[0-9a-fA-F]{6}$/.test(hex)) base = `#${hex.toUpperCase()}`;
  }

  if (!base && sys) {
    const hex = `${pptxAttr(sys, "lastClr") || ""}`.trim();
    if (/^[0-9a-fA-F]{6}$/.test(hex)) base = `#${hex.toUpperCase()}`;
  }

  if (!base && scheme) {
    const key = `${pptxAttr(scheme, "val") || ""}`.trim().toLowerCase();
    base = themeColors.get(key) || null;
  }

  if (!base) return null;
  const rgb = pptxHexToRgb(base);
  if (!rgb) return base;

  const transformed = pptxApplyLumTransform(rgb, srgb || sys || scheme);
  return pptxRgbToHex(transformed);
}

function pptxGradientFillCss(root, themeColors) {
  const gradFill = pptxFirstByLocalName(root, "gradfill");
  if (!gradFill) return null;

  const stops = pptxAllByLocalName(gradFill, "gs").map((gs) => {
    const pos = Number(pptxAttr(gs, "pos"));
    const pct = Number.isFinite(pos) ? Math.max(0, Math.min(100, pos / 1000)) : 0;
    const color = pptxResolveColorNode(gs, themeColors) || "#FFFFFF";
    return `${color} ${pct.toFixed(2)}%`;
  });
  if (!stops.length) return null;

  const lin = pptxFirstByLocalName(gradFill, "lin");
  const ang = Number(pptxAttr(lin, "ang"));
  const angleDeg = Number.isFinite(ang) ? ((ang / 60000) + 90) % 360 : 180;
  return `linear-gradient(${angleDeg.toFixed(2)}deg, ${stops.join(", ")})`;
}

function pptxColorFromFillNode(fillNode, themeColors) {
  return pptxResolveColorNode(fillNode, themeColors);
}

function pptxSolidFillColor(root, themeColors) {
  const solidFill = pptxFirstByLocalName(root, "solidfill");
  return pptxColorFromFillNode(solidFill, themeColors);
}

function pptxFillCss(root, themeColors, fallback = "") {
  const solid = pptxSolidFillColor(root, themeColors);
  if (solid) return solid;
  const gradient = pptxGradientFillCss(root, themeColors);
  if (gradient) return gradient;
  return fallback;
}

function pptxPlaceholderInfo(node) {
  const ph = pptxFirstByLocalName(node, "ph");
  if (!ph) return null;

  const type = `${pptxAttr(ph, "type") || "body"}`.trim();
  const idx = `${pptxAttr(ph, "idx") || "0"}`.trim();
  return {
    type,
    idx,
    key: `${type}:${idx}`
  };
}

function pptxStyleKindFromPlaceholder(placeholder) {
  const type = `${placeholder?.type || ""}`.toLowerCase();
  if (["title", "ctrtitle", "subtitle"].includes(type)) return "title";
  if (["body", "obj", "sldnum", "dt", "ftr"].includes(type)) return "body";
  return "other";
}

function pptxMasterTextStyles(masterDoc) {
  const txStyles = pptxFirstByLocalName(masterDoc, "txstyles");
  const groups = [
    { key: "title", node: pptxFirstByLocalName(txStyles, "titlestyle") },
    { key: "body", node: pptxFirstByLocalName(txStyles, "bodystyle") },
    { key: "other", node: pptxFirstByLocalName(txStyles, "otherstyle") }
  ];

  const result = new Map();
  for (const group of groups) {
    const levels = new Map();
    for (let i = 1; i <= 9; i++) {
      const levelNode = pptxFirstByLocalName(group.node, `lvl${i}ppr`);
      if (levelNode) {
        levels.set(i - 1, {
          pPr: levelNode,
          defRPr: pptxFirstByLocalName(levelNode, "defrpr")
        });
      }
    }

    const defPPr = pptxFirstByLocalName(group.node, "defppr");
    const defRPr = pptxFirstByLocalName(group.node, "defrpr") || pptxFirstByLocalName(defPPr, "defrpr");
    levels.set(-1, {
      pPr: defPPr || null,
      defRPr: defRPr || null
    });
    result.set(group.key, levels);
  }

  return result;
}

function pptxInheritedStyleForParagraph(masterStyles, placeholder, level) {
  if (!masterStyles || typeof masterStyles.get !== "function") return null;
  const kind = pptxStyleKindFromPlaceholder(placeholder);
  const levels = masterStyles.get(kind) || masterStyles.get("other");
  if (!levels) return null;
  return levels.get(level) || levels.get(-1) || null;
}

function pptxParagraphLevel(paragraph) {
  const pPr = pptxFirstByLocalName(paragraph, "ppr");
  const level = Number(pptxAttr(pPr, "lvl"));
  return Number.isFinite(level) ? Math.max(0, Math.min(8, level)) : 0;
}

function pptxSlideLinkedParts(files, slidePartPath) {
  const slideRelsPartPath = pptxRelsPartPath(slidePartPath);
  const slideLayoutTarget = pptxRelationshipTargetByType(files, slideRelsPartPath, "slideLayout");
  const layoutPartPath = slideLayoutTarget ? pptxResolvePartPath(slidePartPath, slideLayoutTarget) : "";

  const layoutRelsPartPath = layoutPartPath ? pptxRelsPartPath(layoutPartPath) : "";
  const slideMasterTarget = layoutRelsPartPath
    ? pptxRelationshipTargetByType(files, layoutRelsPartPath, "slideMaster")
    : "";
  const masterPartPath = slideMasterTarget ? pptxResolvePartPath(layoutPartPath, slideMasterTarget) : "";

  const masterRelsPartPath = masterPartPath ? pptxRelsPartPath(masterPartPath) : "";
  const themeTarget = masterRelsPartPath
    ? pptxRelationshipTargetByType(files, masterRelsPartPath, "theme")
    : "";
  const themePartPath = themeTarget ? pptxResolvePartPath(masterPartPath, themeTarget) : "";

  return {
    slidePartPath,
    layoutPartPath,
    masterPartPath,
    themePartPath
  };
}

function pptxPushUniqueLines(target, lines) {
  for (const line of lines || []) {
    const value = `${line || ""}`.trim();
    if (!value) continue;
    if (!target.includes(value)) target.push(value);
  }
}

function pptxFallbackParagraphs(doc) {
  return pptxAllByLocalName(doc, "p")
    .map((paragraph) => pptxCollectText(paragraph).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function pptxCollectElementsFromDoc(doc, contextBase, partPath, rels) {
  if (!doc) return [];
  const spTree = pptxFirstByLocalName(doc, "sptree");
  const nodes = Array.from(spTree?.children || []);
  const elements = [];
  pptxCollectSlideElements(nodes, {
    ...contextBase,
    rels,
    slidePartPath: partPath,
    source: contextBase.source || "slide"
  }, [], elements);
  return elements;
}

function pptxMergeInheritedElements(slideElements, layoutElements, masterElements) {
  const area = (box) => Math.max(0, Number(box?.cx || 0)) * Math.max(0, Number(box?.cy || 0));

  const intersectionArea = (a, b) => {
    const ax1 = Number(a?.x || 0);
    const ay1 = Number(a?.y || 0);
    const ax2 = ax1 + Number(a?.cx || 0);
    const ay2 = ay1 + Number(a?.cy || 0);
    const bx1 = Number(b?.x || 0);
    const by1 = Number(b?.y || 0);
    const bx2 = bx1 + Number(b?.cx || 0);
    const by2 = by1 + Number(b?.cy || 0);

    const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
    const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
    return ix * iy;
  };

  const overlapRatio = (a, b) => {
    const inter = intersectionArea(a, b);
    if (inter <= 0) return 0;

    const minArea = Math.max(1, Math.min(area(a), area(b)));
    return inter / minArea;
  };

  const iou = (a, b) => {
    const inter = intersectionArea(a, b);
    if (inter <= 0) return 0;
    const union = Math.max(1, area(a) + area(b) - inter);
    return inter / union;
  };

  const elementCenter = (element) => {
    const box = element?.box || {};
    return {
      x: Number(box.x || 0) + Number(box.cx || 0) / 2,
      y: Number(box.y || 0) + Number(box.cy || 0) / 2
    };
  };

  const similarityScore = (existing, candidate) => {
    if (!existing || !candidate) return 0;
    if (existing.type !== candidate.type) return 0;

    const a = elementCenter(existing);
    const b = elementCenter(candidate);
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);

    const cw = Math.max(Number(candidate.box?.cx || 0), 1);
    const ch = Math.max(Number(candidate.box?.cy || 0), 1);
    const centerNorm = Math.min(1, Math.hypot(dx / cw, dy / ch));

    const ew = Math.max(Number(existing.box?.cx || 0), 1);
    const eh = Math.max(Number(existing.box?.cy || 0), 1);
    const sizeW = 1 - Math.min(1, Math.abs(ew - cw) / Math.max(ew, cw));
    const sizeH = 1 - Math.min(1, Math.abs(eh - ch) / Math.max(eh, ch));
    const sizeScore = (sizeW + sizeH) / 2;

    const overlap = overlapRatio(existing.box, candidate.box);
    const overlapIou = iou(existing.box, candidate.box);

    const existingType = `${existing.placeholder?.type || ""}`.toLowerCase();
    const candidateType = `${candidate.placeholder?.type || ""}`.toLowerCase();
    const existingIdx = `${existing.placeholder?.idx || ""}`.toLowerCase();
    const candidateIdx = `${candidate.placeholder?.idx || ""}`.toLowerCase();
    const typeHint = existingType && candidateType && existingType === candidateType ? 1 : 0;
    const idxHint = existingIdx && candidateIdx && existingIdx === candidateIdx ? 1 : 0;
    const hintScore = Math.max(typeHint * 0.7, idxHint);

    return overlapIou * 0.55 + overlap * 0.15 + sizeScore * 0.15 + (1 - centerNorm) * 0.1 + hintScore * 0.05;
  };

  const nearDuplicate = (existing, candidate) => {
    return similarityScore(existing, candidate) >= 0.66;
  };

  const bestSimilarity = (pool, candidate) => {
    let best = 0;
    for (const existing of pool) {
      best = Math.max(best, similarityScore(existing, candidate));
    }
    return best;
  };

  const requiresPlaceholderBinding = (element) => {
    if (!element) return false;
    return element.type === "text" || element.type === "table" || element.type === "image";
  };

  const canInherit = (element) => {
    if (!requiresPlaceholderBinding(element)) return true;
    return !!element.placeholder?.key;
  };

  if (!slideElements.length) {
    const merged = layoutElements.filter((element) => canInherit(element));
    const occupied = new Set(layoutElements.filter((el) => el.placeholder?.key).map((el) => el.placeholder.key));
    for (const element of masterElements) {
      if (!canInherit(element)) continue;
      const key = element.placeholder?.key;
      if (key && occupied.has(key)) continue;
      if (!key && bestSimilarity(merged, element) >= 0.66) continue;
      if (key) occupied.add(key);
      merged.push(element);
    }
    return merged;
  }

  const merged = [...slideElements];
  const occupied = new Set(slideElements.filter((el) => el.placeholder?.key).map((el) => el.placeholder.key));

  for (const element of [...layoutElements, ...masterElements]) {
    if (!canInherit(element)) continue;
    const key = element.placeholder?.key;
    if (!key && requiresPlaceholderBinding(element)) {
      if (bestSimilarity(merged, element) < 0.66) {
        merged.push(element);
      }
      continue;
    }
    if (!key) {
      if (bestSimilarity(merged, element) < 0.66) {
        merged.push(element);
      }
      continue;
    }
    if (occupied.has(key)) continue;
    occupied.add(key);
    merged.push(element);
  }

  return merged;
}

function pptxTitleFromElements(elements) {
  const titleTypes = new Set(["title", "ctrtitle", "subtitle"]);
  const hit = (elements || []).find((el) =>
    el.type === "text" &&
    el.placeholder?.type &&
    titleTypes.has(`${el.placeholder.type}`.toLowerCase())
  );
  return hit?.paragraphs?.[0] || "";
}

function pptxReadTransform(node) {
  const xfrm = pptxFirstByLocalName(node, "xfrm");
  if (!xfrm) return null;

  const off = pptxFirstByLocalName(xfrm, "off");
  const ext = pptxFirstByLocalName(xfrm, "ext");
  const x = Number(pptxAttr(off, "x"));
  const y = Number(pptxAttr(off, "y"));
  const cx = Number(pptxAttr(ext, "cx"));
  const cy = Number(pptxAttr(ext, "cy"));
  const rotRaw = Number(pptxAttr(xfrm, "rot"));
  const rot = Number.isFinite(rotRaw) ? rotRaw / 60000 : 0;
  const flipH = `${pptxAttr(xfrm, "flipH") || ""}`.toLowerCase() === "1" || `${pptxAttr(xfrm, "flipH") || ""}`.toLowerCase() === "true";
  const flipV = `${pptxAttr(xfrm, "flipV") || ""}`.toLowerCase() === "1" || `${pptxAttr(xfrm, "flipV") || ""}`.toLowerCase() === "true";

  if (![x, y, cx, cy].every((v) => Number.isFinite(v))) return null;
  return { x, y, cx, cy, rot, flipH, flipV };
}

function pptxReadGroupTransform(groupNode, fallbackSize) {
  const grpSpPr = pptxFirstByLocalName(groupNode, "grpsppr") || groupNode;
  const xfrm = pptxFirstByLocalName(grpSpPr, "xfrm");
  if (!xfrm) {
    return {
      offX: 0,
      offY: 0,
      extX: fallbackSize.cx,
      extY: fallbackSize.cy,
      chOffX: 0,
      chOffY: 0,
      chExtX: fallbackSize.cx,
      chExtY: fallbackSize.cy
    };
  }

  const off = pptxFirstByLocalName(xfrm, "off");
  const ext = pptxFirstByLocalName(xfrm, "ext");
  const chOff = pptxFirstByLocalName(xfrm, "choff");
  const chExt = pptxFirstByLocalName(xfrm, "chext");

  const offX = Number(pptxAttr(off, "x"));
  const offY = Number(pptxAttr(off, "y"));
  const extX = Number(pptxAttr(ext, "cx"));
  const extY = Number(pptxAttr(ext, "cy"));
  const chOffX = Number(pptxAttr(chOff, "x"));
  const chOffY = Number(pptxAttr(chOff, "y"));
  const chExtX = Number(pptxAttr(chExt, "cx"));
  const chExtY = Number(pptxAttr(chExt, "cy"));

  return {
    offX: Number.isFinite(offX) ? offX : 0,
    offY: Number.isFinite(offY) ? offY : 0,
    extX: Number.isFinite(extX) && extX > 0 ? extX : fallbackSize.cx,
    extY: Number.isFinite(extY) && extY > 0 ? extY : fallbackSize.cy,
    chOffX: Number.isFinite(chOffX) ? chOffX : 0,
    chOffY: Number.isFinite(chOffY) ? chOffY : 0,
    chExtX: Number.isFinite(chExtX) && chExtX > 0 ? chExtX : fallbackSize.cx,
    chExtY: Number.isFinite(chExtY) && chExtY > 0 ? chExtY : fallbackSize.cy
  };
}

function pptxTransformBoxWithGroup(box, groupTransform) {
  if (!box || !groupTransform) return box;
  const scaleX = groupTransform.chExtX > 0 ? groupTransform.extX / groupTransform.chExtX : 1;
  const scaleY = groupTransform.chExtY > 0 ? groupTransform.extY / groupTransform.chExtY : 1;

  return {
    ...box,
    x: groupTransform.offX + (box.x - groupTransform.chOffX) * scaleX,
    y: groupTransform.offY + (box.y - groupTransform.chOffY) * scaleY,
    cx: box.cx * scaleX,
    cy: box.cy * scaleY
  };
}

function pptxApplyGroupTransformChain(box, chain) {
  return (chain || []).reduce((acc, groupTransform) => pptxTransformBoxWithGroup(acc, groupTransform), box);
}

function pptxPercent(value, total) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (value / total) * 100));
}

function pptxInlineBoxStyle(box, presentationSize) {
  const left = pptxPercent(box.x, presentationSize.cx).toFixed(4);
  const top = pptxPercent(box.y, presentationSize.cy).toFixed(4);
  const width = pptxPercent(box.cx, presentationSize.cx).toFixed(4);
  const height = pptxPercent(box.cy, presentationSize.cy).toFixed(4);
  let style = `left:${left}%;top:${top}%;width:${width}%;height:${height}%;`;

  const transformOps = [];
  const scaleX = box.flipH ? -1 : 1;
  const scaleY = box.flipV ? -1 : 1;
  if (Number.isFinite(box.rot) && Math.abs(box.rot) > 0.001) {
    transformOps.push(`rotate(${box.rot.toFixed(4)}deg)`);
  }
  if (scaleX !== 1 || scaleY !== 1) {
    transformOps.push(`scale(${scaleX}, ${scaleY})`);
  }
  if (transformOps.length) {
    style += `transform:${transformOps.join(" ")};transform-origin:center center;`;
  }
  return style;
}

function pptxTextAlignCss(algn) {
  const value = `${algn || ""}`.toLowerCase();
  if (value === "ctr" || value === "center") return "center";
  if (value === "r" || value === "right") return "right";
  if (value === "just" || value === "dist") return "justify";
  return "left";
}

function pptxLengthToPt(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric / 12700;
}

function pptxSpacingValueToCss(spacingNode) {
  if (!spacingNode) return "";
  const pts = pptxFirstByLocalName(spacingNode, "spcpts");
  const pct = pptxFirstByLocalName(spacingNode, "spcpct");

  const ptsRaw = Number(pptxAttr(pts, "val"));
  if (Number.isFinite(ptsRaw) && ptsRaw > 0) {
    return `${(ptsRaw / 100).toFixed(2)}pt`;
  }

  const pctRaw = Number(pptxAttr(pct, "val"));
  if (Number.isFinite(pctRaw) && pctRaw > 0) {
    return `${(pctRaw / 100000).toFixed(3)}`;
  }

  return "";
}

function pptxParagraphSpacingCss(pPr, stylePPr) {
  const beforeNode = pptxFirstByLocalName(pPr, "spcbef") || pptxFirstByLocalName(stylePPr, "spcbef");
  const afterNode = pptxFirstByLocalName(pPr, "spcaft") || pptxFirstByLocalName(stylePPr, "spcaft");
  const lineNode = pptxFirstByLocalName(pPr, "lnspc") || pptxFirstByLocalName(stylePPr, "lnspc");

  const before = pptxSpacingValueToCss(beforeNode);
  const after = pptxSpacingValueToCss(afterNode);
  const line = pptxSpacingValueToCss(lineNode);

  const styles = [];
  if (before) styles.push(`margin-top:${before}`);
  if (after) styles.push(`margin-bottom:${after}`);
  if (line) {
    if (line.endsWith("pt")) styles.push(`line-height:${line}`);
    else styles.push(`line-height:${line}`);
  }
  return styles.join(";");
}

function pptxTextBoxCss(txBody) {
  const bodyPr = pptxFirstByLocalName(txBody, "bodypr");
  if (!bodyPr) return "";

  const lIns = pptxLengthToPt(pptxAttr(bodyPr, "lIns"));
  const rIns = pptxLengthToPt(pptxAttr(bodyPr, "rIns"));
  const tIns = pptxLengthToPt(pptxAttr(bodyPr, "tIns"));
  const bIns = pptxLengthToPt(pptxAttr(bodyPr, "bIns"));
  const wrap = `${pptxAttr(bodyPr, "wrap") || ""}`.toLowerCase();
  const horzOverflow = `${pptxAttr(bodyPr, "horzOverflow") || ""}`.toLowerCase();
  const vertOverflow = `${pptxAttr(bodyPr, "vertOverflow") || ""}`.toLowerCase();
  const normAutofit = pptxFirstByLocalName(bodyPr, "normautofit");
  const spAutofit = !!pptxFirstByLocalName(bodyPr, "spautofit");
  const noAutofit = !!pptxFirstByLocalName(bodyPr, "noautofit");

  const styles = [];
  if (Number.isFinite(tIns)) styles.push(`--pptx-tx-pad-top:${tIns.toFixed(2)}pt`);
  if (Number.isFinite(rIns)) styles.push(`--pptx-tx-pad-right:${rIns.toFixed(2)}pt`);
  if (Number.isFinite(bIns)) styles.push(`--pptx-tx-pad-bottom:${bIns.toFixed(2)}pt`);
  if (Number.isFinite(lIns)) styles.push(`--pptx-tx-pad-left:${lIns.toFixed(2)}pt`);

  if (wrap === "none") styles.push("--pptx-tx-wrap:nowrap");
  if (horzOverflow === "clip") styles.push("--pptx-tx-overflow-x:hidden");
  if (vertOverflow === "clip") styles.push("--pptx-tx-overflow-y:hidden");

  const fontScaleRaw = Number(pptxAttr(normAutofit, "fontScale"));
  if (Number.isFinite(fontScaleRaw) && fontScaleRaw > 0) {
    const scale = Math.max(0.55, Math.min(1, fontScaleRaw / 100000));
    styles.push(`--pptx-font-scale:${scale.toFixed(3)}`);
  } else if (spAutofit && !noAutofit) {
    styles.push("--pptx-font-scale:0.92");
  }

  return styles.join(";");
}

function pptxShapePreset(spPr) {
  const prstGeom = pptxFirstByLocalName(spPr, "prstgeom");
  const preset = `${pptxAttr(prstGeom, "prst") || "rect"}`.toLowerCase();
  const avLst = pptxFirstByLocalName(prstGeom, "avlst");
  const adjusts = new Map();
  for (const gd of pptxAllByLocalName(avLst, "gd")) {
    const name = `${pptxAttr(gd, "name") || ""}`.trim().toLowerCase();
    const raw = `${pptxAttr(gd, "fmla") || pptxAttr(gd, "val") || ""}`.trim();
    const val = Number(raw);
    const fallbackMatch = raw.match(/-?\d+(?:\.\d+)?/);
    const parsed = Number.isFinite(val) ? val : Number(fallbackMatch?.[0]);
    if (!name || !Number.isFinite(parsed)) continue;
    adjusts.set(name, parsed);
  }
  return { preset, adjusts };
}

function pptxShapeClipPath(preset, adjusts) {
  const p = `${preset || ""}`.toLowerCase();
  const adjRaw = Number(adjusts?.get("adj"));
  const adjPct = Number.isFinite(adjRaw) ? Math.max(4, Math.min(40, adjRaw / 1000)) : null;

  if (p.includes("diamond")) {
    return "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)";
  }
  if (p.includes("triangle")) {
    return p.includes("rt") ? "polygon(0% 0%, 100% 100%, 0% 100%)" : "polygon(50% 0%, 100% 100%, 0% 100%)";
  }
  if (p.includes("parallelogram")) {
    const skew = Number.isFinite(adjPct) ? adjPct : 18;
    return `polygon(${skew.toFixed(2)}% 0%, 100% 0%, ${(100 - skew).toFixed(2)}% 100%, 0% 100%)`;
  }
  if (p.includes("trapezoid")) {
    const inset = Number.isFinite(adjPct) ? adjPct : 18;
    return `polygon(${inset.toFixed(2)}% 0%, ${(100 - inset).toFixed(2)}% 0%, 100% 100%, 0% 100%)`;
  }
  if (p.includes("chevron")) {
    const notch = Number.isFinite(adjPct) ? Math.max(10, Math.min(32, adjPct)) : 20;
    const inner = Math.max(4, notch * 0.55);
    return `polygon(0% 0%, ${(100 - notch).toFixed(2)}% 0%, 100% 50%, ${(100 - notch).toFixed(2)}% 100%, 0% 100%, ${inner.toFixed(2)}% 50%)`;
  }
  if (p.includes("hexagon")) {
    const edge = Number.isFinite(adjPct) ? Math.max(10, Math.min(28, adjPct)) : 20;
    return `polygon(${edge.toFixed(2)}% 0%, ${(100 - edge).toFixed(2)}% 0%, 100% 50%, ${(100 - edge).toFixed(2)}% 100%, ${edge.toFixed(2)}% 100%, 0% 50%)`;
  }
  if (p.includes("octagon")) {
    const cut = Number.isFinite(adjPct) ? Math.max(8, Math.min(24, adjPct)) : 16;
    return `polygon(${cut.toFixed(2)}% 0%, ${(100 - cut).toFixed(2)}% 0%, 100% ${cut.toFixed(2)}%, 100% ${(100 - cut).toFixed(2)}%, ${(100 - cut).toFixed(2)}% 100%, ${cut.toFixed(2)}% 100%, 0% ${(100 - cut).toFixed(2)}%, 0% ${cut.toFixed(2)}%)`;
  }
  return "";
}

function pptxShapeCss(spPr, themeColors) {
  const styles = [];
  const lineNode = pptxFirstByLocalName(spPr, "ln");
  const border = pptxBorderFromLine(lineNode, themeColors);
  if (border) {
    styles.push(`--pptx-shape-border:${border}`);
  }

  const { preset, adjusts } = pptxShapePreset(spPr);
  const clipPath = pptxShapeClipPath(preset, adjusts);
  if (clipPath) {
    styles.push(`--pptx-shape-clip:${clipPath}`);
  }
  if (preset.includes("ellipse") || preset.includes("circle")) {
    styles.push("--pptx-shape-radius:50%");
  } else if (preset.includes("round")) {
    const adj = adjusts.get("adj");
    const radiusPct = Number.isFinite(adj) ? Math.max(2, Math.min(50, adj / 1000)) : 8;
    styles.push(`--pptx-shape-radius:${radiusPct.toFixed(2)}%`);
  } else if (preset.includes("pill")) {
    styles.push("--pptx-shape-radius:999px");
  }

  return styles.join(";");
}

function pptxHeuristicAutoFitCss(box, paragraphs, existingCss = "") {
  const css = `${existingCss || ""}`;
  if (css.includes("--pptx-font-scale")) return css;

  const text = (paragraphs || []).join(" ").replace(/\s+/g, " ").trim();
  const charCount = text.length;
  if (!charCount) return css;

  const width = Math.max(1, Number(box?.cx || 0));
  const height = Math.max(1, Number(box?.cy || 0));
  const area = width * height;

  const density = (charCount * 100000000) / area;
  const longLinesPenalty = (paragraphs || []).some((p) => `${p || ""}`.length > 120) ? 0.06 : 0;

  if (density < 9.5 && !longLinesPenalty) return css;

  const rawScale = 1 - (density - 9.5) * 0.015 - longLinesPenalty;
  const clamped = Math.max(0.72, Math.min(0.98, rawScale));
  return `${css}${css ? ";" : ""}--pptx-font-scale:${clamped.toFixed(3)}`;
}

function pptxListMarker(type, number) {
  const normalized = `${type || ""}`.toLowerCase();
  const toRoman = (value) => {
    const n = Math.max(1, Math.min(3999, Number(value) || 1));
    const parts = [
      [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
      [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
      [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
    ];
    let rest = n;
    let out = "";
    for (const [unit, sym] of parts) {
      while (rest >= unit) {
        out += sym;
        rest -= unit;
      }
    }
    return out;
  };
  if (normalized.includes("alphauc")) {
    const letter = String.fromCharCode(64 + Math.max(1, Math.min(26, number)));
    return normalized.includes("parenr") ? `${letter})` : `${letter}.`;
  }
  if (normalized.includes("alphalc")) {
    const letter = String.fromCharCode(96 + Math.max(1, Math.min(26, number)));
    return normalized.includes("parenr") ? `${letter})` : `${letter}.`;
  }
  if (normalized.includes("romanuc")) {
    const roman = toRoman(number);
    return normalized.includes("parenr") ? `${roman})` : `${roman}.`;
  }
  if (normalized.includes("romanlc")) {
    const roman = toRoman(number).toLowerCase();
    return normalized.includes("parenr") ? `${roman})` : `${roman}.`;
  }
  return normalized.includes("parenr") ? `${number})` : `${number}.`;
}

function pptxListPrefix(paragraph, pPr, stylePPr, listState, listLevel) {
  const buCharNode = pptxFirstByLocalName(pPr, "buchar") || pptxFirstByLocalName(stylePPr, "buchar");
  const buChar = `${pptxAttr(buCharNode, "char") || ""}`.trim();
  if (buChar) return `${buChar} `;

  const autoNumNode = pptxFirstByLocalName(pPr, "buautonum") || pptxFirstByLocalName(stylePPr, "buautonum");
  if (!autoNumNode) return "";

  const type = `${pptxAttr(autoNumNode, "type") || "arabicPeriod"}`;
  const startAtRaw = Number(pptxAttr(autoNumNode, "startAt"));
  const startAt = Number.isFinite(startAtRaw) && startAtRaw > 0 ? Math.floor(startAtRaw) : 1;
  for (const key of Array.from(listState.keys())) {
    const level = Number(key.split("::")[0]);
    if (Number.isFinite(level) && level > listLevel) listState.delete(key);
  }

  const key = `${listLevel}::${type}`;
  if (!listState.has(key)) {
    listState.set(key, Math.max(0, startAt - 1));
  }
  const next = (listState.get(key) || 0) + 1;
  listState.set(key, next);
  return `${pptxListMarker(type, next)} `;
}

function pptxRunHtml(run, defaultRPr, themeColors) {
  const text = pptxCollectText(run);
  if (!text) return "";

  const rPr = pptxFirstByLocalName(run, "rpr") || defaultRPr || null;
  const sizeRaw = Number(pptxAttr(rPr, "sz") || pptxAttr(defaultRPr, "sz"));
  const sizePt = Number.isFinite(sizeRaw) ? Math.max(8, sizeRaw / 100) : null;
  const fontNode = pptxFirstByLocalName(rPr, "latin") || pptxFirstByLocalName(defaultRPr, "latin");
  const font = `${pptxAttr(fontNode, "typeface") || ""}`.trim();
  const color = pptxSolidFillColor(rPr, themeColors) || pptxSolidFillColor(defaultRPr, themeColors);
  const bold = `${pptxAttr(rPr, "b") || ""}` === "1";
  const italic = `${pptxAttr(rPr, "i") || ""}` === "1";
  const underline = `${pptxAttr(rPr, "u") || ""}`.toLowerCase();

  let style = "";
  if (sizePt) style += `font-size:${sizePt.toFixed(2)}pt;`;
  if (font) style += `font-family:${escHtml(font)},\"Segoe UI\",sans-serif;`;
  if (color) style += `color:${color};`;
  if (bold) style += "font-weight:700;";
  if (italic) style += "font-style:italic;";
  if (underline && underline !== "none") style += "text-decoration:underline;";

  return `<span${style ? ` style=\"${style}\"` : ""}>${escHtml(text)}</span>`;
}

function pptxParagraphHtml(paragraph, txBody, themeColors, inheritedStyle = null, listState = new Map()) {
  const pPr = pptxFirstByLocalName(paragraph, "ppr");
  const bodyPr = pptxFirstByLocalName(txBody, "bodypr");
  const stylePPr = inheritedStyle?.pPr || null;
  const listLevel = Number(pptxAttr(pPr, "lvl") || pptxAttr(stylePPr, "lvl"));
  const normalizedLevel = Number.isFinite(listLevel) ? Math.max(0, Math.min(8, listLevel)) : 0;
  const runs = Array.from(paragraph?.children || []).filter((child) => {
    const name = pptxLocalName(child);
    return name === "r" || name === "fld";
  });
  const defaultRPr =
    pptxFirstByLocalName(pPr, "defrpr") ||
    inheritedStyle?.defRPr ||
    pptxFirstByLocalName(paragraph, "endpararpr");
  const runHtml = runs.map((run) => pptxRunHtml(run, defaultRPr, themeColors)).join("");
  const rawText = pptxCollectText(paragraph).replace(/\s+/g, " ").trim();

  const align = pptxTextAlignCss(pptxAttr(pPr, "algn") || pptxAttr(stylePPr, "algn"));
  const anchor = `${pptxAttr(bodyPr, "anchor") || ""}`.toLowerCase();
  const vertical = anchor === "ctr" || anchor === "mid" ? "middle" : anchor === "b" ? "bottom" : "top";
  const marLPt = pptxLengthToPt(pptxAttr(pPr, "marL") || pptxAttr(stylePPr, "marL"));
  const indentPt = pptxLengthToPt(pptxAttr(pPr, "indent") || pptxAttr(stylePPr, "indent"));
  const fallbackIndent = normalizedLevel > 0 ? normalizedLevel * 1.2 : 0;
  const prefix = pptxListPrefix(paragraph, pPr, stylePPr, listState, normalizedLevel);
  const spacingStyle = pptxParagraphSpacingCss(pPr, stylePPr);

  const paragraphStyle = [
    `text-align:${align}`,
    Number.isFinite(marLPt) ? `margin-left:${marLPt.toFixed(2)}pt` : (fallbackIndent ? `padding-left:${fallbackIndent.toFixed(2)}em` : ""),
    Number.isFinite(indentPt) ? `text-indent:${indentPt.toFixed(2)}pt` : "",
    spacingStyle
  ].filter(Boolean).join(";");
  const html = `<p style=\"${paragraphStyle}\">${prefix}${runHtml || escHtml(rawText)}</p>`;
  return {
    html,
    text: rawText,
    vertical
  };
}

function pptxParseShape(sp, presentationSize, themeColors, masterStyles) {
  const txBody = pptxFirstByLocalName(sp, "txbody");
  if (!txBody) return null;

  const placeholder = pptxPlaceholderInfo(sp);
  const listState = new Map();

  const paragraphData = pptxAllByLocalName(txBody, "p")
    .map((paragraph) => {
      const level = pptxParagraphLevel(paragraph);
      const inheritedStyle = pptxInheritedStyleForParagraph(masterStyles, placeholder, level);
      return pptxParagraphHtml(paragraph, txBody, themeColors, inheritedStyle, listState);
    })
    .filter((item) => item.text);

  const paragraphs = paragraphData.map((item) => item.text);
  const htmlParagraphs = paragraphData.map((item) => item.html).join("");
  const vertical = paragraphData[0]?.vertical || "top";

  if (!paragraphs.length) return null;

  const spPr = pptxFirstByLocalName(sp, "sppr") || sp;
  const box = pptxReadTransform(spPr) || { x: 0, y: 0, cx: presentationSize.cx, cy: presentationSize.cy * 0.2 };
  const baseTextCss = pptxTextBoxCss(txBody);
  const geometryCss = pptxShapeCss(spPr, themeColors);
  const textCss = pptxHeuristicAutoFitCss(box, paragraphs, [baseTextCss, geometryCss].filter(Boolean).join(";"));
  return {
    type: "text",
    box,
    paragraphs,
    htmlParagraphs,
    vertical,
    fillCss: pptxFillCss(spPr, themeColors, "transparent"),
    placeholder,
    textCss
  };
}

function pptxParsePicture(pic, slidePartPath, rels, files, presentationSize) {
  const blip = pptxFirstByLocalName(pic, "blip");
  const embedId = pptxAttr(blip, "r:embed", "embed");
  if (!embedId) return null;

  const target = rels.get(embedId);
  if (!target) return null;

  const partPath = pptxResolvePartPath(slidePartPath, target);
  const src = pptxDataUriForPart(files, partPath);
  if (!src) return null;

  const spPr = pptxFirstByLocalName(pic, "sppr") || pic;
  const box = pptxReadTransform(spPr) || { x: 0, y: 0, cx: presentationSize.cx, cy: presentationSize.cy };
  return {
    type: "image",
    box,
    src
  };
}

function pptxBorderFromLine(lineNode, themeColors) {
  if (!lineNode) return "";
  if (pptxFirstByLocalName(lineNode, "nofill")) return "";

  const dashNode = pptxFirstByLocalName(lineNode, "prstdash");
  const dash = `${pptxAttr(dashNode, "val") || ""}`.toLowerCase();
  const dashStyle = (() => {
    if (!dash) return "solid";
    if (["sysdot", "dot", "lgdot", "dashdotdot"].includes(dash)) return "dotted";
    if (["dash", "lgdash", "sysdash", "dashdot"].includes(dash)) return "dashed";
    return "solid";
  })();

  const widthRaw = Number(pptxAttr(lineNode, "w"));
  const widthPt = Number.isFinite(widthRaw) && widthRaw > 0 ? Math.max(0.5, widthRaw / 12700) : 1;
  const color = pptxSolidFillColor(lineNode, themeColors) || "#94a3b8";
  return `${widthPt.toFixed(2)}pt ${dashStyle} ${color}`;
}

function pptxTableCellBorders(tcPr, themeColors) {
  const left = pptxBorderFromLine(pptxFirstByLocalName(tcPr, "lnl"), themeColors);
  const right = pptxBorderFromLine(pptxFirstByLocalName(tcPr, "lnr"), themeColors);
  const top = pptxBorderFromLine(pptxFirstByLocalName(tcPr, "lnt"), themeColors);
  const bottom = pptxBorderFromLine(pptxFirstByLocalName(tcPr, "lnb"), themeColors);

  const fallbackColor = themeColors?.get("tx1") || themeColors?.get("dk1") || "#94a3b8";
  const fallback = `1.00pt solid ${fallbackColor}`;

  return {
    left: left || fallback,
    right: right || fallback,
    top: top || fallback,
    bottom: bottom || fallback
  };
}

function pptxParseTableFrame(graphicFrame, presentationSize, themeColors) {
  const table = pptxFirstByLocalName(graphicFrame, "tbl");
  if (!table) return null;

  const xfrm = pptxFirstByLocalName(graphicFrame, "xfrm") || graphicFrame;
  const box = pptxReadTransform(xfrm) || { x: 0, y: 0, cx: presentationSize.cx * 0.5, cy: presentationSize.cy * 0.3 };

  const rows = pptxAllByLocalName(table, "tr").map((row) => {
    const cells = pptxAllByLocalName(row, "tc").map((cell) => {
      const tcPr = pptxFirstByLocalName(cell, "tcpr") || cell;
      const paragraphs = pptxAllByLocalName(cell, "p")
        .map((paragraph) => pptxCollectText(paragraph).replace(/\s+/g, " ").trim())
        .filter(Boolean);

      const gridSpan = Number(pptxAttr(cell, "gridSpan") || pptxAttr(tcPr, "gridSpan"));
      const rowSpan = Number(pptxAttr(cell, "rowSpan") || pptxAttr(tcPr, "rowSpan"));

      const hMerge =
        !!pptxFirstByLocalName(tcPr, "hmerge") ||
        `${pptxAttr(cell, "hMerge") || pptxAttr(tcPr, "hMerge") || ""}`.toLowerCase() === "1";
      const vMerge =
        !!pptxFirstByLocalName(tcPr, "vmerge") ||
        `${pptxAttr(cell, "vMerge") || pptxAttr(tcPr, "vMerge") || ""}`.toLowerCase() === "1";

      const anchor = `${pptxAttr(tcPr, "anchor") || ""}`.toLowerCase();
      const valign = anchor === "ctr" || anchor === "mid" ? "middle" : anchor === "b" ? "bottom" : "top";

      return {
        text: paragraphs.join("\n"),
        colspan: Number.isFinite(gridSpan) && gridSpan > 1 ? gridSpan : 1,
        rowspan: Number.isFinite(rowSpan) && rowSpan > 1 ? rowSpan : 1,
        skip: hMerge || vMerge,
        fillCss: pptxFillCss(tcPr, themeColors, ""),
        valign,
        borders: pptxTableCellBorders(tcPr, themeColors)
      };
    });

    return cells;
  }).filter((row) => row.length > 0);

  if (!rows.length) return null;

  return {
    type: "table",
    box,
    rows,
    fillCss: pptxFillCss(table, themeColors, "rgba(255,255,255,0.95)"),
    placeholder: pptxPlaceholderInfo(graphicFrame)
  };
}

function pptxParseConnector(connector, presentationSize, themeColors) {
  const spPr = pptxFirstByLocalName(connector, "sppr") || connector;
  const box = pptxReadTransform(spPr);
  if (!box) return null;

  const line = pptxFirstByLocalName(spPr, "ln");
  const headEnd = pptxFirstByLocalName(line, "headend");
  const tailEnd = pptxFirstByLocalName(line, "tailend");
  const headType = `${pptxAttr(headEnd, "type") || ""}`.toLowerCase();
  const tailType = `${pptxAttr(tailEnd, "type") || ""}`.toLowerCase();
  const widthRaw = Number(pptxAttr(line, "w"));
  const widthPt = Number.isFinite(widthRaw) && widthRaw > 0 ? Math.max(1, widthRaw / 12700) : 1.5;
  const minEmu = Math.max(12700, widthPt * 12700);

  const rawCx = Math.max(0, Number(box.cx || 0));
  const rawCy = Math.max(0, Number(box.cy || 0));
  const renderCx = Math.max(rawCx, minEmu);
  const renderCy = Math.max(rawCy, minEmu);

  const mostlyHorizontal = rawCx > minEmu * 1.2 && rawCy <= minEmu * 1.2;
  const mostlyVertical = rawCy > minEmu * 1.2 && rawCx <= minEmu * 1.2;

  let x1 = box.flipH ? 100 : 0;
  let y1 = box.flipV ? 100 : 0;
  let x2 = box.flipH ? 0 : 100;
  let y2 = box.flipV ? 0 : 100;

  if (mostlyHorizontal) {
    y1 = 50;
    y2 = 50;
  } else if (mostlyVertical) {
    x1 = 50;
    x2 = 50;
  }

  return {
    type: "line",
    box: { x: box.x, y: box.y, cx: renderCx, cy: renderCy, rot: box.rot || 0 },
    x1,
    y1,
    x2,
    y2,
    headType: headType && headType !== "none" ? headType : "",
    tailType: tailType && tailType !== "none" ? tailType : "",
    stroke: pptxSolidFillColor(line, themeColors) || "#4b5563",
    strokeWidthPt: widthPt
  };
}

function pptxParseSlideBackground(slideDoc, themeColors, fallback = null) {
  const bgPr = pptxFirstByLocalName(slideDoc, "bgpr");
  return pptxFillCss(bgPr, themeColors, fallback);
}

function pptxCollectSlideElements(nodes, context, chain, out) {
  for (const node of nodes) {
    const name = pptxLocalName(node);
    if (name === "sp") {
      const textElement = pptxParseShape(node, context.presentationSize, context.themeColors, context.masterStyles);
      if (textElement) {
        textElement.box = pptxApplyGroupTransformChain(textElement.box, chain);
        textElement.source = context.source || "slide";
        out.push(textElement);
      }
      continue;
    }

    if (name === "pic") {
      const imageElement = pptxParsePicture(node, context.slidePartPath, context.rels, context.files, context.presentationSize);
      if (imageElement) {
        imageElement.box = pptxApplyGroupTransformChain(imageElement.box, chain);
        imageElement.source = context.source || "slide";
        imageElement.placeholder = pptxPlaceholderInfo(node);
        out.push(imageElement);
      }
      continue;
    }

    if (name === "graphicframe") {
      const tableElement = pptxParseTableFrame(node, context.presentationSize, context.themeColors);
      if (tableElement) {
        tableElement.box = pptxApplyGroupTransformChain(tableElement.box, chain);
        tableElement.source = context.source || "slide";
        out.push(tableElement);
      }
      continue;
    }

    if (name === "cxnsp") {
      const lineElement = pptxParseConnector(node, context.presentationSize, context.themeColors);
      if (lineElement) {
        lineElement.box = pptxApplyGroupTransformChain(lineElement.box, chain);
        lineElement.source = context.source || "slide";
        out.push(lineElement);
      }
      continue;
    }

    if (name === "grpsp") {
      const groupTransform = pptxReadGroupTransform(node, context.presentationSize);
      const childNodes = Array.from(node.children || []).filter((child) => {
        const childName = pptxLocalName(child);
        return !["nvgrpsppr", "grpsppr"].includes(childName);
      });
      pptxCollectSlideElements(childNodes, context, [...chain, groupTransform], out);
    }
  }
}

function pptxSlideModel(files, slidePartPath, presentationSize) {
  const links = pptxSlideLinkedParts(files, slidePartPath);

  const slideDoc = pptxXmlDocFromPart(files, links.slidePartPath);
  const layoutDoc = links.layoutPartPath ? pptxXmlDocFromPart(files, links.layoutPartPath) : null;
  const masterDoc = links.masterPartPath ? pptxXmlDocFromPart(files, links.masterPartPath) : null;

  const slideRels = pptxRelationships(files, pptxRelsPartPath(links.slidePartPath));
  const layoutRels = links.layoutPartPath ? pptxRelationships(files, pptxRelsPartPath(links.layoutPartPath)) : new Map();
  const masterRels = links.masterPartPath ? pptxRelationships(files, pptxRelsPartPath(links.masterPartPath)) : new Map();
  const themeColors = pptxThemeColors(files, links.themePartPath);
  const masterStyles = pptxMasterTextStyles(masterDoc);

  const contextBase = {
    files,
    presentationSize,
    themeColors,
    masterStyles
  };

  const slideElements = pptxCollectElementsFromDoc(slideDoc, { ...contextBase, source: "slide" }, links.slidePartPath, slideRels);
  const layoutElements = layoutDoc
    ? pptxCollectElementsFromDoc(layoutDoc, { ...contextBase, source: "layout" }, links.layoutPartPath, layoutRels)
    : [];
  const masterElements = masterDoc
    ? pptxCollectElementsFromDoc(masterDoc, { ...contextBase, source: "master" }, links.masterPartPath, masterRels)
    : [];

  const elements = pptxMergeInheritedElements(slideElements, layoutElements, masterElements);

  const fallbackParagraphs = [];
  pptxPushUniqueLines(fallbackParagraphs, pptxFallbackParagraphs(slideDoc));
  if (!fallbackParagraphs.length && layoutDoc) {
    pptxPushUniqueLines(fallbackParagraphs, pptxFallbackParagraphs(layoutDoc));
  }
  if (!fallbackParagraphs.length && masterDoc) {
    pptxPushUniqueLines(fallbackParagraphs, pptxFallbackParagraphs(masterDoc));
  }

  const background =
    pptxParseSlideBackground(slideDoc, themeColors, null) ||
    pptxParseSlideBackground(layoutDoc, themeColors, null) ||
    pptxParseSlideBackground(masterDoc, themeColors, null) ||
    "#ffffff";

  const title = pptxTitleFromElements(elements) || fallbackParagraphs[0] || "Untitled slide";

  return {
    title,
    elements,
    fallbackParagraphs,
    background
  };
}

function pptxSlideEntries(files) {
  const presentationXml = files["ppt/presentation.xml"] ? strFromU8(files["ppt/presentation.xml"]) : "";
  const relsXml = files["ppt/_rels/presentation.xml.rels"] ? strFromU8(files["ppt/_rels/presentation.xml.rels"]) : "";

  const presentationDoc = presentationXml ? new DOMParser().parseFromString(presentationXml, "application/xml") : null;
  const relsDoc = relsXml ? new DOMParser().parseFromString(relsXml, "application/xml") : null;
  const relTargets = new Map();

  for (const rel of Array.from(relsDoc?.querySelectorAll("*") || []).filter((el) => pptxLocalName(el) === "relationship")) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (!id || !target) continue;
    relTargets.set(id, target.replace(/^\/+/, ""));
  }

  const orderedSlides = Array.from(presentationDoc?.querySelectorAll("*") || [])
    .filter((el) => pptxLocalName(el) === "sldid")
    .map((slideId) => {
      const relId = slideId.getAttribute("r:id") || slideId.getAttribute("id") || slideId.getAttribute("rId");
      const target = relId ? relTargets.get(relId) : null;
      if (!target) return null;
      const path = target.startsWith("ppt/") ? target : `ppt/${target}`;
      return { path };
    })
    .filter(Boolean);

  if (orderedSlides.length) return orderedSlides;

  return Object.keys(files)
    .filter((key) => /^ppt\/slides\/slide\d+\.xml$/i.test(key))
    .sort((a, b) => {
      const na = Number(a.match(/\d+/)?.[0] ?? 0);
      const nb = Number(b.match(/\d+/)?.[0] ?? 0);
      return na - nb;
    })
    .map((path) => ({ path }));
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
  const slideEntries = pptxSlideEntries(files);
  const presentationSize = pptxPresentationSize(files);

  const slides = [];
  for (let i = 0; i < slideEntries.length; i++) {
    const entry = slideEntries[i];
    const model = pptxSlideModel(files, entry.path, presentationSize);
    const paragraphs = model.fallbackParagraphs;
    const text = paragraphs.join("\n").trim();
    slides.push(text ? `Slide ${i + 1}: ${text}` : `Slide ${i + 1}: [No text content found]`);
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
  const files = unzipToMap(buffer);
  const slideEntries = pptxSlideEntries(files);
  const presentationSize = pptxPresentationSize(files);
  const stageWidth = 960;
  const stageHeight = Math.round(stageWidth * (presentationSize.cy / presentationSize.cx));

  const slides = [];
  for (let i = 0; i < slideEntries.length; i++) {
    const entry = slideEntries[i];
    const model = pptxSlideModel(files, entry.path, presentationSize);

    const elementsHtml = model.elements.map((element, elementIndex) => {
      if (element.type === "image") {
        return `<div class="pptx-el pptx-image" style="${pptxInlineBoxStyle(element.box, presentationSize)}"><img src="${escHtml(element.src)}" alt="" /></div>`;
      }

      if (element.type === "table") {
        const tableHtml = element.rows.map((row) => {
          const cellsHtml = row
            .filter((cell) => !cell.skip)
            .map((cell) => {
              const attrs = [
                cell.colspan > 1 ? `colspan=\"${cell.colspan}\"` : "",
                cell.rowspan > 1 ? `rowspan=\"${cell.rowspan}\"` : ""
              ].filter(Boolean).join(" ");
              const style = [
                cell.fillCss ? `background:${cell.fillCss}` : "",
                cell.valign ? `vertical-align:${cell.valign}` : "",
                cell.borders?.left ? `border-left:${cell.borders.left}` : "",
                cell.borders?.right ? `border-right:${cell.borders.right}` : "",
                cell.borders?.top ? `border-top:${cell.borders.top}` : "",
                cell.borders?.bottom ? `border-bottom:${cell.borders.bottom}` : ""
              ].filter(Boolean).join(";");
              return `<td${attrs ? ` ${attrs}` : ""}${style ? ` style=\"${style}\"` : ""}>${escHtml(cell.text).replace(/\n/g, "<br>")}</td>`;
            }).join("");
          return `<tr>${cellsHtml}</tr>`;
        }).join("");
        const style = `${pptxInlineBoxStyle(element.box, presentationSize)}--pptx-table-fill:${element.fillCss || "rgba(255,255,255,0.95)"};`;
        return `<div class="pptx-el pptx-table" style="${style}"><table><tbody>${tableHtml}</tbody></table></div>`;
      }

      if (element.type === "line") {
        const style = `${pptxInlineBoxStyle(element.box, presentationSize)}--pptx-line-color:${element.stroke};--pptx-line-width:${element.strokeWidthPt.toFixed(2)}pt;`;
        const markerShape = (kind) => {
          const k = `${kind || ""}`.toLowerCase();
          if (!k) return "";
          if (["arrow", "triangle", "stealth"].includes(k)) {
            return "<path d=\"M0 0 L10 5 L0 10 z\" fill=\"currentColor\" />";
          }
          if (k === "oval") {
            return "<circle cx=\"5\" cy=\"5\" r=\"3.4\" fill=\"currentColor\" />";
          }
          if (k === "diamond") {
            return "<path d=\"M1 5 L5 1 L9 5 L5 9 z\" fill=\"currentColor\" />";
          }
          if (k === "open") {
            return "<path d=\"M1 1 L9 5 L1 9\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" />";
          }
          return "<path d=\"M0 0 L10 5 L0 10 z\" fill=\"currentColor\" />";
        };

        const markerStartId = element.headType ? `pptx-line-start-${i}-${elementIndex}` : "";
        const markerEndId = element.tailType ? `pptx-line-end-${i}-${elementIndex}` : "";
        const markerDefs = [
          markerStartId ? `<marker id="${markerStartId}" viewBox="0 0 10 10" markerWidth="8" markerHeight="8" refX="1" refY="5" orient="auto-start-reverse" markerUnits="strokeWidth">${markerShape(element.headType)}</marker>` : "",
          markerEndId ? `<marker id="${markerEndId}" viewBox="0 0 10 10" markerWidth="8" markerHeight="8" refX="9" refY="5" orient="auto-start-reverse" markerUnits="strokeWidth">${markerShape(element.tailType)}</marker>` : ""
        ].filter(Boolean).join("");

        const markerAttrs = [
          markerStartId ? `marker-start=\"url(#${markerStartId})\"` : "",
          markerEndId ? `marker-end=\"url(#${markerEndId})\"` : ""
        ].filter(Boolean).join(" ");

        return `<div class="pptx-el pptx-line" style="${style}"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${markerDefs ? `<defs>${markerDefs}</defs>` : ""}<line x1="${Number.isFinite(element.x1) ? element.x1.toFixed(2) : "0"}" y1="${Number.isFinite(element.y1) ? element.y1.toFixed(2) : "0"}" x2="${Number.isFinite(element.x2) ? element.x2.toFixed(2) : "100"}" y2="${Number.isFinite(element.y2) ? element.y2.toFixed(2) : "100"}" ${markerAttrs} /></svg></div>`;
      }

      const fillStyle = element.fillCss ? `--pptx-text-fill:${element.fillCss};` : "";
      const vAlign = element.vertical ? `--pptx-text-v:${element.vertical};` : "";
      const textCss = element.textCss ? `${element.textCss};` : "";
      return `<div class="pptx-el pptx-text" style="${pptxInlineBoxStyle(element.box, presentationSize)}${fillStyle}${vAlign}${textCss}">${element.htmlParagraphs || ""}</div>`;
    }).join("");

    const fallbackBody = !model.elements.length
      ? `<div class="pptx-fallback">${model.fallbackParagraphs.map((line) => `<p>${escHtml(line)}</p>`).join("") || "<p>[No text content found on this slide]</p>"}</div>`
      : "";

    slides.push({
      number: i + 1,
      title: model.title,
      elementsHtml,
      fallbackBody,
      background: model.background
    });
  }

  const slideMarkup = slides.map((slide) => `
    <section class="pptx-slide">
      <div class="pptx-slide-kicker">Slide ${slide.number}</div>
      <h2>${escHtml(slide.title)}</h2>
      <div class="pptx-stage" style="height:${stageHeight}px${slide.background ? `;--pptx-slide-bg:${slide.background}` : ""}">
        ${slide.elementsHtml}
      </div>
      ${slide.fallbackBody}
    </section>
  `).join("\n");

  const extraStyles = `
    body {
      max-width: none;
      padding: 28px 32px;
      background: #f4f6fb;
    }
    .pptx-slides {
      display: grid;
      gap: 18px;
    }
    .pptx-slide {
      min-height: auto;
      padding: 28px 30px;
      border: 1px solid #d7dbe7;
      border-radius: 18px;
      background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
      box-shadow: 0 12px 36px rgba(29, 37, 59, 0.08);
      break-after: page;
      page-break-after: always;
      overflow: hidden;
      box-sizing: border-box;
    }
    .pptx-slide:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    .pptx-slide-kicker {
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 0.74rem;
      color: #6b7280;
      margin-bottom: 0.5rem;
    }
    .pptx-slide h2 {
      margin-top: 0;
      font-size: 1.35rem;
    }
    .pptx-stage {
      position: relative;
      width: 100%;
      background: var(--pptx-slide-bg, #ffffff);
      border: 1px solid #e3e7f0;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: inset 0 0 0 1px rgba(225, 231, 242, 0.4);
    }
    .pptx-el {
      position: absolute;
      box-sizing: border-box;
    }
    .pptx-image {
      padding: 0.2%;
    }
    .pptx-image img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }
    .pptx-text {
      padding-top: var(--pptx-tx-pad-top, 0.8%);
      padding-right: var(--pptx-tx-pad-right, 1%);
      padding-bottom: var(--pptx-tx-pad-bottom, 0.8%);
      padding-left: var(--pptx-tx-pad-left, 1%);
      overflow: auto;
      overflow-x: var(--pptx-tx-overflow-x, auto);
      overflow-y: var(--pptx-tx-overflow-y, auto);
      font-size: calc(clamp(11px, 1.45vw, 25px) * var(--pptx-font-scale, 1));
      line-height: 1.25;
      color: #111827;
      background: var(--pptx-text-fill, transparent);
      border: var(--pptx-shape-border, none);
      border-radius: var(--pptx-shape-radius, 0);
      clip-path: var(--pptx-shape-clip, none);
      white-space: var(--pptx-tx-wrap, normal);
      word-break: break-word;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
    }
    .pptx-text[style*="--pptx-text-v:middle"] {
      justify-content: center;
    }
    .pptx-text[style*="--pptx-text-v:bottom"] {
      justify-content: flex-end;
    }
    .pptx-text p {
      margin: 0 0 0.35em;
    }
    .pptx-text p:last-child {
      margin-bottom: 0;
    }
    .pptx-fallback {
      margin-top: 0.9rem;
      padding-top: 0.75rem;
      border-top: 1px dashed #d7dbe7;
      color: #4b5563;
      font-size: 0.92rem;
    }
    .pptx-fallback p {
      margin: 0.35rem 0;
    }
    .pptx-table {
      overflow: hidden;
      background: var(--pptx-table-fill, rgba(255, 255, 255, 0.95));
    }
    .pptx-table table {
      width: 100%;
      height: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: clamp(10px, 1.05vw, 15px);
      color: #1f2937;
    }
    .pptx-table td {
      border: 1px solid #94a3b8;
      padding: 4px 6px;
      vertical-align: top;
      overflow-wrap: anywhere;
      background-clip: padding-box;
    }
    .pptx-line {
      background: transparent;
      overflow: visible;
    }
    .pptx-line svg {
      width: 100%;
      height: 100%;
      display: block;
      color: var(--pptx-line-color, #4b5563);
    }
    .pptx-line line {
      stroke: var(--pptx-line-color, #4b5563);
      stroke-width: var(--pptx-line-width, 1.5pt);
      stroke-linecap: round;
      vector-effect: non-scaling-stroke;
      fill: none;
    }
  `;

  return htmlDoc(
    filename,
    `PowerPoint presentation · ${slides.length} slide${slides.length === 1 ? "" : "s"}`,
    `<div class="pptx-slides">${slideMarkup}</div>`,
    extraStyles
  );
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
