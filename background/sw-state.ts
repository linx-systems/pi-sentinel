import browser from "webextension-polyfill";

export const SW_STATE_KEY = "__pisentinel_sw_state";

export type ServiceWorkerState = {
  instanceSessionEncryptionKey: string | null;
  instanceAuthFailures: Record<string, number>;
};

export async function loadSwState(): Promise<ServiceWorkerState | null> {
  const result = await browser.storage.session.get(SW_STATE_KEY);
  return (result[SW_STATE_KEY] as ServiceWorkerState | undefined) ?? null;
}

export async function saveSwState(state: ServiceWorkerState): Promise<void> {
  await browser.storage.session.set({ [SW_STATE_KEY]: state });
}
