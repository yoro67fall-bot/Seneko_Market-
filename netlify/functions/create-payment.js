const DEFAULT_TIMEOUT_MS = 20000;

function json(statusCode, body) {
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
    return json(405, { error: "Method not allowed" });
  }

  const railwayApiUrl = String(process.env.RAILWAY_API_URL || "").replace(/\/$/, "");
  if (!railwayApiUrl) {
    return json(500, { error: "RAILWAY_API_URL is not configured." });
  }

  const auth = event.headers.authorization || event.headers.Authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return json(401, { error: "Missing bearer token." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const response = await fetch(`${railwayApiUrl}/v1/createPayment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
        "X-Platform-Country":
          event.headers["x-platform-country"] ||
          event.headers["X-Platform-Country"] ||
          "SN",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    return {
      statusCode: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify(parsed),
    };
  } catch (error) {
    return json(502, {
      error: error instanceof Error ? error.message : "create-payment proxy failed",
    });
  }
};
