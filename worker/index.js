const DEFAULT_STATE_KEY = "boards/default.json";

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  applyCors(headers);
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

function applyCors(headers) {
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,PUT,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,authorization");
}

function sanitizeStateKey(rawKey) {
  const normalized = String(rawKey || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\//, "");

  if (!normalized) return "";
  if (normalized.includes("..")) return "";
  if (!/^[\w./-]+\.json$/i.test(normalized)) return "";
  return normalized;
}

function getStateKey(request, env) {
  const url = new URL(request.url);
  const requestedKey = sanitizeStateKey(url.searchParams.get("key"));
  if (requestedKey) return requestedKey;
  return sanitizeStateKey(env.STATE_KEY) || DEFAULT_STATE_KEY;
}

function sanitizeFilename(name) {
  return String(name || "image")
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "image";
}

function buildObjectUrl(env, key) {
  const normalizedKey = key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  const publicBase = String(env.PUBLIC_ASSET_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!publicBase) {
    throw new Error("Missing PUBLIC_ASSET_BASE_URL");
  }
  return `${publicBase}/${normalizedKey}`;
}

async function handleGetBoard(request, env) {
  const object = await env.POSINGBOARD_BUCKET.get(getStateKey(request, env));
  if (!object) return json({});
  const payload = JSON.parse(await object.text());
  return json(payload, {
    headers: {
      "cache-control": "no-store",
    },
  });
}

async function handlePutBoard(request, env) {
  const payload = await request.json();
  const updatedAt = new Date().toISOString();
  await env.POSINGBOARD_BUCKET.put(
    getStateKey(request, env),
    JSON.stringify(payload),
    {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
      },
      customMetadata: {
        updatedAt,
      },
    }
  );

  return json({ ok: true, updatedAt });
}

async function handleUpload(request, env) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return json({ error: "Missing file" }, { status: 400 });
  }

  const now = new Date();
  const key = [
    "Data",
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    `${crypto.randomUUID()}-${sanitizeFilename(file.name)}`,
  ].join("/");

  await env.POSINGBOARD_BUCKET.put(key, file, {
    httpMetadata: {
      contentType: file.type || "application/octet-stream",
      cacheControl: "public, max-age=31536000, immutable",
    },
    customMetadata: {
      originalName: file.name || "image",
      uploadedAt: now.toISOString(),
    },
  });

  return json({
    ok: true,
    key,
    url: buildObjectUrl(env, key),
    contentType: file.type || "application/octet-stream",
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      const headers = new Headers();
      applyCors(headers);
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/api/board" && request.method === "GET") {
      return handleGetBoard(request, env);
    }

    if (url.pathname === "/api/board" && request.method === "PUT") {
      return handlePutBoard(request, env);
    }

    if (url.pathname === "/api/upload" && request.method === "POST") {
      return handleUpload(request, env);
    }

    if (!env.ASSETS) {
      return new Response("Asset binding not configured", { status: 500 });
    }

    return env.ASSETS.fetch(request);
  },
};
