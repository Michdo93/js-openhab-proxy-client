export interface OpenHABItem {
  name: string;
  label?: string;
  type?: string;
  state?: string;
  category?: string;
  tags?: string[];
  groupNames?: string[];
  [key: string]: unknown;
}

export interface ProxyEventEnvelope {
  topic?: string;
  payload?: string;
  type?: string;
  [key: string]: unknown;
}

export interface ItemStateChangedEvent {
  event: "ItemStateChangedEvent";
  data: ProxyEventEnvelope;
  lastEventId?: string;
}

export interface OpenHABProxyClientOptions {
  /** Base URL of the Worker, e.g. https://my-proxy.example.workers.dev */
  baseUrl: string;
  /** Optional request headers. For Cloudflare Access, use the Access-supported flow. */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  /** Fetch implementation override, useful for tests and custom runtimes. */
  fetch?: typeof fetch;
  /** Request timeout in milliseconds. Defaults to 15 seconds. */
  timeoutMs?: number;
  /** Number of automatic SSE reconnect attempts. Defaults to Infinity. */
  maxReconnectAttempts?: number;
  /** Initial SSE reconnect delay in milliseconds. Defaults to 1000. */
  reconnectDelayMs?: number;
  /** Maximum SSE reconnect delay in milliseconds. Defaults to 30000. */
  maxReconnectDelayMs?: number;
  /** Called after an SSE connection is re-established. */
  onReconnect?: (attempt: number) => void;
  /** Called after a successful SSE connection. */
  onConnected?: () => void;
  /** Optional callback to refresh application state after reconnect. */
  onResyncRequired?: () => void | Promise<void>;
}

export interface CommandResult {
  accepted: boolean;
  item: string;
  command: string;
}

export interface EventStreamOptions {
  signal?: AbortSignal;
  onEvent: (event: ItemStateChangedEvent) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
  /** Set false to disable automatic reconnect. Defaults to true. */
  reconnect?: boolean;
}
