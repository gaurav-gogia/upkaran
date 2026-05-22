const MAX_SAMPLES = 200;
const samples = [];
let sampleSeq = 0;

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value == null) continue;
    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

function getUsedJsHeapMb() {
  try {
    const bytes = performance?.memory?.usedJSHeapSize;
    if (!Number.isFinite(bytes)) return null;
    return bytes / (1024 * 1024);
  } catch {
    return null;
  }
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] || 0;
}

function stdDev(values, mean) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const variance = values.reduce((sum, value) => {
    const d = value - mean;
    return sum + d * d;
  }, 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

export function recordPerfSample(operation, durationMs, meta = {}, status = "ok", error = "") {
  const memoryUsedMb = getUsedJsHeapMb();
  const sample = {
    seq: ++sampleSeq,
    at: new Date().toISOString(),
    operation: operation || "unknown_operation",
    durationMs: Math.max(0, Number(durationMs) || 0),
    meta: sanitizeMeta(meta),
    status: status === "error" ? "error" : "ok",
    error: error ? `${error}` : "",
    memoryUsedMb,
  };

  samples.push(sample);
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }

  return sample;
}

export async function measureAsync(operation, fn, meta = {}) {
  const start = nowMs();
  try {
    const result = await fn();
    const durationMs = nowMs() - start;
    const sample = recordPerfSample(operation, durationMs, meta, "ok");
    return { result, durationMs: sample.durationMs, sample };
  } catch (error) {
    const durationMs = nowMs() - start;
    recordPerfSample(operation, durationMs, meta, "error", error?.message || "Unknown error");
    throw error;
  }
}

export function getPerfSamples(limit = 50) {
  const size = Math.max(1, Number(limit) || 50);
  return samples.slice(-size);
}

export function getPerfSummary() {
  const byOperation = new Map();

  for (const sample of samples) {
    const key = sample.operation;
    const existing = byOperation.get(key) || {
      operation: key,
      count: 0,
      okCount: 0,
      errorCount: 0,
      totalMs: 0,
      minMs: Number.POSITIVE_INFINITY,
      maxMs: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      stdDevMs: 0,
      lastMs: 0,
      lastAt: "",
      memoryUsedMb: 0,
      durations: [],
    };

    existing.count += 1;
    if (sample.status === "error") existing.errorCount += 1;
    else existing.okCount += 1;
    existing.totalMs += sample.durationMs;
    existing.minMs = Math.min(existing.minMs, sample.durationMs);
    existing.maxMs = Math.max(existing.maxMs, sample.durationMs);
    existing.lastMs = sample.durationMs;
    existing.lastAt = sample.at;
    existing.memoryUsedMb = Number.isFinite(sample.memoryUsedMb) ? sample.memoryUsedMb : existing.memoryUsedMb;
    existing.durations.push(sample.durationMs);
    byOperation.set(key, existing);
  }

  return Array.from(byOperation.values())
    .map((row) => ({
      ...row,
      minMs: Number.isFinite(row.minMs) ? row.minMs : 0,
      avgMs: row.count > 0 ? row.totalMs / row.count : 0,
      p50Ms: percentile(row.durations, 50),
      p95Ms: percentile(row.durations, 95),
      stdDevMs: stdDev(row.durations, row.count > 0 ? row.totalMs / row.count : 0),
      errorRatePct: row.count > 0 ? (row.errorCount / row.count) * 100 : 0,
    }))
    .map((row) => ({
      ...row,
      durations: undefined,
    }))
    .sort((a, b) => b.avgMs - a.avgMs);
}

export function getPerfOverview() {
  const summary = getPerfSummary();
  const totalSamples = samples.length;
  const totalErrors = samples.filter((sample) => sample.status === "error").length;
  const latest = totalSamples > 0 ? samples[totalSamples - 1] : null;
  const slowest = samples.reduce((best, sample) => (sample.durationMs > (best?.durationMs || 0) ? sample : best), null);

  return {
    totalSamples,
    totalErrors,
    operationCount: summary.length,
    latest,
    slowest,
  };
}

export function getPerfTimeSeries(limit = 60) {
  const slice = getPerfSamples(limit);
  return slice.map((sample, index) => ({
    x: index,
    durationMs: sample.durationMs,
    operation: sample.operation,
    status: sample.status,
  }));
}

export function clearPerfSamples() {
  samples.length = 0;
}
