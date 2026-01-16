import browser from "webextension-polyfill";
import { authManager } from "../api/auth";
import { formatDuration } from "~/utils/utils";
import { logger } from "~/utils/logger";

/**
 * Notification Service
 *
 * Shows browser notifications for:
 * - Blocking status changes
 * - Connection errors
 * - Domain list changes
 */

// Notification IDs for deduplication
const NOTIFICATION_IDS = {
  BLOCKING_STATUS: "pisentinel-blocking-status",
  CONNECTION_ERROR: "pisentinel-connection-error",
  DOMAIN_ADDED: "pisentinel-domain-added",
} as const;

class NotificationService {
  private notificationsEnabled = true;

  /**
   * Initialize notification settings.
   */
  async initialize(): Promise<void> {
    const config = await authManager.getConfig();
    this.notificationsEnabled = config?.notificationsEnabled ?? true;
  }

  /**
   * Enable or disable notifications.
   */
  setEnabled(enabled: boolean): void {
    this.notificationsEnabled = enabled;
  }

  /**
   * Show notification when blocking is disabled.
   */
  async showBlockingDisabled(timer?: number): Promise<void> {
    if (!this.notificationsEnabled) return;

    const message = timer
      ? `Blocking disabled for ${formatDuration(timer)}`
      : "Blocking disabled indefinitely";

    await this.show(NOTIFICATION_IDS.BLOCKING_STATUS, {
      title: "Pi-hole Blocking Disabled",
      message,
      iconUrl: this.getIconUrl(),
    });
  }

  /**
   * Show notification when blocking is re-enabled.
   */
  async showBlockingEnabled(): Promise<void> {
    if (!this.notificationsEnabled) return;

    await this.show(NOTIFICATION_IDS.BLOCKING_STATUS, {
      title: "Pi-hole Blocking Enabled",
      message: "DNS blocking is now active",
      iconUrl: this.getIconUrl(),
    });
  }

  /**
   * Show notification for connection error.
   */
  async showConnectionError(error: string): Promise<void> {
    if (!this.notificationsEnabled) return;

    await this.show(NOTIFICATION_IDS.CONNECTION_ERROR, {
      title: "Pi-hole Connection Error",
      message: error,
      iconUrl: this.getIconUrl(),
    });
  }

  /**
   * Show notification when domain is added to a list.
   */
  async showDomainAdded(
    domain: string,
    listType: "allow" | "deny",
  ): Promise<void> {
    if (!this.notificationsEnabled) return;

    const action = listType === "allow" ? "allowed" : "blocked";
    await this.show(NOTIFICATION_IDS.DOMAIN_ADDED, {
      title: `Domain ${action}`,
      message: `${domain} added to ${listType}list`,
      iconUrl: this.getIconUrl(),
    });
  }

  /**
   * Create a notification.
   */
  private async show(
    id: string,
    options: {
      title: string;
      message: string;
      iconUrl: string;
    },
  ): Promise<void> {
    try {
      // Clear existing notification with same ID
      await browser.notifications.clear(id);

      await browser.notifications.create(id, {
        type: "basic",
        ...options,
      });
    } catch (error) {
      logger.error("Failed to show notification", error as Error);
    }
  }

  /**
   * Get extension icon URL.
   */
  private getIconUrl(): string {
    return browser.runtime.getURL("icons/icon-48.svg");
  }
}

// Singleton instance
export const notificationService = new NotificationService();
