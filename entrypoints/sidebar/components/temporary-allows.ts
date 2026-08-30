import { useEffect, useMemo, useState } from "preact/hooks";
import browser from "webextension-polyfill";
import type {
  CreateTemporaryAllowsResult,
  RemoveTemporaryAllowsResult,
} from "~/utils/messaging";
import type { TemporaryAllowEntry } from "~/utils/types";
import type {
  CreateTemporaryAllowsInput,
  ExtensionCommands,
} from "~/utils/extension-commands";

export type TemporaryAllowCommands = Pick<
  ExtensionCommands,
  "getTemporaryAllows" | "createTemporaryAllows" | "removeTemporaryAllows"
>;

export type TemporaryAllowMessageSource = Pick<
  typeof browser.runtime,
  "onMessage"
>;

export type TemporaryAllowSuccess<T> = { success: true; data: T };
export type TemporaryAllowFailure = { success: false; error: string };
export type TemporaryAllowOutcome<T> =
  TemporaryAllowSuccess<T> | TemporaryAllowFailure;

export interface TemporaryAllows {
  readonly entries: readonly TemporaryAllowEntry[];
  refresh(): Promise<TemporaryAllowOutcome<TemporaryAllowEntry[]>>;
  allow(
    input: CreateTemporaryAllowsInput,
  ): Promise<TemporaryAllowOutcome<CreateTemporaryAllowsResult>>;
  revoke(
    entryIds: string[],
  ): Promise<TemporaryAllowOutcome<RemoveTemporaryAllowsResult>>;
}

type Subscriber = () => void;

function commandFailure<T>(error: unknown): TemporaryAllowOutcome<T> {
  return {
    success: false,
    error:
      error instanceof Error ? error.message : "Temporary allow command failed",
  };
}

/**
 * Owns the sidebar's temporary-allow snapshot, background updates, and the
 * refresh-after-mutation policy shared by the domain and repair views.
 */
export class SidebarTemporaryAllows {
  #entries: readonly TemporaryAllowEntry[] = [];
  #revision = 0;
  #subscribers = new Set<Subscriber>();
  #stopListening: (() => void) | null = null;

  constructor(
    private readonly commands: TemporaryAllowCommands,
    private readonly messageSource: TemporaryAllowMessageSource,
  ) {}

  get entries(): readonly TemporaryAllowEntry[] {
    return this.#entries;
  }

  subscribe(subscriber: Subscriber): () => void {
    this.#subscribers.add(subscriber);
    return () => this.#subscribers.delete(subscriber);
  }

  async start(): Promise<void> {
    if (this.#stopListening) return;

    const handleMessage = (message: unknown) => {
      if (!isTemporaryAllowUpdate(message)) return;
      if (Array.isArray(message.payload)) {
        this.#publish(message.payload);
      } else {
        void this.refresh();
      }
    };
    this.messageSource.onMessage.addListener(handleMessage);
    this.#stopListening = () =>
      this.messageSource.onMessage.removeListener(handleMessage);
    await this.refresh();
  }

  destroy(): void {
    this.#stopListening?.();
    this.#stopListening = null;
    this.#subscribers.clear();
  }

  async refresh(): Promise<TemporaryAllowOutcome<TemporaryAllowEntry[]>> {
    const revision = ++this.#revision;
    let result: TemporaryAllowOutcome<TemporaryAllowEntry[]>;
    try {
      result = await this.commands.getTemporaryAllows();
    } catch (error) {
      return commandFailure(error);
    }

    if (result.success && revision === this.#revision) {
      this.#entries = result.data;
      this.#notify();
    }
    return result;
  }

  async allow(
    input: CreateTemporaryAllowsInput,
  ): Promise<TemporaryAllowOutcome<CreateTemporaryAllowsResult>> {
    let result: TemporaryAllowOutcome<CreateTemporaryAllowsResult>;
    try {
      result = await this.commands.createTemporaryAllows(input);
    } catch (error) {
      return commandFailure(error);
    }

    if (result.success) await this.refresh();
    return result;
  }

  async revoke(
    entryIds: string[],
  ): Promise<TemporaryAllowOutcome<RemoveTemporaryAllowsResult>> {
    let result: TemporaryAllowOutcome<RemoveTemporaryAllowsResult>;
    try {
      result = await this.commands.removeTemporaryAllows(entryIds);
    } catch (error) {
      return commandFailure(error);
    }

    if (result.success) await this.refresh();
    return result;
  }

  #publish(entries: readonly TemporaryAllowEntry[]): void {
    this.#revision++;
    this.#entries = entries;
    this.#notify();
  }

  #notify(): void {
    for (const subscriber of this.#subscribers) subscriber();
  }
}

export function useTemporaryAllows(
  commands: TemporaryAllowCommands,
): TemporaryAllows {
  const temporaryAllows = useMemo(
    () => new SidebarTemporaryAllows(commands, browser.runtime),
    [commands],
  );
  const [entries, setEntries] = useState<readonly TemporaryAllowEntry[]>(
    temporaryAllows.entries,
  );

  useEffect(() => {
    const unsubscribe = temporaryAllows.subscribe(() => {
      setEntries(temporaryAllows.entries);
    });
    void temporaryAllows.start();
    return () => {
      unsubscribe();
      temporaryAllows.destroy();
    };
  }, [temporaryAllows]);

  return useMemo(
    () => ({
      entries,
      refresh: () => temporaryAllows.refresh(),
      allow: (input) => temporaryAllows.allow(input),
      revoke: (entryIds) => temporaryAllows.revoke(entryIds),
    }),
    [entries, temporaryAllows],
  );
}

function isTemporaryAllowUpdate(
  message: unknown,
): message is { type: "TEMPORARY_ALLOWS_UPDATED"; payload?: unknown } {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "TEMPORARY_ALLOWS_UPDATED"
  );
}
