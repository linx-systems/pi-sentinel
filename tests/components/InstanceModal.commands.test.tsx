import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { InstanceModal } from "~/entrypoints/options/components/InstanceModal";
import type {
  AddInstanceInput,
  CommandResult,
  ExtensionCommands,
  UpdateInstanceInput,
} from "~/utils/extension-commands";
import type { PiHoleInstance } from "~/utils/types";

type InstanceModalCommands = Pick<
  ExtensionCommands,
  "testConnection" | "addInstance" | "updateInstance"
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

function renderModal(instanceToEdit: PiHoleInstance | null = null) {
  const commands = {
    testConnection: vi.fn(async (): Promise<CommandResult<void>> => ({
      success: true,
      data: undefined,
    })),
    addInstance: vi.fn(async (): Promise<CommandResult<PiHoleInstance>> => ({
      success: true,
      data: instance,
    })),
    updateInstance: vi.fn(async (): Promise<CommandResult<PiHoleInstance>> => ({
      success: true,
      data: instance,
    })),
  } satisfies InstanceModalCommands;
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const rendered = render(
    <InstanceModal
      commands={commands}
      instance={instanceToEdit}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );

  return { commands, onClose, onSaved, unmount: rendered.unmount };
}

describe("InstanceModal commands", () => {
  it("tests a normalized URL through its injected commands", async () => {
    const { commands } = renderModal();
    const url = screen.getByLabelText("Pi-hole URL");

    fireEvent.input(url, { target: { value: "pi-hole.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    await waitFor(() => {
      expect(commands.testConnection).toHaveBeenCalledWith(
        "http://pi-hole.test",
      );
    });
    expect(screen.getByText("Connection successful")).toBeTruthy();
  });

  it("adds and updates instances through named command methods", async () => {
    const created = renderModal();
    fireEvent.input(screen.getByLabelText("Pi-hole URL"), {
      target: { value: "pi-hole.test" },
    });
    fireEvent.input(screen.getByLabelText("Name (optional)"), {
      target: { value: "Office" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Pi-hole" }));

    await waitFor(() => {
      expect(created.commands.addInstance).toHaveBeenCalledWith({
        name: "Office",
        piholeUrl: "http://pi-hole.test",
        password: "",
        rememberPassword: false,
      } satisfies AddInstanceInput);
    });
    created.unmount();

    const edited = renderModal(instance);
    fireEvent.input(screen.getByLabelText("Pi-hole URL"), {
      target: { value: "updated.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(edited.commands.updateInstance).toHaveBeenCalledWith({
        instanceId: instance.id,
        name: instance.name,
        piholeUrl: "http://updated.test",
        password: undefined,
        rememberPassword: false,
      } satisfies UpdateInstanceInput);
    });
  });
});
