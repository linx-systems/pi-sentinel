import browser from 'webextension-polyfill';
import { apiClient } from './client';
import { encryption } from '../crypto/encryption';
import { STORAGE_KEYS, ALARMS, DEFAULTS } from '../../shared/constants';
import type { PersistedConfig, SessionData, EncryptedData } from '../../shared/types';

/**
 * Authentication Manager
 *
 * Handles the complete authentication lifecycle:
 * - Storing/retrieving encrypted credentials
 * - Authenticating with Pi-hole (with TOTP support)
 * - Managing session tokens in storage.session
 * - Session keepalive via alarms
 */
export class AuthManager {
  private masterKey: string | null = null;

  /**
   * Initialize the auth manager.
   * Attempts to restore session from storage.
   */
  async initialize(): Promise<boolean> {
    // Try to restore existing session
    const session = await this.getSessionFromStorage();
    if (session && session.expiresAt > Date.now()) {
      apiClient.setSession(session.sid, session.csrf);
      await this.startSessionKeepalive();
      return true;
    }

    // Try to auto-login with stored credentials
    const config = await this.getConfig();
    if (config?.piholeUrl && config?.encryptedPassword) {
      apiClient.setBaseUrl(config.piholeUrl);
      // We can't auto-login without the master key
      // User will need to re-enter password or we use a generated key
    }

    return false;
  }

  /**
   * Save configuration (URL, encrypted password).
   */
  async saveConfig(
    piholeUrl: string,
    password: string,
    options?: {
      notificationsEnabled?: boolean;
      refreshInterval?: number;
    }
  ): Promise<void> {
    // Generate or use existing master key
    if (!this.masterKey) {
      this.masterKey = encryption.generateMasterPassword();
      // Store master key in session storage (cleared on browser close)
      await browser.storage.session.set({ masterKey: this.masterKey });
    }

    // Encrypt the Pi-hole password
    const encryptedPassword = await encryption.encrypt(password, this.masterKey);

    const config: PersistedConfig = {
      piholeUrl,
      encryptedPassword,
      notificationsEnabled: options?.notificationsEnabled ?? true,
      refreshInterval: options?.refreshInterval ?? DEFAULTS.REFRESH_INTERVAL,
    };

    await browser.storage.local.set({ [STORAGE_KEYS.CONFIG]: config });
    apiClient.setBaseUrl(piholeUrl);
  }

  /**
   * Get stored configuration.
   */
  async getConfig(): Promise<PersistedConfig | null> {
    const result = await browser.storage.local.get(STORAGE_KEYS.CONFIG);
    const config = result[STORAGE_KEYS.CONFIG] as PersistedConfig | undefined;
    return config || null;
  }

  /**
   * Clear all stored configuration and session.
   */
  async clearConfig(): Promise<void> {
    await browser.storage.local.remove(STORAGE_KEYS.CONFIG);
    await this.clearSession();
    this.masterKey = null;
  }

  /**
   * Authenticate with Pi-hole.
   * @param password Pi-hole web interface password
   * @param totp Optional TOTP code for 2FA
   * @returns Object indicating success and whether TOTP is required
   */
  async authenticate(
    password: string,
    totp?: string
  ): Promise<{ success: boolean; totpRequired?: boolean; error?: string }> {
    const config = await this.getConfig();
    if (!config?.piholeUrl) {
      return { success: false, error: 'Pi-hole URL not configured' };
    }

    const result = await apiClient.authenticate(password, totp);

    if (!result.success) {
      // Check if TOTP is required
      if (result.error?.key === 'totp_required' || result.error?.status === 401) {
        // Check if the response indicates TOTP is needed
        return { success: false, totpRequired: true };
      }
      return { success: false, error: result.error?.message || 'Authentication failed' };
    }

    if (result.data?.session) {
      // Check if TOTP is required but not provided
      if (result.data.session.totp && !totp) {
        return { success: false, totpRequired: true };
      }

      // Store session
      await this.storeSession(
        result.data.session.sid,
        result.data.session.csrf,
        result.data.session.validity
      );

      // Start keepalive
      await this.startSessionKeepalive();

      return { success: true };
    }

    return { success: false, error: 'Invalid response from Pi-hole' };
  }

  /**
   * Logout and clear session.
   */
  async logout(): Promise<void> {
    await apiClient.logout();
    await this.clearSession();
    await this.stopSessionKeepalive();
  }

  /**
   * Store session data in storage.session.
   */
  private async storeSession(sid: string, csrf: string, validity: number): Promise<void> {
    const expiresAt = Date.now() + validity * 1000;
    const session: SessionData = { sid, csrf, expiresAt };
    await browser.storage.session.set({ [STORAGE_KEYS.SESSION]: session });
  }

  /**
   * Get session from storage.session.
   */
  private async getSessionFromStorage(): Promise<SessionData | null> {
    const result = await browser.storage.session.get(STORAGE_KEYS.SESSION);
    const session = result[STORAGE_KEYS.SESSION] as SessionData | undefined;
    return session || null;
  }

  /**
   * Clear session from storage.
   */
  private async clearSession(): Promise<void> {
    await browser.storage.session.remove(STORAGE_KEYS.SESSION);
    apiClient.clearSession();
  }

  /**
   * Start session keepalive alarm.
   */
  private async startSessionKeepalive(): Promise<void> {
    await browser.alarms.create(ALARMS.SESSION_KEEPALIVE, {
      periodInMinutes: DEFAULTS.SESSION_KEEPALIVE_INTERVAL,
    });
  }

  /**
   * Stop session keepalive alarm.
   */
  private async stopSessionKeepalive(): Promise<void> {
    await browser.alarms.clear(ALARMS.SESSION_KEEPALIVE);
  }

  /**
   * Handle keepalive alarm.
   * Pings the API to keep session alive.
   */
  async handleKeepalive(): Promise<boolean> {
    const session = await this.getSessionFromStorage();
    if (!session || session.expiresAt < Date.now()) {
      await this.clearSession();
      return false;
    }

    // Make a lightweight API call to extend session
    const result = await apiClient.getStats();
    if (result.success) {
      // Session is still valid, update expiry
      await this.storeSession(session.sid, session.csrf, 300); // Reset to 5 min
      return true;
    }

    // Session may have expired
    if (result.error?.status === 401) {
      await this.clearSession();
      return false;
    }

    return true; // Keep trying on network errors
  }

  /**
   * Check if we have a valid session.
   */
  async hasValidSession(): Promise<boolean> {
    const session = await this.getSessionFromStorage();
    return session !== null && session.expiresAt > Date.now() && apiClient.hasSession();
  }

  /**
   * Get decrypted password (for re-authentication).
   * Only works if master key is in session storage.
   */
  async getDecryptedPassword(): Promise<string | null> {
    // Try to get master key from session
    if (!this.masterKey) {
      const result = await browser.storage.session.get('masterKey');
      this.masterKey = (result.masterKey as string) || null;
    }

    if (!this.masterKey) {
      return null;
    }

    const config = await this.getConfig();
    if (!config?.encryptedPassword) {
      return null;
    }

    try {
      return await encryption.decrypt(config.encryptedPassword, this.masterKey);
    } catch {
      return null;
    }
  }
}

// Singleton instance
export const authManager = new AuthManager();
