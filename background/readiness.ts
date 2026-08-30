export type InitializationGate = {
  initialize(initializer: () => Promise<void>): Promise<void>;
  wait(): Promise<void>;
};

export function createInitializationGate(): InitializationGate {
  let readiness: Promise<void> | null = null;

  return {
    initialize(initializer) {
      readiness ??= initializer();
      return readiness;
    },
    wait() {
      return (
        readiness ??
        Promise.reject(new Error("Background initialization has not started"))
      );
    },
  };
}
