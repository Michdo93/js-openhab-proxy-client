/**
 * js-openhab-proxy-client
 *
 * Browser client for cloudflare-openhab-rest-proxy. It has the same classes,
 * methods, parameters and return values as js-openhab-rest-client – for the
 * part of the REST API that the proxy offers:
 *
 *   Items:      getItems, getItem, getItemState, sendCommand
 *   ItemEvents: ItemStateChangedEvent, GroupItemStateChangedEvent
 *   helpers:    iterSSELines, iterSSEEvents, parseSSEData
 *
 * A dashboard switches between direct access and the proxy by loading
 * openhab.js or openhab-proxy.js – the rest of its code stays the same:
 *
 *   const { OpenHABClient, Items, ItemEvents, iterSSEEvents } = openHAB;
 *   const client = new OpenHABClient("https://demo-proxy.example.workers.dev");
 *   await new Items(client).sendCommand("Wohnzimmer_Deckenlampe_Schalter", "ON");
 *
 * The proxy decides what is allowed. This file never holds credentials.
 *
 * @license MIT
 * @version 0.2.0
 */

// ═════════════════════════════════════════════════════════════════════════════
// Errors and the client
// ═════════════════════════════════════════════════════════════════════════════

/** Thrown by OpenHABClient.get/post/executeSSE for 4xx/5xx responses. */
class OpenHABHTTPError extends Error {
  constructor(message, status, url, openhabMessage = "", response = null) {
    super(message);
    this.name = "OpenHABHTTPError";
    this.status = status;
    this.url = url;
    this.openhabMessage = openhabMessage;
    this.response = response;
  }
}

class OpenHABClient {
  /**
   * @param url       Base URL of the proxy, e.g. "https://demo.example.workers.dev".
   * @param username  Ignored – only here so that code for js-openhab-rest-client
   * @param password  runs unchanged. Never put credentials into a public page.
   * @param token     Ignored, see above.
   * @param timeout   Optional; timeout in seconds for normal requests (default 10).
   *                  Event streams only use it for connecting.
   */
  constructor(url, username = null, password = null, token = null, timeout = 10) {
    if (username || password || token) {
      console.warn("openHAB proxy: credentials are ignored – the proxy holds them.");
    }
    this.url = String(url).replace(/\/+$/, "");
    this.timeout = timeout;
    this.isCloud = false;
    this.isProxy = true;
    this.isLoggedIn = false;
    /** Resolves to this client once the connection check is done (never rejects). */
    this.ready = this.login();
  }

  /** Checks whether the proxy answers. */
  async login() {
    try {
      const response = await this._fetch(`${this.url}/health`, {});
      this.isLoggedIn = response.ok;
      if (!response.ok) console.warn(`openHAB proxy: HTTP ${response.status} for /health`);
    } catch (err) {
      this.isLoggedIn = false;
      console.warn(`openHAB proxy: ${this.url} not reachable (${err.message})`);
    }
    return this;
  }

  /** URL of an API path, e.g. "/items/Licht/state" -> .../api/v1/items/Licht/state */
  _buildUrl(path, params = null) {
    const url = new URL(`${this.url}/api/v1${path}`);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== null && value !== undefined) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  /** fetch with timeout (seconds). */
  async _fetch(url, options = {}, timeout = this.timeout) {
    const controller = new AbortController();
    const timer = timeout
      ? setTimeout(() => controller.abort(new Error(`Timeout after ${timeout} s`)), timeout * 1000)
      : null;
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) throw new Error(`Timeout after ${timeout} s: ${url}`);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Throws OpenHABHTTPError for 4xx/5xx with the message of the proxy. */
  static async _raiseForStatus(response) {
    if (response.status < 400) return;
    let message = "";
    try {
      const body = await response.json();
      message = [body.error, body.reason].filter(Boolean).join(" ");
    } catch { /* no JSON body */ }
    let text = `${response.status} for url: ${response.url}`;
    if (message) text += ` (${message})`;
    throw new OpenHABHTTPError(text, response.status, response.url, message, response);
  }

  async _request(method, path, headers = null, body = null) {
    const response = await this._fetch(this._buildUrl(path),
      { method, headers: headers || {}, body });
    await OpenHABClient._raiseForStatus(response);
    const text = await response.text();
    if ((response.headers.get("Content-Type") || "").includes("json")) {
      try { return JSON.parse(text); } catch { return text; }
    }
    return text;
  }

  get(path, headers = null) {
    return this._request("GET", path, headers);
  }

  post(path, headers = null, data = null) {
    return this._request("POST", path, headers, data === null ? null : String(data));
  }

  /**
   * Opens the event stream of the proxy. Resolves to the fetch Response with
   * an extra abort() method. Throws OpenHABHTTPError if the proxy refuses.
   */
  async executeSSE(path, params = null) {
    const controller = new AbortController();
    const timer = this.timeout
      ? setTimeout(() => controller.abort(new Error("Timeout while connecting")), this.timeout * 1000)
      : null;
    let response;
    try {
      response = await fetch(this._buildUrl(path, params), {
        headers: { Accept: "text/event-stream" }, signal: controller.signal
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    await OpenHABClient._raiseForStatus(response);
    response.abort = () => controller.abort();
    return response;
  }

  /** For symmetry with js-openhab-rest-client. */
  close() {}
}

/** Same class under the name the proxy documentation uses. */
const OpenHABProxyClient = OpenHABClient;

/** Turns errors of the proxy into { error } like js-openhab-rest-client. */
function _asResult(err, messages = {}) {
  if (!(err instanceof OpenHABHTTPError)) return { error: `Request error: ${err.message}` };
  if (messages[err.status]) return { error: messages[err.status] };
  return { error: `HTTP error ${err.status}: ${err.openhabMessage || err.message}` };
}

const NOT_AVAILABLE = { error: "Not available through the proxy." };

// ═════════════════════════════════════════════════════════════════════════════
// Server-Sent Events helpers (same as js-openhab-rest-client)
// ═════════════════════════════════════════════════════════════════════════════

/** Yields the lines of an SSE stream; breaking out of the loop closes it. */
async function* iterSSELines(response) {
  if (!response || !response.body) {
    throw new TypeError("iterSSELines expects a fetch Response with a body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer) yield buffer;
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}

/** Decodes one "data:" line; the payload (JSON in JSON) is decoded as well. */
function parseSSEData(line) {
  if (typeof line !== "string" || !line.startsWith("data:")) return null;
  let event;
  try {
    event = JSON.parse(line.slice(5).trim());
  } catch {
    return null;
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  if (typeof event.payload === "string") {
    try { event.payload = JSON.parse(event.payload); } catch { /* plain text */ }
  }
  return event;
}

/**
 * Yields the events of a stream with decoded payload. The loop ends when the
 * proxy closes the stream – open a new one to reconnect.
 */
async function* iterSSEEvents(response, includeAlive = false) {
  for await (const line of iterSSELines(response)) {
    const event = parseSSEData(line);
    if (event === null) continue;
    if ("topic" in event || includeAlive) yield event;
  }
}

const aiterSSELines = iterSSELines;
const aiterSSEEvents = iterSSEEvents;

// ═════════════════════════════════════════════════════════════════════════════
// Items and ItemEvents
// ═════════════════════════════════════════════════════════════════════════════

class Items {
  constructor(client) {
    this.client = client;
  }

  /**
   * All items the proxy allows. type, tags and fields filter in the browser;
   * the other options of js-openhab-rest-client are accepted and ignored.
   */
  async getItems({ type = null, tags = null, fields = null } = {}) {
    let items;
    try {
      items = await this.client.get("/items", { Accept: "application/json" });
    } catch (err) {
      return _asResult(err);
    }
    if (type) items = items.filter((item) => String(item.type).split(":")[0] === type);
    if (tags) {
      const wanted = String(tags).split(",");
      items = items.filter((item) => wanted.every((tag) => item.tags?.includes(tag)));
    }
    if (fields) {
      const keep = String(fields).split(",");
      items = items.map((item) => Object.fromEntries(
        Object.entries(item).filter(([key]) => keep.includes(key))));
    }
    return items;
  }

  /** One item; members of groups are included if the proxy allows them. */
  async getItem(itemName) {
    try {
      return await this.client.get(`/items/${encodeURIComponent(itemName)}`,
        { Accept: "application/json" });
    } catch (err) {
      return _asResult(err, { 404: "Item not found." });
    }
  }

  /** The state as text, e.g. "ON" or "21.5 °C". */
  async getItemState(itemName) {
    try {
      return await this.client.get(`/items/${encodeURIComponent(itemName)}/state`,
        { Accept: "text/plain" });
    } catch (err) {
      return _asResult(err, { 404: "Item not found." });
    }
  }

  /** Sends a command. source is accepted for compatibility and not sent. */
  async sendCommand(itemName, command, source = null) {
    try {
      await this.client.post(`/items/${encodeURIComponent(itemName)}/command`,
        { "Content-Type": "text/plain" }, command);
      return { message: "OK" };
    } catch (err) {
      const reason = err.openhabMessage?.replace(/^Command not allowed\.\s*/, "");
      return _asResult(err, {
        400: "Invalid command for this item.",
        403: reason ? `Command not allowed: ${reason}.` : "Command not allowed.",
        404: "Item not found.",
        429: "Too many commands."
      });
    }
  }

  /** Updates without a command are not offered by the proxy. */
  async postUpdate() {
    return { ...NOT_AVAILABLE };
  }
}

class ItemEvents {
  constructor(client) {
    this.client = client;
  }

  /** State changes of one item or (default "*") of all allowed items. */
  ItemStateChangedEvent(itemName = "*") {
    return this._open(itemName);
  }

  /** State changes of group items, caused by the given member (default "*"). */
  async GroupItemStateChangedEvent(itemName = "*", memberName = "*") {
    const stream = await this._open(itemName);
    if (stream.error || memberName === "*") return stream;
    return _onlyTopics(stream, (topic) => topic.split("/")[3] === memberName);
  }

  async _open(itemName) {
    const params = itemName && itemName !== "*" ? { items: itemName } : null;
    try {
      return await this.client.executeSSE("/events", params);
    } catch (err) {
      return _asResult(err);
    }
  }
}

for (const name of ["ItemEvent", "ItemAddedEvent", "ItemRemovedEvent", "ItemUpdatedEvent",
  "ItemCommandEvent", "ItemStateEvent", "ItemStatePredictedEvent"]) {
  ItemEvents.prototype[name] = async () => ({ ...NOT_AVAILABLE });
}

/** Wraps a stream so that iterSSEEvents only sees events with matching topics. */
function _onlyTopics(stream, keep) {
  const lines = (async function* () {
    for await (const line of iterSSELines(stream)) {
      const event = parseSSEData(line);
      if (!event || !event.topic || keep(event.topic)) yield `${line}\n`;
    }
  })();
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async pull(controller) {
      const { value, done } = await lines.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    cancel() { stream.abort(); }
  });
  const filtered = new Response(body, { headers: stream.headers });
  filtered.abort = () => stream.abort();
  return filtered;
}

class AsyncOpenHABClient extends OpenHABClient {}
class AsyncItems extends Items {}
class AsyncItemEvents extends ItemEvents {}

// ═════════════════════════════════════════════════════════════════════════════
// Export
// ═════════════════════════════════════════════════════════════════════════════

const openHAB = {
  OpenHABClient, OpenHABProxyClient, AsyncOpenHABClient, OpenHABHTTPError,
  Items, AsyncItems, ItemEvents, AsyncItemEvents,
  iterSSELines, iterSSEEvents, parseSSEData, aiterSSELines, aiterSSEEvents
};

// Same global name as js-openhab-rest-client: load only one of the two files.
if (typeof window !== "undefined") window.openHAB = openHAB;
