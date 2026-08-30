import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";

const { inspection } = vi.hoisted(() => {
  const subscribers = new Set<() => void>();
  const incompleteResult = {
    entries: [],
    failures: [
      { instanceId: "primary", instanceName: "Primary", message: "offline" },
    ],
    complete: false,
  };
  const resultFor = vi.fn();
  return {
    inspection: {
      lookup: vi.fn(async () => {
        resultFor.mockReturnValue(incompleteResult);
        for (const callback of subscribers) callback();
        return incompleteResult;
      }),
      lookupMany: vi.fn().mockResolvedValue(undefined),
      resultFor,
      subscribe: vi.fn((callback: () => void) => {
        subscribers.add(callback);
        return () => subscribers.delete(callback);
      }),
      clear: vi.fn(),
      destroy: vi.fn(),
    },
  };
});

vi.mock("~/utils/domain-inspection", () => ({
  createDomainInspection: () => inspection,
}));

import { DomainList } from "~/entrypoints/sidebar/components/DomainList";
import { ToastProvider } from "~/entrypoints/sidebar/components/ToastContext";

describe("DomainList fleet search presentation", () => {
  it("does not label an incomplete empty fleet lookup as not blocked", async () => {
    const { unmount } = render(
      <ToastProvider>
        <DomainList
          domains={["example.com"]}
          firstPartyDomain="example.com"
          onAddToList={vi.fn().mockResolvedValue(true)}
          temporaryAllows={[]}
          onCreateTemporaryAllow={vi.fn().mockResolvedValue(true)}
          onRemoveTemporaryAllows={vi.fn().mockResolvedValue(true)}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTitle("Search in Pi-hole"));
    expect(inspection.lookup).toHaveBeenCalledWith("example.com");

    await waitFor(() => {
      expect(
        screen.getByText("Search incomplete: Primary unavailable (offline)."),
      ).toBeTruthy();
    });
    expect(screen.queryByText("○ Not in blocklist")).toBeNull();
    unmount();
    expect(inspection.destroy).toHaveBeenCalledTimes(1);
  });

  it("invalidates and refreshes the affected status after adding a domain to a list", async () => {
    vi.clearAllMocks();
    const onAddToList = vi.fn().mockResolvedValue(true);
    const { unmount } = render(
      <ToastProvider>
        <DomainList
          domains={["example.com"]}
          firstPartyDomain="example.com"
          onAddToList={onAddToList}
          temporaryAllows={[]}
          onCreateTemporaryAllow={vi.fn().mockResolvedValue(true)}
          onRemoveTemporaryAllows={vi.fn().mockResolvedValue(true)}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTitle("Add to allowlist"));

    await waitFor(() => {
      expect(onAddToList).toHaveBeenCalledWith("example.com", "allow");
      expect(inspection.clear).toHaveBeenCalledTimes(1);
      expect(inspection.lookup).toHaveBeenCalledWith("example.com");
    });
    unmount();
  });

  it("keeps inspection state when adding a domain does not change a list", async () => {
    vi.clearAllMocks();
    const onAddToList = vi.fn().mockResolvedValue(false);
    const { unmount } = render(
      <ToastProvider>
        <DomainList
          domains={["example.com"]}
          firstPartyDomain="example.com"
          onAddToList={onAddToList}
          temporaryAllows={[]}
          onCreateTemporaryAllow={vi.fn().mockResolvedValue(true)}
          onRemoveTemporaryAllows={vi.fn().mockResolvedValue(true)}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTitle("Add to allowlist"));
    await waitFor(() =>
      expect(onAddToList).toHaveBeenCalledWith("example.com", "allow"),
    );
    expect(inspection.clear).not.toHaveBeenCalled();
    expect(inspection.lookup).not.toHaveBeenCalled();
    unmount();
  });

  it("invalidates inspection after creating or removing a temporary allow", async () => {
    vi.clearAllMocks();
    const onCreateTemporaryAllow = vi.fn().mockResolvedValue(true);
    const onRemoveTemporaryAllows = vi.fn().mockResolvedValue(true);
    const { unmount } = render(
      <ToastProvider>
        <DomainList
          domains={["example.com"]}
          firstPartyDomain="example.com"
          onAddToList={vi.fn().mockResolvedValue(true)}
          temporaryAllows={[
            {
              id: "temporary-allow",
              domain: "example.com",
              instanceId: "primary",
              instanceName: "Primary",
              createdAt: 1,
              expiresAt: 301,
              createdByExtension: true,
            },
          ]}
          onCreateTemporaryAllow={onCreateTemporaryAllow}
          onRemoveTemporaryAllows={onRemoveTemporaryAllows}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByLabelText("Temporarily allow example.com"));
    await waitFor(() => {
      expect(onCreateTemporaryAllow).toHaveBeenCalledWith("example.com", 300);
      expect(inspection.clear).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(
      screen.getByLabelText(
        "Cancel temporary allow for example.com on Primary",
      ),
    );
    await waitFor(() => {
      expect(onRemoveTemporaryAllows).toHaveBeenCalledWith(["temporary-allow"]);
      expect(inspection.clear).toHaveBeenCalledTimes(2);
    });
    unmount();
  });
});
