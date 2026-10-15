export function memoryStorage(initial: Record<string, string> = {}) {
  const stored = new Map(Object.entries(initial));
  return {
    stored,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, String(value)),
    removeItem: (key: string) => void stored.delete(key),
  };
}

export const blockedStorage = {
  getItem: () => { throw new Error("Storage disabled"); },
  setItem: () => { throw new Error("Storage disabled"); },
  removeItem: () => { throw new Error("Storage disabled"); },
};
