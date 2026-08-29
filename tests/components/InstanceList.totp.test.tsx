import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { InstanceList } from "~/entrypoints/options/components/InstanceList";
import type { MessageResponse } from "~/utils/messaging";
import type {
  InstanceState,
  PersistedInstances,
  PiHoleInstance,
} from "~/utils/types";
import { sendViaStorage } from "~/utils/storage-message";

vi.mock("~/utils/storage-message", () => ({
  sendViaStorage: vi.fn(),
}));

const instance = {
  id: "primary",
  name: "Primary Pi-hole",
  piholeUrl: "https://pi-hole.test",
  encryptedPassword: null,
  encryptedMasterKey: null,
  rememberPassword: false,
  createdAt: 0,
} satisfies PiHoleInstance;

const disconnectedState = {
  instanceId: instance.id,
  isConnected: false,
  connectionError: null,
  blockingEnabled: true,
  blockingTimer: null,
  stats: null,
  statsLastUpdated: 0,
  totpRequired: false,
} satisfies InstanceState;

const storageMessageMock = vi.mocked(sendViaStorage);

type ConnectPayload = {
  instanceId: string;
  password?: string;
  totp?: string;
};

function response<T>(data: T): MessageResponse<T> {
  return { success: true, data };
}

function totpChallenge(): MessageResponse<{ totpRequired: boolean }> {
  return { success: false, data: { totpRequired: true } };
}

function renderInstanceList(passwordAvailable: boolean) {
  const storageResponder = async (
    requestKey: string,
    _responseKey: string,
    payload: ConnectPayload,
  ): Promise<MessageResponse<unknown>> => {
    switch (requestKey) {
      case "pendingGetInstances":
        return response<PersistedInstances>({
          instances: [instance],
          activeInstanceId: instance.id,
          globalSettings: {
            notificationsEnabled: true,
            refreshInterval: 60,
          },
        });
      case "pendingGetInstanceState":
        return response<InstanceState>(disconnectedState);
      case "pendingCheckPasswordAvailable":
        return response({ available: passwordAvailable });
      case "pendingConnectInstance":
        return payload.totp ? response({}) : totpChallenge();
      default:
        throw new Error(`Unexpected storage request: ${requestKey}`);
    }
  };

  // The generic production seam returns a call-specific response type; this
  // controlled fixture supplies only the responses exercised by this component.
  storageMessageMock.mockImplementation(
    storageResponder as unknown as typeof sendViaStorage,
  );

  render(<InstanceList onMessage={vi.fn()} />);
}

function connectPayloads() {
  return storageMessageMock.mock.calls
    .filter(([requestKey]) => requestKey === "pendingConnectInstance")
    .map(([, , payload]) => payload);
}

async function submitTotp() {
  const codeInput = await screen.findByPlaceholderText("000000");
  fireEvent.input(codeInput, { target: { value: "123456" } });
  fireEvent.submit(codeInput.closest("form")!);

  await waitFor(() => expect(connectPayloads()).toHaveLength(2));
}

describe("InstanceList TOTP retries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves a prompted password when submitting a TOTP challenge without a password input", async () => {
    renderInstanceList(false);

    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    const passwordInput = await screen.findByLabelText(/Pi-hole Password/i);
    fireEvent.input(passwordInput, { target: { value: "prompted-password" } });
    fireEvent.submit(passwordInput.closest("form")!);

    await submitTotp();

    expect(connectPayloads()).toEqual([
      { instanceId: instance.id, password: "prompted-password" },
      {
        instanceId: instance.id,
        password: "prompted-password",
        totp: "123456",
      },
    ]);
  });

  it("omits password on a stored-credential TOTP retry so the background reuses it", async () => {
    renderInstanceList(true);

    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));

    await submitTotp();

    expect(connectPayloads()).toEqual([
      { instanceId: instance.id },
      { instanceId: instance.id, totp: "123456" },
    ]);
  });
});
