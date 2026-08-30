import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { ServerConfig } from "~/entrypoints/options/components/ServerConfig";
import type {
  CommandResult,
  ExtensionCommands,
} from "~/utils/extension-commands";

type ServerConfigCommands = Pick<ExtensionCommands, "testConnection">;

describe("ServerConfig commands", () => {
  it("tests the normalized server URL through its injected command", async () => {
    const commands = {
      testConnection: vi.fn(async (): Promise<CommandResult<void>> => ({
        success: true,
        data: undefined,
      })),
    } satisfies ServerConfigCommands;

    render(
      <ServerConfig
        commands={commands}
        isLoading={false}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.input(screen.getByLabelText("Pi-hole URL"), {
      target: { value: "pi-hole.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    await waitFor(() => {
      expect(commands.testConnection).toHaveBeenCalledWith(
        "http://pi-hole.test",
      );
    });
    expect(screen.getByText("Connection successful")).toBeTruthy();
  });
});
