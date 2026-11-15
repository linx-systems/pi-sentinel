import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
const mocks = vi.hoisted(() => ({ getInstances: vi.fn() }));
vi.mock("~/background/api/instance-manager", () => ({
  instanceManager: mocks,
}));
import { notificationService } from "~/background/services/notifications";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(browser.notifications, {
    clear: vi.fn().mockResolvedValue(true),
  });
});
describe("blocked page notification", () => {
  it("uses one notification ID and directs the user to the side panel", async () => {
    mocks.getInstances.mockResolvedValue({
      globalSettings: { notificationsEnabled: true },
    });
    await notificationService.initialize();
    await notificationService.showPageBlocked("blocked.test");
    expect(browser.notifications.clear).toHaveBeenCalledWith(
      "pisentinel-page-blocked",
    );
    expect(browser.notifications.create).toHaveBeenCalledWith(
      "pisentinel-page-blocked",
      expect.objectContaining({
        title: "Page may be blocked by Pi-hole",
        message: expect.stringContaining("blocked.test"),
      }),
    );
  });
  it("respects disabled notifications", async () => {
    mocks.getInstances.mockResolvedValue({
      globalSettings: { notificationsEnabled: false },
    });
    await notificationService.initialize();
    await notificationService.showPageBlocked("blocked.test");
    expect(browser.notifications.create).not.toHaveBeenCalled();
  });
});
