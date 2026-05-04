/** Thrown when the BFF returns a non-2xx JSON body; see `.body` for flags like `zeroTokenBalance`. */
export class ApiRequestError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number; body?: Record<string, unknown> }} [meta]
   */
  constructor(message, meta = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.status = meta.status;
    this.body = meta.body;
  }
}

function apiNetworkError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower === "fetch failed"
  ) {
    return new Error(
      "Cannot reach dashboard API (is the BFF running on port 3001?). If the UI loads but quotes fail, start `npm run dev` in the `bff` folder."
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

export async function apiGet(path) {
  let response;
  try {
    response = await fetch(path, { cache: "no-store" });
  } catch (e) {
    throw apiNetworkError(e);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiRequestError(body?.detail || body?.error || "Request failed", {
      status: response.status,
      body
    });
  }
  return body;
}

export async function apiPost(path, payload) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined
    });
  } catch (e) {
    throw apiNetworkError(e);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiRequestError(body?.detail || body?.error || "Request failed", {
      status: response.status,
      body
    });
  }
  return body;
}
