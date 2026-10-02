import { SocketHub, type HubPort } from "./ws-hub";
import { TradexSocket } from "./ws-transport";

// One instance serves every tab of this origin; see SocketHub.
const hub = new SocketHub({ createSocket: (kind, hooks) => new TradexSocket(kind, hooks) });
setInterval(() => hub.sweep(), 30_000);

const scope = globalThis as unknown as {
  onconnect: ((event: { ports: readonly HubPort[] }) => void) | null;
};
scope.onconnect = (event) => {
  const port = event.ports[0];
  if (port) hub.addPort(port);
};
