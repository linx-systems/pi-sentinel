import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/preact";
import type { QueryEntry } from "~/utils/types";
import type { SerializableTabDomains } from "~/utils/messaging";

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: { sendMessage, getManifest: () => ({}) },
    storage: { local: { get: () => Promise.resolve({}) } },
  },
}));

import {
  Repair,
  rankRepairCandidates,
} from "~/entrypoints/sidebar/components/Repair";
import { ToastProvider } from "~/entrypoints/sidebar/components/ToastContext";

const tabDomains: SerializableTabDomains = {
  tabId: 7,
  pageUrl: "https://app.example.com/dashboard",
  firstPartyDomain: "app.example.com",
  domains: [
    "app.example.com",
    "cdn.example.com",
    "metrics.vendor.test",
    "unseen.test",
  ],
  thirdPartyDomains: ["metrics.vendor.test", "unseen.test"],
};

function query(domain: string, status: string, id: number): QueryEntry {
  return {
    id,
    timestamp: 1_700_000_000 + id,
    type: "A",
    domain,
    client: "127.0.0.1",
    status,
    reply_type: "NODATA",
    reply_time: 0,
  };
}

describe("rankRepairCandidates", () => {
  it("only proposes blocked domains observed for the active tab", () => {
    const candidates = rankRepairCandidates(
      [
        query("cdn.example.com", "GRAVITY", 1),
        query("metrics.vendor.test", "DENYLIST", 2),
        query("unseen.test", "FORWARDED", 3),
        query("other-tab.test", "GRAVITY", 4),
      ],
      tabDomains,
    );

    expect(candidates.map((candidate) => candidate.domain)).toEqual([
      "cdn.example.com",
      "metrics.vendor.test",
    ]);
  });

  it("ranks same-site domains, repeated queries, then domains alphabetically", () => {
    const candidates = rankRepairCandidates(
      [
        query("metrics.vendor.test", "GRAVITY", 1),
        query("metrics.vendor.test", "GRAVITY", 2),
        query("cdn.example.com", "GRAVITY", 3),
        query("app.example.com", "GRAVITY", 4),
      ],
      tabDomains,
    );

    expect(
      candidates.map((candidate) => [candidate.domain, candidate.count]),
    ).toEqual([
      ["app.example.com", 1],
      ["cdn.example.com", 1],
      ["metrics.vendor.test", 2],
    ]);
    expect(candidates[0].reasons).toContain("Same site as this page");
    expect(candidates[2].reasons).toContain("2 blocked queries during capture");
  });

  it("uses canonical blocked-status handling", () => {
    const candidates = rankRepairCandidates(
      [query("metrics.vendor.test", "gravity", 1)],
      tabDomains,
    );

    expect(candidates).toHaveLength(1);
  });
});

describe("Repair", () => {
  it("does not query or change Pi-hole until capture is explicitly started", () => {
    render(
      <ToastProvider>
        <Repair onTemporaryAllowsChanged={async () => {}} />
      </ToastProvider>,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Start capture and reload",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
