import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { PDFDocument, rgb } from "pdf-lib";
import { addPdfHeaderFooter, addPdfImageWatermark, addPdfTextWatermark, applyPdfMetadata, cropPdfPages, exportPdfA, ocrPdfPilot, repairPdf, reorderPdfPages, splitPdf, unlockPdf } from "../src/js/pdf-tools.js";
import { classifyOfficeExtension } from "../src/js/office-reliability.js";
import { ROUTES, resolveRoute, resolveRouteFromSelection } from "../src/routes/router.js";
import { decideDropRouting } from "../src/js/drop-routing.js";
import { classifyUnlockError, validateLockConfirmation, validateLockPassword } from "../src/js/pdf-security.js";
import { resolveProtectPresetConfig, validateUnlockPresetStrategy } from "../src/js/pdf-protect-presets.js";
import { applyOutputNamingTemplate } from "../src/js/output-naming.js";

const ROOT = process.cwd();
const FIXTURE_DIR = path.join(ROOT, "fixtures", "reliability", "pdf");
const ASSET_DIR = path.join(ROOT, "fixtures", "reliability", "assets");
const OFFICE_DIR = path.join(ROOT, "fixtures", "reliability", "office");
const RESULT_PATH = path.join(ROOT, "fixtures", "reliability", "results", "latest.json");
const APP_PATH = path.join(ROOT, "src", "App.svelte");
const PDF_TOOLS_PATH = path.join(ROOT, "src", "components", "PdfTools.svelte");

class NamedBlob extends Blob {
  constructor(parts, options, name) {
    super(parts, options);
    this.name = name;
    this.lastModified = Date.now();
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function writePdf(filePath, builder) {
  const doc = await PDFDocument.create();
  await builder(doc);
  const bytes = await doc.save();
  fs.writeFileSync(filePath, Buffer.from(bytes));
}

async function createFixtures() {
  ensureDir(FIXTURE_DIR);
  ensureDir(ASSET_DIR);
  ensureDir(OFFICE_DIR);

  await writePdf(path.join(FIXTURE_DIR, "basic-a4.pdf"), async (doc) => {
    const page = doc.addPage([595, 842]);
    page.drawText("Baseline fixture: basic A4", {
      x: 64,
      y: 760,
      size: 18,
      color: rgb(0.1, 0.1, 0.1)
    });
  });

  await writePdf(path.join(FIXTURE_DIR, "multi-page-mixed-size.pdf"), async (doc) => {
    const p1 = doc.addPage([595, 842]);
    p1.drawText("Page 1 - Portrait", { x: 64, y: 760, size: 16 });
    const p2 = doc.addPage([842, 595]);
    p2.drawText("Page 2 - Landscape", { x: 64, y: 520, size: 16 });
  });

  await writePdf(path.join(FIXTURE_DIR, "landscape-report.pdf"), async (doc) => {
    const page = doc.addPage([842, 595]);
    page.drawText("Landscape report fixture", { x: 72, y: 520, size: 20 });
  });

  await writePdf(path.join(FIXTURE_DIR, "clean-reference.pdf"), async (doc) => {
    const page = doc.addPage([595, 842]);
    page.drawText("Clean reference for repair", { x: 64, y: 760, size: 16 });
  });

  const cleanBytes = fs.readFileSync(path.join(FIXTURE_DIR, "clean-reference.pdf"));
  const malformed = cleanBytes.subarray(0, Math.max(256, Math.floor(cleanBytes.length * 0.55)));
  fs.writeFileSync(path.join(FIXTURE_DIR, "malformed-stream.pdf"), malformed);

  // 1x1 transparent PNG
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WfN4z8AAAAASUVORK5CYII=";
  fs.writeFileSync(path.join(ASSET_DIR, "wm-dot.png"), Buffer.from(pngBase64, "base64"));

  const officeFixtures = [
    "sample.docx",
    "sample.pptx",
    "sample.xlsx",
    "legacy.doc",
    "legacy.ppt",
    "legacy.xls",
    "odf.odt"
  ];
  for (const name of officeFixtures) {
    fs.writeFileSync(path.join(OFFICE_DIR, name), "office-fixture-placeholder\n", "utf8");
  }
}

function toEntry(filePath) {
  const bytes = fs.readFileSync(filePath);
  const name = path.basename(filePath);
  const file = new NamedBlob([bytes], { type: "application/pdf" }, name);
  return {
    id: `fixture:${name}`,
    name,
    size: file.size,
    file
  };
}

function toImageBlob(filePath) {
  const bytes = fs.readFileSync(filePath);
  const name = path.basename(filePath);
  return new NamedBlob([bytes], { type: "image/png" }, name);
}

function officeFixturePath(name) {
  return `office/${name}`;
}

function routeFixturePath(name) {
  return `app/routes/${name}`;
}

function makeUnlockRuntime(expectedPassword) {
  return {
    getDocument: ({ password }) => ({
      promise: (async () => {
        if (!password) {
          throw { name: "PasswordException" };
        }
        if (password !== expectedPassword) {
          throw { name: "PasswordException" };
        }
        return {
          numPages: 1,
          getPage: async () => ({
            getViewport: () => ({ width: 120, height: 160 }),
            render: () => ({ promise: Promise.resolve() })
          })
        };
      })()
    })
  };
}

function makeRepairRuntime(mode = "ok") {
  return {
    getDocument: () => ({
      promise: (async () => {
        if (mode === "password") {
          throw { name: "PasswordException" };
        }
        if (mode === "broken") {
          throw new Error("corrupt xref");
        }
        return {
          numPages: 1,
          getPage: async () => ({
            getViewport: () => ({ width: 120, height: 160 }),
            render: () => ({ promise: Promise.resolve() })
          })
        };
      })()
    })
  };
}

function makeCanvasStub() {
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WfN4z8AAAAASUVORK5CYII=";
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: "#ffffff",
      fillRect: () => {}
    }),
    toDataURL: () => dataUrl
  };
}

async function runCheck(operation, fixture, fn, passPredicate) {
  const started = performance.now();
  try {
    const result = await fn();
    const durationMs = performance.now() - started;
    const pass = passPredicate(result);
    return {
      operation,
      fixture,
      status: pass ? "pass" : "fail",
      durationMs,
      note: pass ? "ok" : "unexpected result",
      at: new Date().toISOString()
    };
  } catch (error) {
    const durationMs = performance.now() - started;
    return {
      operation,
      fixture,
      status: "fail",
      durationMs,
      note: error?.message || "unknown error",
      at: new Date().toISOString()
    };
  }
}

async function main() {
  await createFixtures();

  const wmImage = toImageBlob(path.join(ASSET_DIR, "wm-dot.png"));

  const checks = [
    {
      operation: "pdf.watermark.image",
      fixture: "pdf/basic-a4.pdf",
      fn: () => addPdfImageWatermark(toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")), wmImage, {}),
      pass: (output) => output instanceof Blob && output.size > 0
    },
    {
      operation: "pdf.watermark.image",
      fixture: "pdf/multi-page-mixed-size.pdf",
      fn: () => addPdfImageWatermark(toEntry(path.join(FIXTURE_DIR, "multi-page-mixed-size.pdf")), wmImage, {}),
      pass: (output) => output instanceof Blob && output.size > 0
    },
    {
      operation: "pdf.watermark.text",
      fixture: "pdf/basic-a4.pdf",
      fn: () => addPdfTextWatermark(toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")), { text: "CONFIDENTIAL" }),
      pass: (output) => output instanceof Blob && output.size > 0
    },
    {
      operation: "pdf.watermark.text",
      fixture: "pdf/landscape-report.pdf",
      fn: () => addPdfTextWatermark(toEntry(path.join(FIXTURE_DIR, "landscape-report.pdf")), { text: "DRAFT", position: "top-right" }),
      pass: (output) => output instanceof Blob && output.size > 0
    },
    {
      operation: "pdf.repair",
      fixture: "pdf/clean-reference.pdf",
      fn: () => repairPdf(toEntry(path.join(FIXTURE_DIR, "clean-reference.pdf"))),
      pass: (output) => output && (output.status === "unchanged" || output.status === "repaired")
    },
    {
      operation: "pdf.repair",
      fixture: "pdf/malformed-stream.pdf",
      fn: async () => {
        try {
          return await repairPdf(toEntry(path.join(FIXTURE_DIR, "malformed-stream.pdf")));
        } catch (error) {
          if (error?.repairStatus === "unrecoverable") {
            return { status: "unrecoverable" };
          }
          throw error;
        }
      },
      pass: (output) => output && (output.status === "repaired" || output.status === "unrecoverable")
    },
    {
      operation: "pdf.crop",
      fixture: "pdf/basic-a4.pdf",
      fn: () => cropPdfPages(toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")), {
        top: 24,
        right: 24,
        bottom: 24,
        left: 24
      }),
      pass: (output) => output instanceof Blob && output.size > 0
    },
    {
      operation: "pdf.crop",
      fixture: "pdf/multi-page-mixed-size.pdf",
      fn: () => cropPdfPages(toEntry(path.join(FIXTURE_DIR, "multi-page-mixed-size.pdf")), {
        selection: "1-2",
        top: 12,
        right: 18,
        bottom: 12,
        left: 18
      }),
      pass: (output) => output instanceof Blob && output.size > 0
    },
    {
      operation: "pdf.reorder",
      fixture: "pdf/multi-page-mixed-size.pdf::reverse",
      fn: () => reorderPdfPages(toEntry(path.join(FIXTURE_DIR, "multi-page-mixed-size.pdf")), [2, 1]),
      pass: (output) => output instanceof Blob && output.size > 0
    },
    {
      operation: "pdf.reorder",
      fixture: "pdf/basic-a4.pdf::identity",
      fn: () => reorderPdfPages(toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")), [1]),
      pass: (output) => output instanceof Blob && output.size > 0
    },
    {
      operation: "pdf.reorder",
      fixture: "pdf/multi-page-mixed-size.pdf::duplicate-order",
      fn: async () => {
        try {
          await reorderPdfPages(toEntry(path.join(FIXTURE_DIR, "multi-page-mixed-size.pdf")), [1, 1]);
          return { status: "unexpected-pass" };
        } catch (error) {
          return { status: "expected-fail", message: error?.message || "" };
        }
      },
      pass: (output) => output?.status === "expected-fail" && /duplicate|exactly once/i.test(output?.message || "")
    },
    {
      operation: "pdf.split.size",
      fixture: "pdf/multi-page-mixed-size.pdf::size-small-limit",
      fn: () => splitPdf(toEntry(path.join(FIXTURE_DIR, "multi-page-mixed-size.pdf")), { mode: "size", maxChunkMb: 0.001 }),
      pass: (output) => Array.isArray(output) && output.length >= 2 && output.every((blob) => blob instanceof Blob)
    },
    {
      operation: "pdf.split.size",
      fixture: "pdf/basic-a4.pdf::size-invalid-limit",
      fn: async () => {
        try {
          await splitPdf(toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")), { mode: "size", maxChunkMb: 0 });
          return { status: "unexpected-pass" };
        } catch (error) {
          return { status: "expected-fail", message: error?.message || "" };
        }
      },
      pass: (output) => output?.status === "expected-fail" && /greater than 0 mb/i.test(output?.message || "")
    },
    {
      operation: "pdf.pdfa.export",
      fixture: "pdf/basic-a4.pdf::profile-2b-success",
      fn: () =>
        exportPdfA(
          toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")),
          { profile: "pdfa-2b" },
          () => {},
          {
            moduleLoader: async () => ({ ready: true }),
            exportFn: (bytes) => bytes
          }
        ),
      pass: (output) => output instanceof Blob && output.size > 0
    },
    {
      operation: "pdf.pdfa.export",
      fixture: "pdf/basic-a4.pdf::profile-invalid",
      fn: async () => {
        try {
          await exportPdfA(toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")), { profile: "pdfa-x" });
          return { status: "unexpected-pass" };
        } catch (error) {
          return { status: "expected-fail", message: error?.message || "" };
        }
      },
      pass: (output) => output?.status === "expected-fail" && /unsupported pdf\/a profile/i.test(output?.message || "")
    },
    {
      operation: "pdf.pdfa.export",
      fixture: "pdf/basic-a4.pdf::runtime-unavailable",
      fn: async () => {
        try {
          await exportPdfA(
            toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")),
            { profile: "pdfa-2b" },
            () => {},
            {
              moduleLoader: async () => null,
              exportFn: null
            }
          );
          return { status: "unexpected-pass" };
        } catch (error) {
          return {
            status: "expected-fail",
            code: error?.exportCode || "",
            exportStatus: error?.exportStatus || "",
            message: `${error?.message || ""}`
          };
        }
      },
      pass: (output) => output?.status === "expected-fail" && output?.code === "pdfa_unavailable" && output?.exportStatus === "limited"
    },
    {
      operation: "pdf.metadata.batch",
      fixture: "pdf/basic-a4.pdf::metadata-valid",
      fn: () =>
        applyPdfMetadata(toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")), {
          title: "Quarterly Report",
          author: "Upkaran QA",
          subject: "Reliability",
          keywords: "pdf,metadata,qa"
        }),
      pass: (output) => output instanceof Blob && output.size > 0
    },
    {
      operation: "pdf.metadata.batch",
      fixture: "pdf/basic-a4.pdf::metadata-invalid-title-length",
      fn: async () => {
        try {
          await applyPdfMetadata(toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")), {
            title: "X".repeat(300)
          });
          return { status: "unexpected-pass" };
        } catch (error) {
          return { status: "expected-fail", message: error?.message || "" };
        }
      },
      pass: (output) => output?.status === "expected-fail" && /title is too long/i.test(output?.message || "")
    },
    {
      operation: "pdf.output.naming",
      fixture: "pdf/naming::collision-dedupe",
      fn: () =>
        applyOutputNamingTemplate(
          [
            { name: "report.pdf", blob: new Blob(["a"]) },
            { name: "report.pdf", blob: new Blob(["b"]) }
          ],
          {
            template: "{name}-{op}.{ext}",
            operation: "metadata"
          }
        ),
      pass: (output) => Array.isArray(output) && output.length === 2 && output[0].name !== output[1].name
    },
    {
      operation: "pdf.output.naming",
      fixture: "pdf/naming::missing-extension-template",
      fn: () =>
        applyOutputNamingTemplate(
          [{ name: "invoice.pdf", blob: new Blob(["a"]) }],
          {
            template: "{name}-{op}-{index}",
            operation: "compress"
          }
        ),
      pass: (output) => Array.isArray(output) && output[0]?.name?.toLowerCase().endsWith(".pdf")
    },
    {
      operation: "pdf.protect.presets",
      fixture: "pdf/protect::preset-conflict",
      fn: async () => {
        try {
          resolveProtectPresetConfig({
            preset: "locked_down",
            permissions: { print: true }
          });
          return { status: "unexpected-pass" };
        } catch (error) {
          return { status: "expected-fail", code: error?.code || "", message: error?.message || "" };
        }
      },
      pass: (output) => output?.status === "expected-fail" && output?.code === "protect_preset_conflict"
    },
    {
      operation: "pdf.protect.presets",
      fixture: "pdf/protect::invalid-permission-combo",
      fn: async () => {
        try {
          resolveProtectPresetConfig({
            preset: "custom",
            permissions: { print: true, copy: true, edit: true }
          });
          return { status: "unexpected-pass" };
        } catch (error) {
          return { status: "expected-fail", code: error?.code || "", message: error?.message || "" };
        }
      },
      pass: (output) => output?.status === "expected-fail" && output?.code === "protect_invalid_permissions"
    },
    {
      operation: "pdf.protect.presets",
      fixture: "pdf/unprotect::strategy-conflict",
      fn: async () => {
        try {
          validateUnlockPresetStrategy({ strategy: "password_required", password: "" });
          return { status: "unexpected-pass" };
        } catch (error) {
          return { status: "expected-fail", code: error?.code || "" };
        }
      },
      pass: (output) => output?.status === "expected-fail" && output?.code === "unlock_strategy_conflict"
    },
    {
      operation: "pdf.header-footer.presets",
      fixture: "pdf/basic-a4.pdf::header-footer-confidential",
      fn: () => addPdfHeaderFooter(toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")), { preset: "confidential" }),
      pass: (output) => output instanceof Blob && output.size > 0
    },
    {
      operation: "pdf.header-footer.presets",
      fixture: "pdf/basic-a4.pdf::header-footer-custom-empty",
      fn: async () => {
        try {
          await addPdfHeaderFooter(toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")), { preset: "custom", headerText: "", footerText: "" });
          return { status: "unexpected-pass" };
        } catch (error) {
          return { status: "expected-fail", message: error?.message || "" };
        }
      },
      pass: (output) => output?.status === "expected-fail" && /requires header text or footer text/i.test(output?.message || "")
    },
    {
      operation: "pdf.lock-unlock.policy",
      fixture: "pdf/security::balanced-too-short",
      fn: () => validateLockPassword("Ab1!xy", "balanced"),
      pass: (output) => output?.ok === false && output?.code === "too_short"
    },
    {
      operation: "pdf.lock-unlock.policy",
      fixture: "pdf/security::balanced-missing-digit",
      fn: () => validateLockPassword("Abcdefghij!", "balanced"),
      pass: (output) => output?.ok === false && output?.code === "missing_digit"
    },
    {
      operation: "pdf.lock-unlock.policy",
      fixture: "pdf/security::strong-missing-symbol",
      fn: () => validateLockPassword("AbcdefghijkL12", "strong"),
      pass: (output) => output?.ok === false && output?.code === "missing_symbol"
    },
    {
      operation: "pdf.lock-unlock.policy",
      fixture: "pdf/security::strong-valid",
      fn: () => validateLockPassword("AbcdefghijkL12!", "strong"),
      pass: (output) => output?.ok === true
    },
    {
      operation: "pdf.lock-unlock.policy",
      fixture: "pdf/security::confirm-mismatch",
      fn: () => validateLockConfirmation("Abcdef12!", "Abcdef12?"),
      pass: (output) => output?.ok === false && output?.code === "mismatch"
    },
    {
      operation: "pdf.lock-unlock.policy",
      fixture: "pdf/security::unlock-password-required",
      fn: () => classifyUnlockError({ needsPassword: true, message: "This PDF is password-protected. Enter the password to unlock it." }),
      pass: (output) => output?.kind === "password_required"
    },
    {
      operation: "pdf.lock-unlock.policy",
      fixture: "pdf/security::unlock-incorrect-password",
      fn: () => classifyUnlockError(new Error("Incorrect password. Please try again.")),
      pass: (output) => output?.kind === "incorrect_password"
    },
    {
      operation: "pdf.lock-unlock.policy",
      fixture: "pdf/security::unlock-open-failed",
      fn: () => classifyUnlockError(new Error("Could not open PDF: runtime unavailable")),
      pass: (output) => output?.kind === "open_failed"
    },
    {
      operation: "pdf.unlock.runtime",
      fixture: "pdf/security-runtime::password-required",
      fn: async () => {
        try {
          await unlockPdf(
            toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")),
            "",
            () => {},
            {
              forceRuntime: true,
              runtime: makeUnlockRuntime("S3cur3!Pass"),
              createCanvas: makeCanvasStub,
              fetch: globalThis.fetch
            }
          );
          return { status: "unexpected-pass" };
        } catch (error) {
          return classifyUnlockError(error);
        }
      },
      pass: (output) => output?.kind === "password_required"
    },
    {
      operation: "pdf.unlock.runtime",
      fixture: "pdf/security-runtime::incorrect-password",
      fn: async () => {
        try {
          await unlockPdf(
            toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")),
            "bad-pass",
            () => {},
            {
              forceRuntime: true,
              runtime: makeUnlockRuntime("S3cur3!Pass"),
              createCanvas: makeCanvasStub,
              fetch: globalThis.fetch
            }
          );
          return { status: "unexpected-pass" };
        } catch (error) {
          return classifyUnlockError(error);
        }
      },
      pass: (output) => output?.kind === "incorrect_password"
    },
    {
      operation: "pdf.unlock.runtime",
      fixture: "pdf/security-runtime::valid-password",
      fn: () =>
        unlockPdf(
          toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")),
          "S3cur3!Pass",
          () => {},
          {
            forceRuntime: true,
            runtime: makeUnlockRuntime("S3cur3!Pass"),
            createCanvas: makeCanvasStub,
            fetch: globalThis.fetch
          }
        ),
      pass: (output) => output instanceof Blob && output.size > 0
    },
    {
      operation: "pdf.repair.unlock-interaction",
      fixture: "pdf/repair-security::unlock-required-before-repair",
      fn: async () => {
        try {
          await repairPdf(
            toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")),
            () => {},
            {
              forceRuntime: true,
              runtime: makeRepairRuntime("password"),
              createCanvas: makeCanvasStub,
              fetch: globalThis.fetch
            }
          );
          return { status: "unexpected-pass" };
        } catch (error) {
          return {
            repairStatus: error?.repairStatus || "",
            message: `${error?.message || ""}`
          };
        }
      },
      pass: (output) => output?.repairStatus === "unrecoverable" && /unlock it first/i.test(output?.message || "")
    },
    {
      operation: "pdf.repair.unlock-interaction",
      fixture: "pdf/repair-security::unrecoverable-encrypted-classification",
      fn: async () => {
        try {
          await repairPdf(
            toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")),
            () => {},
            {
              forceRuntime: true,
              runtime: makeRepairRuntime("broken"),
              createCanvas: makeCanvasStub,
              fetch: globalThis.fetch
            }
          );
          return { status: "unexpected-pass" };
        } catch (error) {
          return {
            repairStatus: error?.repairStatus || "",
            message: `${error?.message || ""}`
          };
        }
      },
      pass: (output) => output?.repairStatus === "unrecoverable" && /could not be recovered/i.test(output?.message || "")
    },
    {
      operation: "pdf.ocr.pilot",
      fixture: "pdf/basic-a4.pdf",
      fn: () => ocrPdfPilot(toEntry(path.join(FIXTURE_DIR, "basic-a4.pdf")), {
        language: "eng",
        strategy: "searchable-overlay"
      }),
      pass: (output) => output && (output.status === "limited" || output.status === "processed")
    },
    {
      operation: "content.office.reliability",
      fixture: officeFixturePath("sample.docx"),
      fn: () => classifyOfficeExtension("docx"),
      pass: (output) => output?.status === "supported"
    },
    {
      operation: "content.office.reliability",
      fixture: officeFixturePath("sample.pptx"),
      fn: () => classifyOfficeExtension("pptx"),
      pass: (output) => output?.status === "supported"
    },
    {
      operation: "content.office.reliability",
      fixture: officeFixturePath("sample.xlsx"),
      fn: () => classifyOfficeExtension("xlsx"),
      pass: (output) => output?.status === "supported"
    },
    {
      operation: "content.office.reliability",
      fixture: officeFixturePath("legacy.doc"),
      fn: () => classifyOfficeExtension("doc"),
      pass: (output) => output?.status === "unsupported" && output?.code === "legacy_word"
    },
    {
      operation: "content.office.reliability",
      fixture: officeFixturePath("legacy.ppt"),
      fn: () => classifyOfficeExtension("ppt"),
      pass: (output) => output?.status === "unsupported" && output?.code === "legacy_powerpoint"
    },
    {
      operation: "content.office.reliability",
      fixture: officeFixturePath("legacy.xls"),
      fn: () => classifyOfficeExtension("xls"),
      pass: (output) => output?.status === "unsupported" && output?.code === "legacy_excel"
    },
    {
      operation: "content.office.reliability",
      fixture: officeFixturePath("odf.odt"),
      fn: () => classifyOfficeExtension("odt"),
      pass: (output) => output?.status === "unsupported" && output?.code === "odf_text"
    },
    {
      operation: "app.tier-a.route-smoke",
      fixture: routeFixturePath("pdf-route-resolution"),
      fn: () => resolveRoute([{ name: "invoice.pdf", type: "application/pdf" }]),
      pass: (output) => output === ROUTES.PDF
    },
    {
      operation: "app.tier-a.route-smoke",
      fixture: routeFixturePath("selection-priority"),
      fn: () =>
        resolveRouteFromSelection(
          [{ name: "readme.txt", type: "text/plain" }, { name: "report.pdf", type: "application/pdf" }],
          [{ name: "report.pdf", type: "application/pdf" }]
        ),
      pass: (output) => output?.route === ROUTES.PDF && (output?.activeFiles?.length || 0) === 1
    },
    {
      operation: "app.tier-a.route-smoke",
      fixture: routeFixturePath("drop-routing-mixed-bucket"),
      fn: () =>
        decideDropRouting([
          { kind: "pdf", name: "a.pdf" },
          { kind: "pdf", name: "b.pdf" },
          { kind: "image", name: "scan.png" }
        ]),
      pass: (output) => output?.route === ROUTES.PDF && output?.autoSelected === true && output?.skippedCount === 1
    },
    {
      operation: "app.tier-a.route-smoke",
      fixture: routeFixturePath("app-pdf-entrypoint"),
      fn: () => {
        const source = fs.readFileSync(APP_PATH, "utf8");
        return source.includes("{#if route === ROUTES.PDF}") && source.includes("<PdfTools");
      },
      pass: (output) => output === true
    },
    {
      operation: "app.tier-a.route-smoke",
      fixture: routeFixturePath("pdf-tool-actions"),
      fn: () => {
        const source = fs.readFileSync(PDF_TOOLS_PATH, "utf8");
        return (
          source.includes("addPdfTextWatermark") &&
          source.includes("repairPdf") &&
          source.includes("ocrPdfPilot")
        );
      },
      pass: (output) => output === true
    }
  ];

  const results = [];
  for (const check of checks) {
    const row = await runCheck(check.operation, check.fixture, check.fn, check.pass);
    results.push(row);
  }

  ensureDir(path.dirname(RESULT_PATH));
  fs.writeFileSync(
    RESULT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)
  );

  const passCount = results.filter((r) => r.status === "pass").length;
  console.log(`Sample reliability run complete: ${passCount}/${results.length} checks passed.`);
  console.log(`Results written: ${RESULT_PATH}`);
}

main().catch((error) => {
  console.error("Failed to run reliability samples:", error);
  process.exit(1);
});
