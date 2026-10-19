import test from "node:test";
import assert from "node:assert/strict";
import {
  broadcastSessionChange,
  onSessionChange,
  type SessionIdentity,
} from "../src/lib/session-sync";

class FakeChannel {
  static instances: FakeChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  posted: unknown[] = [];
  closed = false;
  constructor(public name: string) { FakeChannel.instances.push(this); }
  postMessage(data: unknown) { this.posted.push(data); }
  close() { this.closed = true; this.onmessage = null; }
}

function withFakeBrowser(run: (env: {
  storage: Map<string, string>;
  writes: Array<[string, string]>;
  storageListeners: Array<(event: unknown) => void>;
}) => void) {
  const previousChannel = globalThis.BroadcastChannel;
  const previousWindow = globalThis.window;
  const storage = new Map<string, string>();
  const writes: Array<[string, string]> = [];
  const storageListeners: Array<(event: unknown) => void> = [];
  const fakeWindow = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === "storage") storageListeners.push(listener);
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === "storage") {
        const index = storageListeners.indexOf(listener);
        if (index >= 0) storageListeners.splice(index, 1);
      }
    },
    localStorage: {
      setItem: (key: string, value: string) => { storage.set(key, value); writes.push([key, value]); },
      removeItem: (key: string) => storage.delete(key),
    },
  };
  Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: FakeChannel });
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  try {
    run({ storage, writes, storageListeners });
  } finally {
    FakeChannel.instances = [];
    Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: previousChannel });
    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
}

test("a session change reaches every other tab once and releases its listeners", (t) => {
  withFakeBrowser(({ storage, writes, storageListeners }) => {
    const received: SessionIdentity[] = [];
    const off = onSessionChange((identity) => { received.push(identity); });
    t.after(off);
    broadcastSessionChange("user-2");
    const channel = FakeChannel.instances.at(-1)!;
    assert.equal(channel.name, "tradex:session-sync");
    assert.equal((channel.posted[0] as { userId: string }).userId, "user-2");
    // A listener in another tab receives the channel message.
    channel.onmessage?.({ data: { type: "changed", userId: "user-2" } });
    channel.onmessage?.({ data: { type: "changed", userId: null } });
    channel.onmessage?.({ data: "unrelated" });
    channel.onmessage?.({ data: { type: "changed" } });
    assert.deepEqual(received, ["user-2", null]);
    // The account ID does not linger in storage after the event is sent.
    assert.equal(storage.has("tradex:session-epoch"), false);
    const [key, value] = writes.at(-1)!;
    assert.equal(key, "tradex:session-epoch");
    // Both transports can deliver the same message; only one session check runs.
    channel.onmessage?.({ data: JSON.parse(value) });
    for (const listener of storageListeners) listener({ key, newValue: value });
    for (const listener of storageListeners) listener({ key, newValue: null });
    assert.deepEqual(received, ["user-2", null, "user-2"]);
    off();
    assert.equal(storageListeners.length, 0);
    assert.equal(channel.closed, true);
    channel.onmessage?.({ data: { type: "changed", userId: "user-3" } });
    assert.equal(received.length, 3, "unsubscribed listeners stop receiving changes");
  });
});
