import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";

const { getQueries, removeFromAllowlist, removeFromDenylist } = vi.hoisted(
  () => ({
    getQueries: vi.fn(),
    removeFromAllowlist: vi.fn(),
    removeFromDenylist: vi.fn(),
  }),
);

vi.mock("~/utils/extension-commands", () => ({
  createRuntimeExtensionCommands: () => ({
    getQueries,
    searchDomain: vi.fn(),
    removeFromAllowlist,
    removeFromDenylist,
  }),
}));

const { inspection } = vi.hoisted(() => ({
  inspection: {
    lookup: vi.fn(),
    lookupMany: vi.fn(),
    resultFor: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    clear: vi.fn(),
    destroy: vi.fn(),
  },
}));

vi.mock("~/utils/domain-inspection", () => ({
  createDomainInspection: () => inspection,
}));

import { QueryLog } from "~/entrypoints/sidebar/components/QueryLog";

afterEach(() => {
  vi.clearAllMocks();
});

describe("QueryLog fleet query presentation", () => {
  it("does not render incomplete empty fleet data as an authoritative empty query log", async () => {
    getQueries.mockResolvedValue({
      success: true,
      data: {
        entries: [],
        failures: [],
        complete: false,
      },
    });

    const { unmount } = render(
      <QueryLog onAddToList={vi.fn().mockResolvedValue(true)} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Query results incomplete: no connected instances."),
      ).toBeTruthy();
    });
    expect(screen.queryByText("No queries to display.")).toBeNull();
    unmount();
    expect(inspection.destroy).toHaveBeenCalledTimes(1);
  });

  it("clears cached inspection after removing a domain from a list", async () => {
    inspection.resultFor.mockReturnValue({
      entries: [
        {
          instanceId: "primary",
          instanceName: "Primary",
          allowlist: true,
          denylist: false,
          gravity: false,
        },
      ],
      failures: [],
      complete: true,
    });
    getQueries.mockResolvedValue({
      success: true,
      data: {
        entries: [
          {
            id: 1,
            timestamp: 1,
            type: "A",
            domain: "example.com",
            client: "127.0.0.1",
            status: "OK",
            reply_type: "IP",
            reply_time: 1,
          },
        ],
        failures: [],
        complete: true,
      },
    });
    removeFromAllowlist.mockResolvedValue({ success: true });

    const { unmount } = render(
      <QueryLog onAddToList={vi.fn().mockResolvedValue(true)} />,
    );
    await screen.findByTitle("Remove from list");
    fireEvent.click(screen.getByTitle("Remove from list"));

    await waitFor(() => {
      expect(removeFromAllowlist).toHaveBeenCalledWith("example.com");
      expect(inspection.clear).toHaveBeenCalledTimes(1);
    });
    unmount();
  });

  it("keeps inspection state when removing a domain from a list fails", async () => {
    getQueries.mockResolvedValue({
      success: true,
      data: {
        entries: [
          {
            id: 1,
            timestamp: 1,
            type: "A",
            domain: "example.com",
            client: "127.0.0.1",
            status: "OK",
            reply_type: "IP",
            reply_time: 1,
          },
        ],
        failures: [],
        complete: true,
      },
    });
    removeFromAllowlist.mockResolvedValue({ success: false, error: "offline" });

    const { unmount } = render(
      <QueryLog onAddToList={vi.fn().mockResolvedValue(true)} />,
    );
    await screen.findByTitle("Remove from list");
    fireEvent.click(screen.getByTitle("Remove from list"));

    await waitFor(() =>
      expect(removeFromAllowlist).toHaveBeenCalledWith("example.com"),
    );
    expect(inspection.clear).not.toHaveBeenCalled();
    unmount();
  });
  it("invalidates and refreshes the affected status after adding a domain to a list", async () => {
    getQueries.mockResolvedValue({
      success: true,
      data: {
        entries: [
          {
            id: 1,
            timestamp: 1,
            type: "A",
            domain: "example.com",
            client: "127.0.0.1",
            status: "OK",
            reply_type: "IP",
            reply_time: 1,
          },
        ],
        failures: [],
        complete: true,
      },
    });
    const onAddToList = vi.fn().mockResolvedValue(true);
    const { unmount } = render(<QueryLog onAddToList={onAddToList} />);
    await screen.findByTitle("Add to allowlist");
    fireEvent.click(screen.getByTitle("Add to allowlist"));

    await waitFor(() => {
      expect(onAddToList).toHaveBeenCalledWith("example.com", "allow");
      expect(inspection.clear).toHaveBeenCalledTimes(1);
      expect(inspection.lookup).toHaveBeenCalledWith("example.com");
    });
    unmount();
  });
});
