import { describe, expect, it } from "vitest";
import { parseSse } from "../src/sse";

describe("parseSse", () => {
  it("parses frames split across chunks", async () => {
    const chunks = [
      new TextEncoder().encode("event: ItemStateChangedEvent\ndata: {\"topic\":"),
      new TextEncoder().encode("\"openhab/items/Lamp/state\"}\n\n")
    ];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      }
    });
    const events = [];
    for await (const event of parseSse(stream)) events.push(event);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("ItemStateChangedEvent");
    expect(events[0].data).toContain("Lamp");
  });
});
