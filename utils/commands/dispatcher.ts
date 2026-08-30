import type { CommandMessage, MessageResponse } from "~/utils/messaging";

export type CommandPayload<Message extends CommandMessage = CommandMessage> =
  Message extends { payload?: infer Payload } ? Payload : undefined;

export type CommandHandlerRegistry = {
  [Command in CommandMessage as Command["type"]]: (
    payload: CommandPayload<Command>,
  ) => Promise<MessageResponse<unknown>> | MessageResponse<unknown>;
};
type BroadCommandHandler = (
  payload: CommandPayload,
) => Promise<MessageResponse<unknown>> | MessageResponse<unknown>;

export function commandFailure(
  error: unknown,
  fallback = "Command failed. Please try again.",
): { success: false; error: string } {
  const message =
    error instanceof Error
      ? error.message.trim()
      : typeof error === "string"
        ? error.trim()
        : "";
  return { success: false, error: message || fallback };
}

export function createCommandDispatcher(
  handlers: Partial<CommandHandlerRegistry>,
  waitForReady: () => Promise<void> = async () => {},
): (message: CommandMessage) => Promise<MessageResponse<unknown>> {
  return async (message) => {
    // The indexed discriminated record preserves exact handler payloads at
    // declaration time; dispatch narrows them only after matching the key.
    const handler = handlers[message.type] as unknown as
      BroadCommandHandler | undefined;
    if (!handler) {
      return { success: false, error: "Unknown command" };
    }

    try {
      await waitForReady();
      return await handler("payload" in message ? message.payload : undefined);
    } catch (error) {
      return commandFailure(error);
    }
  };
}
