const DEFAULT_BLOCK_SIZE = 4096;
const DEFAULT_MAX_POINTS = 512;
const HIGH_ENTROPY_THRESHOLD = 7.5;

function shannonEntropy(block) {
  if (!block || block.length === 0) return 0;

  const histogram = new Uint32Array(256);
  for (let i = 0; i < block.length; i += 1) {
    histogram[block[i]] += 1;
  }

  let entropy = 0;
  const n = block.length;
  for (let i = 0; i < histogram.length; i += 1) {
    const count = histogram[i];
    if (count === 0) continue;
    const p = count / n;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

function computeEntropyProfile(bytes, options = {}) {
  const blockSize = Math.max(256, Number(options.blockSize) || DEFAULT_BLOCK_SIZE);
  const maxPoints = Math.max(32, Number(options.maxPoints) || DEFAULT_MAX_POINTS);
  const highEntropyThreshold = Number(options.highEntropyThreshold) || HIGH_ENTROPY_THRESHOLD;

  const totalBytes = bytes.length;
  const totalBlocks = Math.ceil(totalBytes / blockSize);

  if (totalBlocks === 0) {
    return {
      blockSize,
      totalBytes,
      totalBlocks: 0,
      sampledBlocks: 0,
      sampleStride: 1,
      points: [],
      summary: {
        min: 0,
        max: 0,
        mean: 0,
        highEntropyCount: 0,
        highEntropyThreshold,
      },
    };
  }

  const sampleStride = Math.max(1, Math.ceil(totalBlocks / maxPoints));
  const points = [];

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let highEntropyCount = 0;

  for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex += sampleStride) {
    const start = blockIndex * blockSize;
    const end = Math.min(start + blockSize, totalBytes);
    const entropy = shannonEntropy(bytes.subarray(start, end));

    points.push({
      index: blockIndex,
      offset: start,
      size: end - start,
      entropy,
    });

    if (entropy < min) min = entropy;
    if (entropy > max) max = entropy;
    sum += entropy;
    if (entropy >= highEntropyThreshold) {
      highEntropyCount += 1;
    }
  }

  const mean = points.length > 0 ? sum / points.length : 0;

  return {
    blockSize,
    totalBytes,
    totalBlocks,
    sampledBlocks: points.length,
    sampleStride,
    points,
    summary: {
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 0,
      mean,
      highEntropyCount,
      highEntropyThreshold,
    },
  };
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== "compute") return;

  const bytes = new Uint8Array(message.bytes || new ArrayBuffer(0));

  try {
    const profile = computeEntropyProfile(bytes, message.options || {});
    self.postMessage({ id: message.id, ok: true, profile });
  } catch (error) {
    self.postMessage({
      id: message.id,
      ok: false,
      error: error?.message || "Entropy worker failed",
    });
  }
};
