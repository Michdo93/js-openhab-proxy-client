export interface ParsedSseMessage {
  event: string;
  data: string;
  id?: string;
  retry?: number;
}

/** Incrementally parses an SSE byte stream, including frames split across chunks. */
export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<ParsedSseMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;

  const dispatch = (): ParsedSseMessage | null => {
    if (data.length === 0) {
      event = "message";
      id = undefined;
      retry = undefined;
      return null;
    }
    const result = { event, data: data.join("\n"), id, retry };
    event = "message";
    data = [];
    id = undefined;
    retry = undefined;
    return result;
  };

  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          const message = dispatch();
          if (message) yield message;
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let valueText = colon < 0 ? "" : line.slice(colon + 1);
        if (valueText.startsWith(" ")) valueText = valueText.slice(1);
        if (field === "event") event = valueText;
        else if (field === "data") data.push(valueText);
        else if (field === "id" && !valueText.includes("\0")) id = valueText;
        else if (field === "retry" && /^\d+$/.test(valueText)) retry = Number(valueText);
      }
      if (done) break;
    }
    const last = dispatch();
    if (last) yield last;
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
    reader.releaseLock();
  }
}
