import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { InstanceList } from "~/entrypoints/options/components/InstanceList";
import type {
  AddInstanceInput,
  CommandResult,
  ConnectInstanceData,
  ConnectInstanceInput,
  ExtensionCommands,
  UpdateInstanceInput,
} from "~/utils/extension-commands";
import type { ConnectInstanceFailure } from "~/utils/connection-failure";
import type {
  InstanceState,
  PersistedInstances,
  PiHoleInstance,
} from "~/utils/types";

type InstanceListCommands = Pick<
  ExtensionCommands,
  | "getInstances"
  | "getInstanceState"
  | "deleteInstance"
  | "checkPasswordAvailable"
  | "connectInstance"
  | "disconnectInstance"
  | "setActiveInstance"
  | "testConnection"
  | "addInstance"
  | "updateInstance"
>;

const instance = {
  id: "primary",
  name: "Primary Pi-hole",
  piholeUrl: "https://pi-hole.test",
  encryptedPassword: null,
  encryptedMasterKey: null,
  rememberPassword: false,
  createdAt: 0,
} satisfies PiHoleInstance;

const secondaryInstance = {
  ...instance,
  id: "secondary",
  name: "Secondary Pi-hole",
} satisfies PiHoleInstance;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

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

function renderInstanceList(
  passwordAvailable: boolean,
  configuredInstances: PiHoleInstance[] = [instance],
) {
  const connectInputs: ConnectInstanceInput[] = [];
  const commands = {
    getInstances: vi.fn(
      async (): Promise<CommandResult<PersistedInstances>> => ({
        success: true,
        data: {
          instances: configuredInstances,
          activeInstanceId: configuredInstances[0]?.id ?? null,
          globalSettings: {
            notificationsEnabled: true,
            refreshInterval: 60,
          },
        },
      }),
    ),
    getInstanceState: vi.fn(
      async (): Promise<CommandResult<InstanceState>> => ({
        success: true,
        data: disconnectedState,
      }),
    ),
    deleteInstance: vi.fn(async (): Promise<CommandResult<void>> => ({
      success: true,
      data: undefined,
    })),
    checkPasswordAvailable: vi.fn(
      async (): Promise<CommandResult<{ available: boolean }>> => ({
        success: true,
        data: { available: passwordAvailable },
      }),
    ),
    connectInstance: vi.fn(
      async (
        input: ConnectInstanceInput,
      ): Promise<CommandResult<ConnectInstanceData>> => {
        connectInputs.push(input);
        return input.totp
          ? { success: true, data: { kind: "connected" } }
          : { success: true, data: { kind: "totp-required" } };
      },
    ),
    disconnectInstance: vi.fn(async (): Promise<CommandResult<void>> => ({
      success: true,
      data: undefined,
    })),
    setActiveInstance: vi.fn(async (): Promise<CommandResult<void>> => ({
      success: true,
      data: undefined,
    })),
    testConnection: vi.fn(async (): Promise<CommandResult<void>> => ({
      success: true,
      data: undefined,
    })),
    addInstance: vi.fn(
      async (
        _input: AddInstanceInput,
      ): Promise<CommandResult<PiHoleInstance>> => ({
        success: true,
        data: instance,
      }),
    ),
    updateInstance: vi.fn(
      async (
        _input: UpdateInstanceInput,
      ): Promise<CommandResult<PiHoleInstance>> => ({
        success: true,
        data: instance,
      }),
    ),
  } satisfies InstanceListCommands;

  render(<InstanceList commands={commands} onMessage={vi.fn()} />);
  return { commands, connectInputs };
}

async function submitTotp() {
  const codeInput = await screen.findByPlaceholderText("000000");
  fireEvent.input(codeInput, { target: { value: "123456" } });
  fireEvent.submit(codeInput.closest("form")!);
}

describe("InstanceList TOTP retries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves a prompted password when submitting a TOTP challenge without a password input", async () => {
    const { connectInputs } = renderInstanceList(false);

    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    const passwordInput = await screen.findByLabelText(/Pi-hole Password/i);
    fireEvent.input(passwordInput, { target: { value: "prompted-password" } });
    fireEvent.submit(passwordInput.closest("form")!);

    await submitTotp();
    await waitFor(() => expect(connectInputs).toHaveLength(2));

    expect(connectInputs).toEqual([
      { instanceId: instance.id, password: "prompted-password" },
      {
        instanceId: instance.id,
        password: "prompted-password",
        totp: "123456",
      },
    ]);
  });

  it("omits password on a stored-credential TOTP retry so the background reuses it", async () => {
    const { connectInputs } = renderInstanceList(true);

    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));

    await submitTotp();
    await waitFor(() => expect(connectInputs).toHaveLength(2));

    expect(connectInputs).toEqual([
      { instanceId: instance.id },
      { instanceId: instance.id, totp: "123456" },
    ]);
  });
});

describe("InstanceList connection attempts", () => {
  it("keeps one attempt pending through double-clicks and permits a new attempt after it settles", async () => {
    let resolvePasswordCheck:
      ((value: CommandResult<{ available: boolean }>) => void) | undefined;
    let resolveConnect:
      ((value: CommandResult<ConnectInstanceData>) => void) | undefined;
    const passwordCheck = new Promise<CommandResult<{ available: boolean }>>(
      (resolve) => {
        resolvePasswordCheck = resolve;
      },
    );
    const connection = new Promise<CommandResult<ConnectInstanceData>>(
      (resolve) => {
        resolveConnect = resolve;
      },
    );
    const { commands } = renderInstanceList(true);
    commands.checkPasswordAvailable.mockReturnValueOnce(passwordCheck);
    commands.connectInstance.mockReturnValueOnce(connection);

    const connectButton = await screen.findByRole("button", {
      name: "Connect",
    });
    fireEvent.click(connectButton);
    fireEvent.click(connectButton);

    expect(commands.checkPasswordAvailable).toHaveBeenCalledOnce();
    expect(connectButton.hasAttribute("disabled")).toBe(true);
    expect(connectButton.textContent).toBe("Connecting...");

    resolvePasswordCheck?.({ success: true, data: { available: true } });
    await waitFor(() =>
      expect(commands.connectInstance).toHaveBeenCalledOnce(),
    );

    fireEvent.click(connectButton);
    expect(commands.connectInstance).toHaveBeenCalledOnce();

    resolveConnect?.({
      success: false,
      error: {
        kind: "other",
        message: "Pi-hole is unavailable",
        status: null,
      } satisfies ConnectInstanceFailure,
    });
    await waitFor(() =>
      expect(connectButton.hasAttribute("disabled")).toBe(false),
    );

    fireEvent.click(connectButton);
    await waitFor(() =>
      expect(commands.checkPasswordAvailable).toHaveBeenCalledTimes(2),
    );
  });
});

describe("InstanceList global connection flow", () => {
  it("blocks a second instance while the first password check is pending", async () => {
    const passwordCheck = deferred<CommandResult<{ available: boolean }>>();
    const { commands } = renderInstanceList(true, [
      instance,
      secondaryInstance,
    ]);
    commands.checkPasswordAvailable.mockReturnValueOnce(passwordCheck.promise);

    const [firstConnect, secondConnect] = await screen.findAllByRole("button", {
      name: "Connect",
    });
    fireEvent.click(firstConnect);
    fireEvent.click(secondConnect);

    expect(commands.checkPasswordAvailable).toHaveBeenCalledWith(instance.id);
    expect(commands.checkPasswordAvailable).toHaveBeenCalledOnce();
    expect(secondConnect).toHaveProperty("disabled", true);
  });

  it("does not duplicate TOTP verification while a verification request is pending", async () => {
    const verification = deferred<CommandResult<ConnectInstanceData>>();
    const { commands } = renderInstanceList(true);
    commands.connectInstance
      .mockResolvedValueOnce({ success: true, data: { kind: "totp-required" } })
      .mockReturnValueOnce(verification.promise);

    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    const codeInput = await screen.findByPlaceholderText("000000");
    fireEvent.input(codeInput, { target: { value: "123456" } });
    fireEvent.submit(codeInput.closest("form")!);
    fireEvent.submit(codeInput.closest("form")!);

    await waitFor(() =>
      expect(commands.connectInstance).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByRole("button", { name: "Verifying..." })).toBeTruthy();
  });

  it("keeps the TOTP challenge active when Cancel is clicked during verification", async () => {
    const verification = deferred<CommandResult<ConnectInstanceData>>();
    const { commands } = renderInstanceList(true);
    commands.connectInstance
      .mockResolvedValueOnce({ success: true, data: { kind: "totp-required" } })
      .mockReturnValueOnce(verification.promise);

    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    const codeInput = await screen.findByPlaceholderText("000000");
    fireEvent.input(codeInput, { target: { value: "123456" } });
    fireEvent.submit(codeInput.closest("form")!);
    await waitFor(() =>
      expect(commands.connectInstance).toHaveBeenCalledTimes(2),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("heading", { name: "Two-Factor Authentication" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verifying..." })).toBeTruthy();
  });

  it("keeps a password prompt open when its close control is used during connection", async () => {
    const connection = deferred<CommandResult<ConnectInstanceData>>();
    const { commands } = renderInstanceList(false);
    commands.connectInstance.mockReturnValueOnce(connection.promise);

    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    const passwordInput = await screen.findByLabelText(/Pi-hole Password/i);
    fireEvent.input(passwordInput, { target: { value: "secret" } });
    fireEvent.submit(passwordInput.closest("form")!);
    await waitFor(() =>
      expect(commands.connectInstance).toHaveBeenCalledOnce(),
    );
    fireEvent.click(screen.getByTitle("Close"));

    expect(screen.getByLabelText(/Pi-hole Password/i)).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Connecting..." }),
    ).toHaveLength(2);
  });

  it("finishes a password flow and exposes card guidance for a network failure", async () => {
    const failure = {
      success: false as const,
      error: {
        kind: "network" as const,
        message: "Couldn't reach the host.",
        status: 0,
      },
    };
    const { commands } = renderInstanceList(false);
    commands.connectInstance.mockResolvedValueOnce(failure);

    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    const passwordInput = await screen.findByLabelText(/Pi-hole Password/i);
    fireEvent.input(passwordInput, { target: { value: "secret" } });
    fireEvent.submit(passwordInput.closest("form")!);

    expect(
      await screen.findByText(
        /Chrome could not establish the HTTPS connection/,
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/Pi-hole Password/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Connect" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(screen.queryByRole("button", { name: "Connecting..." })).toBeNull();
  });

  it("keeps password retry identity through a TOTP challenge", async () => {
    const failure = {
      success: false as const,
      error: {
        kind: "authentication" as const,
        message: "Incorrect password",
        status: 401,
      },
    };
    const { commands } = renderInstanceList(false);
    commands.connectInstance
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce({
        success: true,
        data: { kind: "totp-required" },
      });

    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    const passwordInput = await screen.findByLabelText(/Pi-hole Password/i);
    fireEvent.input(passwordInput, { target: { value: "wrong" } });
    fireEvent.submit(passwordInput.closest("form")!);
    await waitFor(() =>
      expect(screen.getAllByText("Incorrect password")).toHaveLength(2),
    );
    fireEvent.input(passwordInput, { target: { value: "correct" } });
    fireEvent.submit(passwordInput.closest("form")!);

    expect(
      await screen.findByRole("heading", { name: "Two-Factor Authentication" }),
    ).toBeTruthy();
  });

  it("keeps a failed TOTP challenge editable for retry", async () => {
    const failure = {
      success: false as const,
      error: {
        kind: "authentication" as const,
        message: "Invalid verification code",
        status: 401,
      },
    };
    const { commands } = renderInstanceList(true);
    commands.connectInstance
      .mockResolvedValueOnce({ success: true, data: { kind: "totp-required" } })
      .mockResolvedValueOnce(failure);

    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    await submitTotp();

    expect(await screen.findByText("Invalid verification code")).toBeTruthy();
    expect(screen.getByPlaceholderText("000000")).toHaveProperty(
      "disabled",
      false,
    );
    expect(screen.getByRole("button", { name: "Verify" })).toBeTruthy();
  });
});
describe("InstanceList modal command dependency", () => {
  it("provides modal commands alongside its list commands", async () => {
    const { commands } = renderInstanceList(true);

    fireEvent.click(await screen.findByRole("button", { name: "Add Pi-hole" }));
    fireEvent.input(screen.getByLabelText("Pi-hole URL"), {
      target: { value: "new.pi-hole.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    await waitFor(() =>
      expect(commands.testConnection).toHaveBeenCalledWith(
        "http://new.pi-hole.test",
      ),
    );

    fireEvent.submit(screen.getByLabelText("Pi-hole URL").closest("form")!);

    await waitFor(() =>
      expect(commands.addInstance).toHaveBeenCalledWith({
        name: null,
        piholeUrl: "http://new.pi-hole.test",
        password: "",
        rememberPassword: false,
      }),
    );
  });
});
