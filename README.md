# js-openhab-proxy-client

Browser client for [cloudflare-openhab-rest-proxy](https://github.com/Michdo93/cloudflare-openhab-rest-proxy) – one file, no dependencies, no build step.

It has **the same classes, methods, parameters and return values** as [js-openhab-rest-client](https://github.com/Michdo93/js-openhab-rest-client), for the part of the REST API the proxy offers. A dashboard runs against your own openHAB at home and as a public demo behind the proxy – only the script and the URL change:

```html
<!-- at home: direct access -->
<script src="openhab.min.js"></script>
<script> const OPENHAB_URL = "https://openhab.local:8443"; </script>

<!-- public demo: through the proxy -->
<script src="openhab-proxy.min.js"></script>
<script> const OPENHAB_URL = "https://openhab-demo-proxy.example.workers.dev"; </script>
```

```js
const { OpenHABClient, Items, ItemEvents, iterSSEEvents } = window.openHAB;
const client = await new OpenHABClient(OPENHAB_URL).ready;
const items = new Items(client);

await items.sendCommand("Wohnzimmer_Deckenlampe_Schalter", "ON");   // { message: "OK" }
console.log(await items.getItemState("Wohnzimmer_Deckenlampe_Schalter"));   // "ON"

const stream = await new ItemEvents(client).ItemStateChangedEvent();
for await (const event of iterSSEEvents(stream)) {
  console.log(event.topic, event.payload.value, "was", event.payload.oldValue);
}
```

## What is available

| Class | Method | Through the proxy |
|---|---|---|
| `OpenHABClient` | `new OpenHABClient(url, user, password, token, timeout)` | credentials are ignored (with a warning) – the proxy holds them |
| | `ready`, `isLoggedIn` | connection check via `/health` |
| `Items` | `getItems({ type, tags, fields })` | allowed items; the filters work in the browser |
| | `getItem(name)` | group members only if allowed |
| | `getItemState(name)` | text, e.g. `"21.5 °C"` |
| | `sendCommand(name, command)` | only commands the proxy allows |
| | `postUpdate(…)` | `{ error: "Not available through the proxy." }` |
| `ItemEvents` | `ItemStateChangedEvent(name = "*")` | state changes of allowed items |
| | `GroupItemStateChangedEvent(group, member)` | state changes of groups |
| | all other event methods | `{ error: "Not available through the proxy." }` |
| `Persistence` | `getItemPersistenceData(name, service, { startTime, endTime })` | `{ name, datapoints, data: [{ time, state }] }`; the proxy picks the service and limits the period |
| | `storeItemData`, `deleteItemData` | `{ error: "Not available through the proxy." }` |
| helpers | `iterSSELines`, `iterSSEEvents`, `parseSSEData` | identical to js-openhab-rest-client |

Return values follow js-openhab-rest-client: JSON as objects, states as text, `{ message: "OK" }` for commands, and `{ error: "…" }` instead of exceptions:

| Proxy answers | Result |
|---|---|
| 404 | `{ error: "Item not found." }` – also for items the proxy does not allow |
| 403 | `{ error: "Command not allowed: outside 0..100." }` |
| 429 | `{ error: "Too many commands." }` |
| network | `{ error: "Request error: …" }` |

## Installation

Script tag, from jsDelivr or as a local copy:

```html
<script src="https://cdn.jsdelivr.net/gh/Michdo93/js-openhab-proxy-client@main/openhab-proxy.min.js"></script>
```

The classes are then global and under `window.openHAB` – the same name as js-openhab-rest-client, so load only one of the two.

As an ES module (e.g. with Vite):

```bash
npm install github:Michdo93/js-openhab-proxy-client
```

```js
import { OpenHABClient, Items } from "js-openhab-proxy-client";
```

## Reconnecting

The proxy closes the event stream when openHAB or myopenHAB goes away, and Cloudflare may close it after an update. `iterSSEEvents` then simply ends. Open a new stream and read the states again, since changes may have been missed in between:

```js
async function watch(onEvent) {
  while (true) {
    const stream = await new ItemEvents(client).ItemStateChangedEvent();
    if (!stream.error) {
      await reloadStates();                          // what changed meanwhile
      for await (const event of iterSSEEvents(stream)) onEvent(event);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
```

The same loop works with js-openhab-rest-client.

## Security

The proxy URL is not a secret, and nothing in this library is. Which items can be read and which commands are accepted is decided in the proxy alone – a modified copy of this file gains nothing. Never put an openHAB token or myopenHAB password into a public page.

## Development

```bash
npm install
npm test        # builds openhab-proxy.mjs and openhab-proxy.min.js, runs the tests
```

`openhab-proxy.js` is the source; `openhab-proxy.mjs` and `openhab-proxy.min.js` are generated from it.

Tested in Chromium (Playwright) against the proxy in `wrangler dev` and openHAB 5.2.3: list, group, state, allowed and rejected commands, event stream with CORS from an allowed origin, and refusal for a foreign origin. The same test page ran unchanged with js-openhab-rest-client directly against openHAB.

## License

MIT – see [LICENSE](LICENSE).
