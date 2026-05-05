const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_LENGTH = 8;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CREATE_WINDOW_MS = 60 * 1000;
const CREATE_LIMIT_PER_IP = 12;

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function randomCode(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function normalizeCode(value) {
  return `${value ?? ""}`.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, CODE_LENGTH);
}

function isValidCode(value) {
  return new RegExp(`^[A-Z0-9]{${CODE_LENGTH}}$`).test(value);
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

  async _consumeCreateQuota(ip) {
    if (!ip) {
      return { allowed: true, remaining: CREATE_LIMIT_PER_IP };
    }

    const now = Date.now();
    const key = `rate:create:${ip}`;
    const existing = await this.ctx.storage.get(key);
    let count = existing?.count || 0;
    let resetAt = existing?.resetAt || (now + CREATE_WINDOW_MS);

    if (now >= resetAt) {
      count = 0;
      resetAt = now + CREATE_WINDOW_MS;
    }

    if (count >= CREATE_LIMIT_PER_IP) {
      const retryAfterMs = Math.max(0, resetAt - now);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs
      };
    }

    const nextCount = count + 1;
    await this.ctx.storage.put(key, { count: nextCount, resetAt });
    await this.ctx.storage.setAlarm(resetAt);

    return {
      allowed: true,
      remaining: Math.max(0, CREATE_LIMIT_PER_IP - nextCount),
      retryAfterMs: Math.max(0, resetAt - now)
    };
  }

  async alarm() {
    const list = await this.ctx.storage.list({ prefix: "rate:create:" });
    const now = Date.now();
    const deletions = [];

    for (const [key, value] of list) {
      if (!value?.resetAt || now >= value.resetAt) {
        deletions.push(key);
      }
    }

    if (deletions.length > 0) {
      await this.ctx.storage.delete(deletions);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/create") {
      const ip = request.headers.get("cf-connecting-ip") || "";
      const quota = await this._consumeCreateQuota(ip);
      if (!quota.allowed) {
        return json(
          {
            error: "Too many code requests. Try again shortly.",
            retryAfterMs: quota.retryAfterMs || CREATE_WINDOW_MS
          },
          { status: 429, headers: { "retry-after": `${Math.ceil((quota.retryAfterMs || CREATE_WINDOW_MS) / 1000)}` } }
        );
      }

      const body = await request.json().catch(() => ({}));
      const offerToken = `${body.offerToken || ""}`.trim();
      if (!offerToken) {
        return json({ error: "offerToken is required." }, { status: 400 });
      }

      let code = "";
      let created = false;

      for (let i = 0; i < 25; i += 1) {
        const candidate = randomCode(CODE_LENGTH);
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

      return json({ code, ttlMs: CODE_TTL_MS, remainingInWindow: quota.remaining });
    }

    if (request.method === "POST" && url.pathname === "/join") {
      const body = await request.json().catch(() => ({}));
      const code = normalizeCode(body.code);
      if (!isValidCode(code)) {
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
      const code = normalizeCode(body.code);
      const answerToken = `${body.answerToken || ""}`.trim();

      if (!isValidCode(code)) {
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
      const code = normalizeCode(url.searchParams.get("code"));
      if (!isValidCode(code)) {
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
  if (!env.SIGNAL_DO) {
    return new Response(JSON.stringify({ error: "SIGNAL_DO binding not configured." }), {
      status: 503,
      headers: { "content-type": "application/json" }
    });
  }
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

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  }
};
