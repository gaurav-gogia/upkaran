const _MD5_T = Array.from({ length: 64 }, (_, i) => (Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
const _MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

function md5Hex(bytes) {
  const len = bytes.length;
  const bitLen = len * 8;
  const padLen = (len % 64) < 56 ? 56 - (len % 64) : 120 - (len % 64);
  const padded = new Uint8Array(len + padLen + 8);
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(len + padLen, bitLen & 0xffffffff, true);
  dv.setUint32(len + padLen + 4, Math.floor(bitLen / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let blk = 0; blk < padded.length; blk += 64) {
    const W = Array.from({ length: 16 }, (_, i) => dv.getUint32(blk + i * 4, true));
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let F;
      let g;
      if (i < 16) {
        F = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        F = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        F = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      F = ((F >>> 0) + a + _MD5_T[i] + W[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((F << _MD5_S[i]) | (F >>> (32 - _MD5_S[i])))) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const r = new Uint8Array(16);
  const rv = new DataView(r.buffer);
  rv.setUint32(0, a0, true);
  rv.setUint32(4, b0, true);
  rv.setUint32(8, c0, true);
  rv.setUint32(12, d0, true);
  return Array.from(r).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hexDigest(buffer, algo) {
  const hashBuffer = await crypto.subtle.digest(algo, buffer);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function computeHashes(buffer) {
  const [sha256, sha1] = await Promise.all([
    hexDigest(buffer, "SHA-256"),
    hexDigest(buffer, "SHA-1"),
  ]);

  const md5 = md5Hex(new Uint8Array(buffer));
  return { md5, sha1, sha256 };
}

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type !== "compute") return;

  try {
    const hashes = await computeHashes(message.buffer || new ArrayBuffer(0));
    self.postMessage({ id: message.id, ok: true, hashes });
  } catch (error) {
    self.postMessage({
      id: message.id,
      ok: false,
      error: error?.message || "Hash worker failed",
    });
  }
};
