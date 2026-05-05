const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_LENGTH = 6;

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function randomDigits(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => `${b % 10}`).join("");
}

function safeParseInt(value) {
  const n = Number.parseInt(`${value ?? ""}`, 10);
  return Number.isFinite(n) ? n : NaN;
}

export class SignalRoomDurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async _getRecord(code) {
    const key = `code:${code}`;
    const record = await this.ctx.storage.get(key);
    if (!record) return null;

    if (Date.now() >= record.expiresAt) {
      await this.ctx.storage.delete(key);
      return null;
    }

    return record;
  }

  async _putRecord(code, record) {
    const key = `code:${code}`;
    await this.ctx.storage.put(key, record);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/create") {
      const body = await request.json().catch(() => ({}));
      const offerToken = `${body.offerToken || ""}`.trim();
      if (!offerToken) {
        return json({ error: "offerToken is required." }, { status: 400 });
      }

      let code = "";
      let created = false;

      for (let i = 0; i < 25; i += 1) {
        const candidate = randomDigits(CODE_LENGTH);
        const existing = await this._getRecord(candidate);
        if (existing) continue;

        const expiresAt = Date.now() + CODE_TTL_MS;
        await this._putRecord(candidate, {
          offerToken,
          answerToken: "",
          expiresAt,
          createdAt: Date.now()
        });
        code = candidate;
        created = true;
        break;
      }

      if (!created) {
        return json({ error: "Could not allocate code. Try again." }, { status: 503 });
      }

      return json({ code, ttlMs: CODE_TTL_MS });
    }

    if (request.method === "POST" && url.pathname === "/join") {
      const body = await request.json().catch(() => ({}));
      const code = `${body.code || ""}`.trim();
      if (!/^\d{6}$/.test(code)) {
        return json({ error: "Invalid code." }, { status: 400 });
      }

      const record = await this._getRecord(code);
      if (!record) {
        return json({ error: "Code not found or expired." }, { status: 404 });
      }

      return json({ offerToken: record.offerToken, ttlMs: Math.max(0, record.expiresAt - Date.now()) });
    }

    if (request.method === "POST" && url.pathname === "/answer") {
      const body = await request.json().catch(() => ({}));
      const code = `${body.code || ""}`.trim();
      const answerToken = `${body.answerToken || ""}`.trim();

      if (!/^\d{6}$/.test(code)) {
        return json({ error: "Invalid code." }, { status: 400 });
      }
      if (!answerToken) {
        return json({ error: "answerToken is required." }, { status: 400 });
      }

      const record = await this._getRecord(code);
      if (!record) {
        return json({ error: "Code not found or expired." }, { status: 404 });
      }

      await this._putRecord(code, {
        ...record,
        answerToken,
        answerAt: Date.now()
      });

      return json({ ok: true });
    }

    if (request.method === "GET" && url.pathname === "/answer") {
      const code = `${url.searchParams.get("code") || ""}`.trim();
      if (!/^\d{6}$/.test(code)) {
        return json({ error: "Invalid code." }, { status: 400 });
      }

      const record = await this._getRecord(code);
      if (!record) {
        return json({ status: "expired" }, { status: 404 });
      }

      if (!record.answerToken) {
        return json({ status: "pending", ttlMs: Math.max(0, record.expiresAt - Date.now()) });
      }

      await this.ctx.storage.delete(`code:${code}`);
      return json({ status: "ready", answerToken: record.answerToken });
    }

    return json({ error: "Not found." }, { status: 404 });
  }
}

async function proxyToSignalDo(request, env, path) {
  const id = env.SIGNAL_DO.idFromName("signal-room-v1");
  const stub = env.SIGNAL_DO.get(id);

  const forwardUrl = new URL(`https://signal.internal${path}`);
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  return stub.fetch(
    new Request(forwardUrl.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text()
    })
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/signal/")) {
      const doPath = url.pathname.replace("/api/signal", "") + (url.search || "");
      return proxyToSignalDo(request, env, doPath);
    }

    return env.ASSETS.fetch(request);
  }
};
