/**
 * P2P file transfer using WebRTC DataChannels.
 * Signaling tokens are JSON-compressed-base64, suitable for both QR codes and text paste.
 */

import { deflateSync, inflateSync, strToU8, strFromU8 } from "fflate";

const CHUNK_SIZE = 65536; // 64 KB per chunk
const BUFFER_HIGH_WATER = 1024 * 1024; // pause sending above 1 MB buffered
const BUFFER_LOW_WATER = 256 * 1024; // resume when buffer drops to 256 KB
const ICE_GATHERING_TIMEOUT_MS = 7000;
const DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const TURN_CONFIG_STORAGE_KEY = "upkaran.p2p.turnConfig";
const SDP_DEBUG_STORAGE_KEY = "upkaran.p2p.debugSdp";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeTurnUrls(urls) {
  if (Array.isArray(urls)) {
    return urls.map((value) => `${value}`.trim()).filter(Boolean);
  }
  return `${urls ?? ""}`
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeTurnConfig(config = {}) {
  const urls = normalizeTurnUrls(config.urls);
  const username = `${config.username ?? ""}`.trim();
  const credential = `${config.credential ?? ""}`.trim();
  const credentialType = config.credentialType === "oauth" ? "oauth" : "password";
  return {
    enabled: Boolean(config.enabled) && urls.length > 0,
    urls,
    username,
    credential,
    credentialType
  };
}

export function getTurnConfig() {
  if (!canUseStorage()) {
    return normalizeTurnConfig();
  }

  try {
    const raw = window.localStorage.getItem(TURN_CONFIG_STORAGE_KEY);
    if (!raw) {
      return normalizeTurnConfig();
    }
    return normalizeTurnConfig(JSON.parse(raw));
  } catch {
    return normalizeTurnConfig();
  }
}

export function saveTurnConfig(config) {
  const normalized = normalizeTurnConfig(config);
  if (canUseStorage()) {
    window.localStorage.setItem(TURN_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function clearTurnConfig() {
  if (canUseStorage()) {
    window.localStorage.removeItem(TURN_CONFIG_STORAGE_KEY);
  }
  return normalizeTurnConfig();
}

export function resolveIceServers() {
  const turnConfig = getTurnConfig();
  if (!turnConfig.enabled) {
    return DEFAULT_ICE_SERVERS;
  }

  return [
    ...DEFAULT_ICE_SERVERS,
    {
      urls: turnConfig.urls,
      username: turnConfig.username,
      credential: turnConfig.credential,
      credentialType: turnConfig.credentialType
    }
  ];
}

// ── Token encoding ────────────────────────────────────────────────────────────

const SIGNAL_VERSION = 1;

function toBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(text) {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function normalizeSdpForEncode(sdp) {
  // Normalize all line endings (CRLF/CR/LF) to LF for compact transport.
  return `${sdp ?? ""}`.replace(/\r\n?/g, "\n");
}

function normalizeSdpForDecode(sdp) {
  // Re-expand to CRLF for RTCPeerConnection parsers.
  return `${sdp ?? ""}`.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n");
}

function isSdpDebugEnabled() {
  if (typeof window === "undefined") return false;
  try {
    if (!window.localStorage) return false;
    const raw = window.localStorage.getItem(SDP_DEBUG_STORAGE_KEY);
    return raw === "1" || raw === "true";
  } catch {
    // Access can throw in restricted/privacy contexts.
    return false;
  }
}

function simpleHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function analyzeSdp(sdp) {
  const value = `${sdp ?? ""}`;
  const crlfCount = (value.match(/\r\n/g) || []).length;
  const bareCrCount = (value.match(/\r(?!\n)/g) || []).length;
  const lfCount = (value.match(/\n/g) || []).length;
  const lfOnlyCount = lfCount - crlfCount;
  const lines = value.split(/\r\n|\r|\n/);
  const weirdLines = lines.filter((line) => line && !/^[a-z]=/i.test(line)).slice(0, 4);

  return {
    len: value.length,
    hash: simpleHash(value),
    lines: lines.length,
    crlfCount,
    lfOnlyCount,
    bareCrCount,
    weirdLinePreview: weirdLines
  };
}

function debugSdp(stage, sdp, extra = {}) {
  if (!isSdpDebugEnabled()) return;
  try {
    const stats = analyzeSdp(sdp);
    const payload = {
      stage,
      ...extra,
      ...stats
    };
    // Logs metadata only; full SDP is intentionally not emitted.
    console.info("[upkaran:p2p:sdp]", payload);
  } catch {
    // Debug logging should never affect transfer flow.
  }
}

export function encodeToken(obj) {
  debugSdp("encode:input", obj.sdp, { type: obj.type });
  const normalized = normalizeSdpForEncode(obj.sdp);
  debugSdp("encode:normalized", normalized, { type: obj.type });

  const compact = {
    v: SIGNAL_VERSION,
    t: obj.type === "offer" ? "o" : "a",
    s: normalized
  };
  const json = JSON.stringify(compact);
  const compressed = deflateSync(strToU8(json), { level: 9 });
  return toBase64Url(compressed);
}

export function decodeToken(token) {
  const clean = token.trim().replace(/\s+/g, "");
  const bytes = fromBase64Url(clean);
  const decompressed = inflateSync(bytes);
  const parsed = JSON.parse(strFromU8(decompressed));

  // New compact schema
  if (parsed && typeof parsed === "object" && typeof parsed.s !== "undefined" && typeof parsed.t === "string") {
    if (parsed.t !== "o" && parsed.t !== "a") {
      throw new Error("Invalid signaling token type.");
    }
    const decodedSdp = normalizeSdpForDecode(parsed.s);
    debugSdp("decode:compact", decodedSdp, { type: parsed.t === "o" ? "offer" : "answer" });
    return {
      type: parsed.t === "o" ? "offer" : "answer",
      sdp: decodedSdp
    };
  }

  // Legacy schema compatibility
  if (parsed && typeof parsed === "object" && typeof parsed.sdp === "string" && typeof parsed.type === "string") {
    const decodedSdp = normalizeSdpForDecode(parsed.sdp);
    debugSdp("decode:legacy", decodedSdp, { type: parsed.type });
    return {
      type: parsed.type,
      sdp: decodedSdp
    };
  }

  throw new Error("Invalid signaling token.");
}

export function validateToken(token) {
  try {
    const obj = decodeToken(token);
    return typeof obj.sdp === "string" && (obj.type === "offer" || obj.type === "answer");
  } catch {
    return false;
  }
}

// ── SHA-256 ───────────────────────────────────────────────────────────────────

async function sha256hex(buffer) {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── ICE gathering helper ──────────────────────────────────────────────────────

function waitForIceGathering(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const handler = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", handler);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", handler);
    setTimeout(resolve, ICE_GATHERING_TIMEOUT_MS);
  });
}

// ── P2PSession ────────────────────────────────────────────────────────────────

export class P2PSession {
  constructor() {
    this._pc = null;
    this._dc = null;

    // Callbacks
    this._onFileReceived = null;
    this._onProgress = null;
    this._onStateChange = null;
    this._onTransportChange = null;
    this._transportPollId = null;
    this._lastTransportKey = "";

    // Receive-side reassembly state
    this._recvMeta = null;
    this._recvChunks = [];
    this._recvBytesReceived = 0;
  }

  /** Called when a complete file has been received and verified. */
  onFileReceived(cb) {
    this._onFileReceived = cb;
  }

  /**
   * Called with { type: "send"|"receive", progress: 0-100, name, size }.
   * Fired on sender and receiver sides during transfer.
   */
  onProgress(cb) {
    this._onProgress = cb;
  }

  /**
   * Called with a state string:
   *   "connected" | "disconnected" | "failed" | "channel-open" | "channel-closed" | "channel-error"
   */
  onStateChange(cb) {
    this._onStateChange = cb;
  }

  /** Called with the current transport route, e.g. direct or relay. */
  onTransportChange(cb) {
    this._onTransportChange = cb;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  async _readTransportInfo() {
    if (!this._pc) {
      return null;
    }

    try {
      const stats = await this._pc.getStats();
      let selectedPair = null;

      for (const report of stats.values()) {
        if (report.type === "transport" && report.selectedCandidatePairId) {
          selectedPair = stats.get(report.selectedCandidatePairId);
          if (selectedPair) break;
        }
      }

      if (!selectedPair) {
        for (const report of stats.values()) {
          if (report.type === "candidate-pair" && (report.selected || (report.nominated && report.state === "succeeded"))) {
            selectedPair = report;
            break;
          }
        }
      }

      if (!selectedPair) {
        return {
          kind: "detecting",
          label: "Detecting route",
          detail: "WebRTC is still selecting the active network path.",
          protocol: ""
        };
      }

      const localCandidate = stats.get(selectedPair.localCandidateId);
      const remoteCandidate = stats.get(selectedPair.remoteCandidateId);
      const usesRelay = localCandidate?.candidateType === "relay" || remoteCandidate?.candidateType === "relay";
      const protocol = (localCandidate?.protocol || remoteCandidate?.protocol || selectedPair.protocol || "").toUpperCase();

      return {
        kind: usesRelay ? "relay" : "direct",
        label: usesRelay ? "Relay (TURN)" : "Direct P2P",
        detail: usesRelay
          ? "Traffic is flowing through a TURN relay server."
          : "Traffic is flowing directly between both peers.",
        protocol,
        localCandidateType: localCandidate?.candidateType || "",
        remoteCandidateType: remoteCandidate?.candidateType || "",
        currentRoundTripTime: selectedPair.currentRoundTripTime ?? null
      };
    } catch {
      return null;
    }
  }

  async _emitTransportInfo() {
    const info = await this._readTransportInfo();
    if (!info) {
      return;
    }

    const key = JSON.stringify([info.kind, info.protocol, info.localCandidateType, info.remoteCandidateType]);
    if (key === this._lastTransportKey) {
      return;
    }

    this._lastTransportKey = key;
    this._onTransportChange?.(info);
  }

  _startTransportPolling() {
    if (this._transportPollId) {
      return;
    }

    void this._emitTransportInfo();
    this._transportPollId = setInterval(() => {
      void this._emitTransportInfo();
    }, 2000);
  }

  _stopTransportPolling() {
    if (this._transportPollId) {
      clearInterval(this._transportPollId);
      this._transportPollId = null;
    }
  }

  _createPc() {
    const pc = new RTCPeerConnection({ iceServers: resolveIceServers() });
    pc.onconnectionstatechange = () => {
      this._onStateChange?.(pc.connectionState);
      if (pc.connectionState === "connected") {
        this._startTransportPolling();
      }
      if (pc.connectionState === "failed" || pc.connectionState === "closed" || pc.connectionState === "disconnected") {
        this._stopTransportPolling();
      }
    };
    this._pc = pc;
    return pc;
  }

  _setupDataChannel(dc) {
    this._dc = dc;
    dc.binaryType = "arraybuffer";
    dc.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
    dc.onopen = () => {
      this._onStateChange?.("channel-open");
      this._startTransportPolling();
    };
    dc.onclose = () => {
      this._onStateChange?.("channel-closed");
      this._stopTransportPolling();
    };
    dc.onerror = () => this._onStateChange?.("channel-error");
    dc.onmessage = (event) => this._handleMessage(event.data);
  }

  _handleMessage(data) {
    if (typeof data === "string") {
      const msg = JSON.parse(data);
      if (msg.type === "file-start") {
        this._recvMeta = msg;
        this._recvChunks = [];
        this._recvBytesReceived = 0;
        this._onProgress?.({ type: "receive", progress: 0, name: msg.name, size: msg.size });
      } else if (msg.type === "file-end") {
        void this._finalizeFile(msg);
      }
    } else {
      // Binary chunk
      this._recvChunks.push(data);
      this._recvBytesReceived += data.byteLength;
      if (this._recvMeta) {
        const progress = Math.min(
          99,
          Math.round((this._recvBytesReceived / this._recvMeta.size) * 100)
        );
        this._onProgress?.({ type: "receive", progress, name: this._recvMeta.name, size: this._recvMeta.size });
      }
    }
  }

  async _finalizeFile(endMsg) {
    const totalBytes = this._recvChunks.reduce((s, c) => s + c.byteLength, 0);
    const buffer = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of this._recvChunks) {
      buffer.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    const hash = await sha256hex(buffer.buffer);
    const hashMatch = hash === endMsg.hash;

    const file = new File([buffer], this._recvMeta.name, {
      type: this._recvMeta.fileType || "application/octet-stream"
    });

    this._onProgress?.({ type: "receive", progress: 100, name: this._recvMeta.name, size: this._recvMeta.size });
    this._onFileReceived?.({ file, hashMatch });

    this._recvMeta = null;
    this._recvChunks = [];
    this._recvBytesReceived = 0;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Sender step 1: Create offer, gather ICE, return token.
   */
  async createOffer() {
    const pc = this._createPc();
    const dc = pc.createDataChannel("files", { ordered: true });
    this._setupDataChannel(dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    return encodeToken({ sdp: pc.localDescription.sdp, type: pc.localDescription.type });
  }

  /**
   * Receiver step 1: Accept offer token and set remote description.
   */
  async receiveOffer(token) {
    const signal = decodeToken(token);
    debugSdp("setRemoteDescription:offer", signal.sdp, { type: signal.type });
    const pc = this._createPc();
    pc.ondatachannel = (event) => this._setupDataChannel(event.channel);
    try {
      await pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
    } catch (err) {
      const stats = analyzeSdp(signal.sdp);
      throw new Error(`${err.message} [sdpHash=${stats.hash}, len=${stats.len}, lines=${stats.lines}, crlf=${stats.crlfCount}, lfOnly=${stats.lfOnlyCount}, bareCr=${stats.bareCrCount}]`);
    }
  }

  /**
   * Receiver step 2: Create answer, gather ICE, return token.
   * Must be called after receiveOffer().
   */
  async createAnswer() {
    if (!this._pc) throw new Error("Call receiveOffer() before createAnswer().");
    const answer = await this._pc.createAnswer();
    await this._pc.setLocalDescription(answer);
    await waitForIceGathering(this._pc);
    return encodeToken({ sdp: this._pc.localDescription.sdp, type: this._pc.localDescription.type });
  }

  /**
   * Sender step 2: Accept answer token and complete handshake.
   */
  async receiveAnswer(token) {
    const signal = decodeToken(token);
    debugSdp("setRemoteDescription:answer", signal.sdp, { type: signal.type });
    try {
      await this._pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
    } catch (err) {
      const stats = analyzeSdp(signal.sdp);
      throw new Error(`${err.message} [sdpHash=${stats.hash}, len=${stats.len}, lines=${stats.lines}, crlf=${stats.crlfCount}, lfOnly=${stats.lfOnlyCount}, bareCr=${stats.bareCrCount}]`);
    }
  }

  /**
   * Returns a promise that resolves when the DataChannel opens.
   */
  waitForChannelOpen(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (this._dc?.readyState === "open") {
        resolve();
        return;
      }
      const timer = setTimeout(() => reject(new Error("Connection timed out.")), timeoutMs);
      const prev = this._onStateChange;
      this._onStateChange = (state) => {
        prev?.(state);
        if (state === "channel-open") {
          clearTimeout(timer);
          resolve();
        } else if (state === "channel-closed" || state === "channel-error" || state === "failed") {
          clearTimeout(timer);
          reject(new Error(`Connection failed: ${state}`));
        }
      };
    });
  }

  /**
   * Send a single File over the DataChannel with chunking and SHA-256 verification.
   * DataChannel must be open.
   */
  async sendFile(file) {
    const dc = this._dc;
    if (!dc || dc.readyState !== "open") throw new Error("DataChannel is not open.");

    const buffer = await file.arrayBuffer();
    const hash = await sha256hex(buffer);
    const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);

    dc.send(
      JSON.stringify({
        type: "file-start",
        name: file.name,
        size: file.size,
        fileType: file.type,
        totalChunks
      })
    );

    for (let i = 0; i < totalChunks; i++) {
      // Backpressure: wait when buffer is saturated
      while (dc.bufferedAmount > BUFFER_HIGH_WATER) {
        await new Promise((resolve) => {
          dc.addEventListener("bufferedamountlow", resolve, { once: true });
        });
      }

      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
      dc.send(buffer.slice(start, end));

      const progress = Math.round(((i + 1) / totalChunks) * 100);
      this._onProgress?.({ type: "send", progress, name: file.name, size: file.size });

      // Yield to the event loop every 16 chunks to avoid blocking
      if (i % 16 === 15) await new Promise((r) => setTimeout(r, 0));
    }

    dc.send(JSON.stringify({ type: "file-end", hash }));
  }

  /**
   * Send multiple files sequentially.
   */
  async sendFiles(files) {
    for (const file of files) {
      await this.sendFile(file);
    }
  }

  /** Clean up all WebRTC resources. */
  close() {
    this._stopTransportPolling();
    try { this._dc?.close(); } catch { /* ignore */ }
    try { this._pc?.close(); } catch { /* ignore */ }
    this._dc = null;
    this._pc = null;
    this._lastTransportKey = "";
  }
}
