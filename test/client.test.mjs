// Tests the client against a small stand-in for the proxy.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { Items, ItemEvents, OpenHABClient, iterSSEEvents } from "../openhab-proxy.mjs";

const event = (name, value) => `event: message\ndata: ${JSON.stringify({
  topic: `openhab/items/${name}/statechanged`, type: "ItemStateChangedEvent",
  payload: JSON.stringify({ type: "OnOff", value, oldType: "OnOff", oldValue: "OFF" })
})}\n\n`;

let server, url;
before(async () => {
  server = http.createServer((req, res) => {
    const send = (status, body, type = "application/json") => {
      res.writeHead(status, { "Content-Type": type }).end(body);
    };
    if (req.url === "/health") return send(200, '{"status":"ok"}');
    if (req.url === "/api/v1/items") {
      return send(200, JSON.stringify([
        { name: "Licht", type: "Switch", state: "ON", tags: ["Light"] },
        { name: "Temp", type: "Number:Temperature", state: "21 °C", tags: [] }]));
    }
    if (req.url === "/api/v1/items/Licht/state") return send(200, "ON", "text/plain");
    if (req.url === "/api/v1/items/Fehlt/state") {
      return send(404, '{"error":"Item not found."}');
    }
    if (req.url === "/api/v1/items/Licht/command") {
      let body = "";
      req.on("data", (c) => (body += c));
      return req.on("end", () => body === "ON" ? send(200, '{"message":"OK"}')
        : send(403, '{"error":"Command not allowed.","reason":"not a Switch command"}'));
    }
    if (req.url.startsWith("/api/v1/events")) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": connected\n\n");
      res.write(event("Licht", "ON"));
      res.write(": alive\n\n");
      return res.end(event("Licht", "OFF").replace(/"value\\":\\"OFF/, '"value\\":\\"OFF'));
    }
    send(404, '{"error":"not found"}');
  });
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("connects and reads like js-openhab-rest-client", async () => {
  const client = await new OpenHABClient(url).ready;
  assert.equal(client.isLoggedIn, true);
  const items = new Items(client);
  assert.equal((await items.getItems()).length, 2);
  assert.deepEqual((await items.getItems({ type: "Number", fields: "name" })),
    [{ name: "Temp" }]);
  assert.equal(await items.getItemState("Licht"), "ON");
  assert.deepEqual(await items.getItemState("Fehlt"), { error: "Item not found." });
});

test("sends commands and reports refusals as { error }", async () => {
  const items = new Items(new OpenHABClient(url));
  assert.deepEqual(await items.sendCommand("Licht", "ON"), { message: "OK" });
  assert.deepEqual(await items.sendCommand("Licht", "TOGGLE"),
    { error: "Command not allowed: not a Switch command." });
  assert.deepEqual(await items.postUpdate("Licht", "ON"),
    { error: "Not available through the proxy." });
});

test("yields events with decoded payload", async () => {
  const stream = await new ItemEvents(new OpenHABClient(url)).ItemStateChangedEvent();
  const values = [];
  for await (const e of iterSSEEvents(stream)) values.push(e.payload.value);
  assert.deepEqual(values, ["ON", "OFF"]);
});

test("reads the history like js-openhab-rest-client", async () => {
  const { Persistence } = await import("../openhab-proxy.mjs");
  const result = await new Persistence(new OpenHABClient(url))
    .getItemPersistenceData("Fehlt", "rrd4j", { startTime: new Date() });
  assert.deepEqual(result, { error: "Unknown Item or persistence service." });
});
