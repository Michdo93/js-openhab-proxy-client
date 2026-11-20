// Types for js-openhab-proxy-client (same shapes as js-openhab-rest-client).

export type Result<T> = T | { error: string };

export interface OpenHABItem {
  name: string;
  label?: string;
  type: string;
  groupType?: string;
  state: string;
  transformedState?: string;
  stateDescription?: Record<string, unknown>;
  commandDescription?: Record<string, unknown>;
  unitSymbol?: string;
  category?: string;
  tags?: string[];
  groupNames?: string[];
  members?: OpenHABItem[];
}

export interface OpenHABEvent {
  topic: string;
  type: string;
  payload: { type: string; value: string; oldType?: string; oldValue?: string } | string;
}

export type EventStream = Response & { abort(): void };

export class OpenHABHTTPError extends Error {
  status: number;
  url: string;
  openhabMessage: string;
  response: Response | null;
}

export class OpenHABClient {
  constructor(url: string, username?: string | null, password?: string | null,
    token?: string | null, timeout?: number);
  readonly url: string;
  readonly isProxy: true;
  isLoggedIn: boolean;
  ready: Promise<OpenHABClient>;
  close(): void;
}
export { OpenHABClient as OpenHABProxyClient, OpenHABClient as AsyncOpenHABClient };

export class Items {
  constructor(client: OpenHABClient);
  getItems(options?: { type?: string; tags?: string; fields?: string }):
    Promise<Result<OpenHABItem[]>>;
  getItem(itemName: string): Promise<Result<OpenHABItem>>;
  getItemState(itemName: string): Promise<Result<string>>;
  sendCommand(itemName: string, command: string | number, source?: string | null):
    Promise<{ message: "OK" } | { error: string }>;
  postUpdate(...args: unknown[]): Promise<{ error: string }>;
}
export { Items as AsyncItems };

export class ItemEvents {
  constructor(client: OpenHABClient);
  ItemStateChangedEvent(itemName?: string): Promise<Result<EventStream>>;
  GroupItemStateChangedEvent(itemName?: string, memberName?: string):
    Promise<Result<EventStream>>;
}
export { ItemEvents as AsyncItemEvents };

export class Persistence {
  constructor(client: OpenHABClient);
  getItemPersistenceData(itemName: string, serviceID?: string | null,
    options?: { startTime?: string | Date; endTime?: string | Date }):
    Promise<Result<{ name: string; datapoints: number;
      data: { time: number; state: string }[] }>>;
  storeItemData(...args: unknown[]): Promise<{ error: string }>;
  deleteItemData(...args: unknown[]): Promise<{ error: string }>;
}
export { Persistence as AsyncPersistence };

export function iterSSELines(response: Response): AsyncGenerator<string>;
export function iterSSEEvents(response: Response, includeAlive?: boolean):
  AsyncGenerator<OpenHABEvent>;
export function parseSSEData(line: string): OpenHABEvent | Record<string, unknown> | null;
export { iterSSELines as aiterSSELines, iterSSEEvents as aiterSSEEvents };

declare const openHAB: {
  OpenHABClient: typeof OpenHABClient; Items: typeof Items; ItemEvents: typeof ItemEvents;
  iterSSEEvents: typeof iterSSEEvents; iterSSELines: typeof iterSSELines;
  parseSSEData: typeof parseSSEData; OpenHABHTTPError: typeof OpenHABHTTPError;
  Persistence: typeof Persistence;
};
export default openHAB;
