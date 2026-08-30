import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { InstanceCard } from "~/entrypoints/options/components/InstanceCard";
import type { ConnectInstanceFailure } from "~/utils/connection-failure";
import type { InstanceState, PiHoleInstance } from "~/utils/types";

const failure = {
  kind: "network",
  message: "Couldn't reach the host.",
  status: 0,
} satisfies ConnectInstanceFailure;

function instance(piholeUrl: string): PiHoleInstance {
  return {
    id: "primary",
    name: "Primary Pi-hole",
    piholeUrl,
    encryptedPassword: null,
    encryptedMasterKey: null,
    rememberPassword: false,
    createdAt: 0,
  };
}

const connectedState = {
  instanceId: "primary",
  isConnected: true,
  connectionError: null,
  blockingEnabled: true,
  blockingTimer: null,
  stats: null,
  statsLastUpdated: 0,
  totpRequired: false,
} satisfies InstanceState;
function renderCard(piholeUrl: string) {
  render(
    <InstanceCard
      instance={instance(piholeUrl)}
      state={null}
      connectionFailure={failure}
      isActive={true}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onConnect={vi.fn()}
      onDisconnect={vi.fn()}
      onSetActive={vi.fn()}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InstanceCard HTTPS network guidance", () => {
  it("renders a safe native link to the configured origin for a status-0 failure", () => {
    renderCard("https://192.168.1.192");

    expect(
      screen.getByText(/could not establish the HTTPS connection/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/certificate may need to be trusted/i),
    ).toBeTruthy();
    expect(screen.getByText(/may be unavailable/i)).toBeTruthy();

    const openHost = screen.getByRole("link", { name: "Open Host" });
    expect(openHost).toHaveProperty("href", "https://192.168.1.192/");
    expect(openHost).toHaveProperty("target", "_blank");
    expect(openHost).toHaveProperty("rel", "noopener noreferrer");
  });

  it("keeps HTTP status-0 guidance generic and does not offer certificate actions", () => {
    renderCard("http://192.168.1.192");

    expect(screen.getByText("Couldn't reach the host.")).toBeTruthy();
    expect(
      screen.queryByText(/could not establish the HTTPS connection/i),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Host" })).toBeNull();
  });

  it("hides stale connection failure guidance once the observed state is connected", () => {
    render(
      <InstanceCard
        instance={instance("https://192.168.1.192")}
        state={connectedState}
        connectionFailure={failure}
        isActive={true}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onSetActive={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(/could not establish the HTTPS connection/i),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: "Open Host" })).toBeNull();
  });
});
