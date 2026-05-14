const DEFAULT_BLOCK_SIZE = 4096;
const DEFAULT_MAX_POINTS = 512;
const HIGH_ENTROPY_THRESHOLD = 7.5;
const DEFAULT_WORKER_MIN_BYTES = 256 * 1024;

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

async function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input?.arrayBuffer) {
    const buffer = await input.arrayBuffer();
    return new Uint8Array(buffer);
  }
  throw new Error("Unsupported entropy input");
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
        highEntropyThreshold
      }
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
      entropy
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
      highEntropyThreshold
    }
  };
}

function workerSupported() {
  return typeof Worker !== "undefined";
}

function prepareTransferBuffer(bytes) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  return bytes.slice().buffer;
}

async function calculateEntropyProfileWithWorker(bytes, options = {}) {
  const worker = new Worker(new URL("./workers/entropy.worker.js", import.meta.url), { type: "module" });
  const requestId = `entropy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const transferBuffer = prepareTransferBuffer(bytes);

  try {
    return await new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const message = event.data || {};
        if (message.id !== requestId) return;

        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);

        if (message.ok) {
          resolve(message.profile);
          return;
        }

        reject(new Error(message.error || "Entropy worker failed"));
      };

      const onError = () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        reject(new Error("Entropy worker crashed"));
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);

      worker.postMessage(
        {
          type: "compute",
          id: requestId,
          bytes: transferBuffer,
          options,
        },
        [transferBuffer]
      );
    });
  } finally {
    worker.terminate();
  }
}

export async function calculateEntropyProfile(input, options = {}) {
  const bytes = await toUint8Array(input);
  const useWorker = options.useWorker !== false;
  const workerMinBytes = Math.max(0, Number(options.workerMinBytes) || DEFAULT_WORKER_MIN_BYTES);

  if (useWorker && workerSupported() && bytes.length >= workerMinBytes) {
    try {
      return await calculateEntropyProfileWithWorker(bytes, options);
    } catch {
      // Fall back to main-thread computation if worker setup or execution fails.
    }
  }

  return computeEntropyProfile(bytes, options);
}
