# js-openhab-proxy-client

A small, dependency-free JavaScript/TypeScript client for the restricted API exposed by `cloudflare-openhab-rest-proxy`.

This package is intentionally independent of any dashboard or UI framework. It can be used from a browser app, a Node.js process, or another JavaScript runtime with `fetch`, `AbortController`, and Web Streams.

## Features

- Read the proxy's allowlisted item list.
- Read an allowlisted item and its state.
- Send an explicitly permitted command.
- Subscribe to allowlisted `ItemStateChangedEvent` SSE events.
- Reconnect after SSE interruptions, with exponential backoff.
- Optional application state resynchronization after reconnect.
- No runtime dependencies.

## Installation

After publishing the package:

```bash
npm install js-openhab-proxy-client
```

For local development in a sibling project:

```bash
npm install ../js-openhab-proxy-client
```

Build the package:

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Basic usage

```ts
import { OpenHABProxyClient } from "js-openhab-proxy-client";

const openhab = new OpenHABProxyClient({
  baseUrl: "https://YOUR-WORKER.workers.dev"
});

const items = await openhab.getItems();
console.log(items);

const state = await openhab.getItemState("Demo_Light");
console.log(state);

await openhab.sendCommand("Demo_Light", "ON");
```

The client does not know which items or commands are allowed. The Worker remains the authority and rejects anything outside its allowlist.

## Subscribe to events

```ts
const stop = openhab.subscribe({
  onOpen() {
    console.log("Connected to openHAB event stream");
  },
  onEvent(event) {
    console.log("Item changed", event.data.topic, event.data.payload);
  },
  onError(error) {
    console.error("Event stream error", error);
  },
  onResyncRequired() {
    // Re-read the relevant states after a reconnect to avoid stale UI state.
    return refreshDashboardState();
  }
});

// Later, for example when the page/component is disposed:
stop();
```

`subscribe()` reconnects by default. It returns a stop function. Pass `reconnect: false` to disable reconnects. The stream parser handles frames split across network chunks.

## Cloudflare Access

If the Worker is protected by Cloudflare Access, requests must arrive with a valid Access session. The client uses `credentials: "include"` so a browser can send an existing Access session cookie cross-origin; the Worker returns credentialed CORS headers only for explicitly configured origins. You must still validate the actual browser login/cookie flow for your chosen domain and browser privacy settings. Do not embed a long-lived service token or openHAB token in a public frontend bundle.

The optional `headers` setting supports custom headers in controlled environments:

```ts
const client = new OpenHABProxyClient({
  baseUrl: "https://proxy.example.com",
  headers: () => ({
    "X-Example-Header": getShortLivedApplicationHeader()
  })
});
```

Only use this for short-lived credentials issued by a trusted backend. A static secret shipped in frontend JavaScript is public.

## Options

| Option | Default | Description |
|---|---:|---|
| `baseUrl` | required | Worker base URL |
| `headers` | — | Additional headers or async header factory |
| `fetch` | global `fetch` | Custom fetch implementation |
| `timeoutMs` | `15000` | Per-request timeout |
| `maxReconnectAttempts` | `Infinity` | Maximum SSE reconnect attempts |
| `reconnectDelayMs` | `1000` | Initial reconnect delay |
| `maxReconnectDelayMs` | `30000` | Maximum reconnect delay |
| `onReconnect` | — | Called after reconnection |
| `onConnected` | — | Called on every successful connection |
| `onResyncRequired` | — | Optional state refresh after reconnect |

## API methods

- `getItems(signal?)`
- `getItem(name, signal?)`
- `getItemState(name, signal?)`
- `sendCommand(name, command, signal?)`
- `subscribe({ onEvent, onError?, onOpen?, signal?, reconnect? })`

All item names and command strings are URL/body encoded appropriately. The server-side allowlist is still mandatory.

## Error handling

HTTP errors throw `OpenHABProxyError`:

```ts
import { OpenHABProxyClient, OpenHABProxyError } from "js-openhab-proxy-client";

try {
  await openhab.sendCommand("Demo_Light", "ON");
} catch (error) {
  if (error instanceof OpenHABProxyError) {
    console.error(error.status, error.code, error.responseBody);
  } else {
    throw error;
  }
}
```

## Browser security

- The Worker URL is not a secret.
- The openHAB API token must never be passed to this library.
- Do not put a static proxy password or Cloudflare service token in a public GitHub Pages bundle.
- Configure CORS on the Worker for the exact dashboard origin, but remember CORS is not authentication.
- Protect real installations at the Worker/Cloudflare Access layer.

## Compatibility

Targets modern browsers and Node.js 20+ runtimes with Fetch API, AbortController, Web Streams, and `AbortSignal.any`. If supporting older browsers, provide compatible platform polyfills at the application level.

## License

MIT. See [LICENSE](LICENSE).
