function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function parseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw apiError(data?.error || `Signaling API error (${response.status})`, response.status);
  }
  return data;
}

export function normalizeSignalCode(value) {
  return `${value ?? ""}`.replace(/\D+/g, "").slice(0, 6);
}

export async function createSignalCode(offerToken) {
  const response = await fetch("/api/signal/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offerToken })
  });

  const data = await parseJson(response);
  return {
    code: `${data.code || ""}`,
    ttlMs: Number(data.ttlMs || 0)
  };
}

export async function joinSignalCode(code) {
  const response = await fetch("/api/signal/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code })
  });

  const data = await parseJson(response);
  return {
    offerToken: `${data.offerToken || ""}`,
    ttlMs: Number(data.ttlMs || 0)
  };
}

export async function publishSignalAnswer(code, answerToken) {
  const response = await fetch("/api/signal/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, answerToken })
  });

  await parseJson(response);
}

export async function pollSignalAnswer(code, options = {}) {
  const intervalMs = Number(options.intervalMs || 1200);
  const timeoutMs = Number(options.timeoutMs || 120000);
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`/api/signal/answer?code=${encodeURIComponent(code)}`);

    if (response.status === 404) {
      const data = await response.json().catch(() => ({}));
      if (data?.status === "expired") {
        throw apiError("Code expired before receiver answered.", 404);
      }
    }

    const data = await parseJson(response);
    if (data.status === "ready" && data.answerToken) {
      return `${data.answerToken}`;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw apiError("Timed out waiting for receiver answer.", 408);
}
