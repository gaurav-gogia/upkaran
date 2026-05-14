const MAX_SAMPLES = 200;
const samples = [];

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

export function recordPerfSample(operation, durationMs, meta = {}) {
  const sample = {
    at: new Date().toISOString(),
    operation: operation || "unknown_operation",
    durationMs: Math.max(0, Number(durationMs) || 0),
    meta: sanitizeMeta(meta),
  };

  samples.push(sample);
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }

  return sample;
}

export async function measureAsync(operation, fn, meta = {}) {
  const start = nowMs();
  const result = await fn();
  const durationMs = nowMs() - start;
  const sample = recordPerfSample(operation, durationMs, meta);
  return { result, durationMs: sample.durationMs, sample };
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
      totalMs: 0,
      minMs: Number.POSITIVE_INFINITY,
      maxMs: 0,
      avgMs: 0,
      lastMs: 0,
      lastAt: "",
    };

    existing.count += 1;
    existing.totalMs += sample.durationMs;
    existing.minMs = Math.min(existing.minMs, sample.durationMs);
    existing.maxMs = Math.max(existing.maxMs, sample.durationMs);
    existing.lastMs = sample.durationMs;
    existing.lastAt = sample.at;
    byOperation.set(key, existing);
  }

  return Array.from(byOperation.values())
    .map((row) => ({
      ...row,
      minMs: Number.isFinite(row.minMs) ? row.minMs : 0,
      avgMs: row.count > 0 ? row.totalMs / row.count : 0,
    }))
    .sort((a, b) => b.avgMs - a.avgMs);
}

export function clearPerfSamples() {
  samples.length = 0;
}
