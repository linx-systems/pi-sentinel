import browser from 'webextension-polyfill';
import type { ExtensionState } from '../../shared/types';

/**
 * Badge Service
 *
 * Updates the extension's toolbar badge to show:
 * - Blocked query count
 * - Color indicating blocking status (green=enabled, red=disabled, gray=disconnected)
 */

// Badge colors
const COLORS = {
  ENABLED: '#22c55e', // Green - blocking active
  DISABLED: '#ef4444', // Red - blocking disabled
  DISCONNECTED: '#6b7280', // Gray - not connected
} as const;

class BadgeService {
  private lastCount: number | null = null;
  private lastColor: string | null = null;

  /**
   * Update badge based on current state.
   */
  async update(state: ExtensionState): Promise<void> {
    if (!state.isConnected) {
      await this.setDisconnected();
      return;
    }

    // Set badge color based on blocking status
    const color = state.blockingEnabled ? COLORS.ENABLED : COLORS.DISABLED;
    await this.setColor(color);

    // Set badge text to blocked count
    if (state.stats) {
      const blocked = state.stats.queries.blocked;
      await this.setCount(blocked);
    }
  }

  /**
   * Set badge to disconnected state.
   */
  async setDisconnected(): Promise<void> {
    await this.setColor(COLORS.DISCONNECTED);
    await this.setText('');
  }

  /**
   * Set badge count (formats large numbers).
   */
  private async setCount(count: number): Promise<void> {
    if (this.lastCount === count) return;
    this.lastCount = count;

    const text = this.formatCount(count);
    await this.setText(text);
  }

  /**
   * Set badge text.
   */
  private async setText(text: string): Promise<void> {
    try {
      await browser.action.setBadgeText({ text });
    } catch (error) {
      console.error('Failed to set badge text:', error);
    }
  }

  /**
   * Set badge background color.
   */
  private async setColor(color: string): Promise<void> {
    if (this.lastColor === color) return;
    this.lastColor = color;

    try {
      await browser.action.setBadgeBackgroundColor({ color });
      // Firefox supports badge text color
      await browser.action.setBadgeTextColor({ color: 'white' });
    } catch (error) {
      console.error('Failed to set badge color:', error);
    }
  }

  /**
   * Format count for badge display.
   * Badge has limited space, so abbreviate large numbers.
   */
  private formatCount(count: number): string {
    if (count === 0) return '0';
    if (count < 1000) return count.toString();
    if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
    if (count < 1000000) return `${Math.floor(count / 1000)}k`;
    return `${(count / 1000000).toFixed(1)}M`;
  }

  /**
   * Clear badge completely.
   */
  async clear(): Promise<void> {
    this.lastCount = null;
    this.lastColor = null;
    await this.setText('');
  }
}

// Singleton instance
export const badgeService = new BadgeService();
