import { OpenHABProxyError } from "./errors";
import { parseSse } from "./sse";
import type {
  CommandResult,
  EventStreamOptions,
  ItemStateChangedEvent,
  OpenHABItem,
  OpenHABProxyClientOptions
} from "./types";

export * from "./types";
export { OpenHABProxyError } from "./errors";

export class OpenHABProxyClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly options: OpenHABProxyClientOptions;

  constructor(options: OpenHABProxyClientOptions) {
    if (!options?.baseUrl) throw new TypeError("baseUrl is required");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.options = options;
  }

  async getItems(signal?: AbortSignal): Promise<OpenHABItem[]> {
    return this.request<OpenHABItem[]>("/api/v1/items", { method: "GET" }, signal);
  }

  async getItem(name: string, signal?: AbortSignal): Promise<OpenHABItem> {
    return this.request<OpenHABItem>(`/api/v1/items/${encodeURIComponent(name)}`, { method: "GET" }, signal);
  }

  async getItemState(name: string, signal?: AbortSignal): Promise<string> {
    const response = await this.fetchRequest(`/api/v1/items/${encodeURIComponent(name)}/state`, {
      method: "GET",
      headers: { "Accept": "text/plain" }
    }, signal);
    return response.text();
  }

  async sendCommand(name: string, command: string, signal?: AbortSignal): Promise<CommandResult> {
    const response = await this.fetchRequest(`/api/v1/items/${encodeURIComponent(name)}/command`, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8", "Accept": "application/json" },
      body: command
    }, signal);
    return response.json() as Promise<CommandResult>;
  }

  /**
   * Opens an SSE connection and reconnects after network/server interruptions.
   * Returns a function that stops reconnecting and closes the active request.
   */
  subscribe(options: EventStreamOptions): () => void {
    const controller = new AbortController();
    let stopped = false;
    let activeController: AbortController | undefined;
    const externalSignal = options.signal;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      controller.abort();
      activeController?.abort();
      externalSignal?.removeEventListener("abort", abortFromExternal);
    };
    const abortFromExternal = () => stop();
    if (externalSignal?.aborted) stop();
    else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

    const reconnectEnabled = options.reconnect !== false;
    const maxAttempts = this.options.maxReconnectAttempts ?? Number.POSITIVE_INFINITY;
    const initialDelay = this.options.reconnectDelayMs ?? 1000;
    const maxDelay = this.options.maxReconnectDelayMs ?? 30_000;

    void (async () => {
      let attempts = 0;
      let reconnectCount = 0;
      let hadConnection = false;
      while (!stopped && !controller.signal.aborted) {
        activeController = new AbortController();
        const abortActive = () => activeController?.abort();
        controller.signal.addEventListener("abort", abortActive, { once: true });
        try {
          const response = await this.fetchRequest("/api/v1/events", {
            method: "GET",
            headers: { "Accept": "text/event-stream" },
            signal: activeController.signal
          }, activeController.signal);
          if (!response.body) throw new Error("SSE response has no body");
          attempts = 0;
          options.onOpen?.();
          this.options.onConnected?.();
          if (hadConnection) {
            reconnectCount += 1;
            this.options.onReconnect?.(reconnectCount);
            await this.options.onResyncRequired?.();
          }
          hadConnection = true;

          for await (const message of parseSse(response.body, activeController.signal)) {
            if (message.event !== "ItemStateChangedEvent") continue;
            try {
              const data = JSON.parse(message.data) as ItemStateChangedEvent["data"];
              options.onEvent({
                event: "ItemStateChangedEvent",
                data,
                ...(message.id ? { lastEventId: message.id } : {})
              });
            } catch (error) {
              options.onError?.(error instanceof Error ? error : new Error(String(error)));
            }
          }
          if (stopped || activeController.signal.aborted) break;
          throw new Error("SSE connection closed");
        } catch (error) {
          if (stopped || activeController?.signal.aborted) break;
          const normalized = error instanceof Error ? error : new Error(String(error));
          options.onError?.(normalized);
          if (!reconnectEnabled || attempts >= maxAttempts) break;
          attempts += 1;
          const delay = Math.min(maxDelay, initialDelay * (2 ** Math.min(attempts - 1, 10)));
          await abortableDelay(delay, controller.signal);
        } finally {
          controller.signal.removeEventListener("abort", abortActive);
        }
      }
    })();

    return stop;
  }

  private async request<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchRequest(path, init, signal);
    return response.json() as Promise<T>;
  }

  private async fetchRequest(path: string, init: RequestInit, externalSignal?: AbortSignal): Promise<Response> {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(new Error("Request timed out")), this.timeoutMs);
    const signal = combineSignals([init.signal, externalSignal, timeoutController.signal]);
    try {
      const extraHeaders = typeof this.options.headers === "function"
        ? await this.options.headers()
        : this.options.headers;
      const headers = new Headers(extraHeaders);
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal,
        credentials: init.credentials ?? "include"
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        let code: string | undefined;
        try { code = (JSON.parse(body) as { error?: string }).error; } catch { /* non-JSON response */ }
        throw new OpenHABProxyError(
          `Proxy request failed (${response.status}${code ? `: ${code}` : ""})`,
          response.status,
          code,
          body
        );
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function combineSignals(signals: Array<AbortSignal | null | undefined>): AbortSignal {
  const valid = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (valid.length === 1) return valid[0];
  return AbortSignal.any(valid);
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
