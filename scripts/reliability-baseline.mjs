import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, "fixtures", "reliability", "manifest.json");
const RESULT_PATH = path.join(ROOT, "fixtures", "reliability", "results", "latest.json");
const REPORT_DIR = path.join(ROOT, "fixtures", "reliability", "reports");
const REPORT_JSON = path.join(REPORT_DIR, "baseline-latest.json");
const REPORT_MD = path.join(REPORT_DIR, "baseline-latest.md");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] || 0;
}

function formatPct(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function buildOperationRows(operations, results) {
  return operations.map((op) => {
    const rows = results.filter((item) => item.operation === op.id);
    const total = rows.length;
    const passed = rows.filter((item) => item.status === "pass").length;
    const failed = rows.filter((item) => item.status === "fail").length;
    const durations = rows
      .map((item) => Number(item.durationMs))
      .filter((value) => Number.isFinite(value) && value >= 0);

    return {
      id: op.id,
      title: op.title,
      tier: op.tier,
      total,
      passed,
      failed,
      passRate: total > 0 ? passed / total : 0,
      p95Ms: durations.length > 0 ? percentile(durations, 95) : 0,
      fixturesExpected: Array.isArray(op.fixtures) ? op.fixtures.length : 0
    };
  });
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Reliability Baseline Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Overview");
  lines.push("");
  lines.push(`- Total operations tracked: ${report.overview.operationCount}`);
  lines.push(`- Total checks recorded: ${report.overview.totalChecks}`);
  lines.push(`- Total pass rate: ${formatPct(report.overview.totalPassRate)}`);
  lines.push(`- Global p95 runtime: ${Math.round(report.overview.globalP95Ms)} ms`);
  lines.push("");
  lines.push("## Per-operation");
  lines.push("");
  lines.push("| Operation | Tier | Checks | Pass | Fail | Pass rate | p95 ms | Expected fixtures |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of report.operations) {
    lines.push(`| ${row.title} (${row.id}) | ${row.tier} | ${row.total} | ${row.passed} | ${row.failed} | ${formatPct(row.passRate)} | ${Math.round(row.p95Ms)} | ${row.fixturesExpected} |`);
  }
  lines.push("");

  if (report.overview.totalChecks === 0) {
    lines.push("## Next step");
    lines.push("");
    lines.push("- No run results found yet. Populate fixtures/reliability/results/latest.json and rerun this command.");
  }

  return `${lines.join("\n")}\n`;
}

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error("Missing fixtures manifest:", MANIFEST_PATH);
  process.exit(1);
}

const manifest = readJson(MANIFEST_PATH);
const operations = Array.isArray(manifest.operations) ? manifest.operations : [];
const results = fs.existsSync(RESULT_PATH)
  ? (Array.isArray(readJson(RESULT_PATH).results) ? readJson(RESULT_PATH).results : [])
  : [];

const operationRows = buildOperationRows(operations, results);
const allDurations = results
  .map((item) => Number(item.durationMs))
  .filter((value) => Number.isFinite(value) && value >= 0);
const totalChecks = results.length;
const totalPass = results.filter((item) => item.status === "pass").length;

const report = {
  generatedAt: new Date().toISOString(),
  overview: {
    operationCount: operationRows.length,
    totalChecks,
    totalPassRate: totalChecks > 0 ? totalPass / totalChecks : 0,
    globalP95Ms: allDurations.length > 0 ? percentile(allDurations, 95) : 0
  },
  operations: operationRows
};

ensureDir(REPORT_DIR);
fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
fs.writeFileSync(REPORT_MD, buildMarkdown(report));

console.log("Reliability baseline written:");
console.log("-", REPORT_JSON);
console.log("-", REPORT_MD);
