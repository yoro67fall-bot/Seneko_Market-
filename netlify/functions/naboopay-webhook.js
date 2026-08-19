const DEFAULT_TIMEOUT_MS = 20000;

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return response(405, { error: "Method not allowed" });
  }

  const railwayApiUrl = String(process.env.RAILWAY_API_URL || "").replace(/\/$/, "");
  if (!railwayApiUrl) {
    return response(500, { error: "RAILWAY_API_URL is not configured." });
  }

  const signature = event.headers["x-signature"] || event.headers["X-Signature"] || "";
  const contentType = event.headers["content-type"] || "application/json";
  const body = event.body || "{}";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const upstream = await fetch(`${railwayApiUrl}/webhooks/naboopay`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "X-Signature": signature,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await upstream.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    return response(upstream.status, parsed);
  } catch (error) {
    return response(502, {
      error: error instanceof Error ? error.message : "webhook proxy failed",
    });
  }
};
