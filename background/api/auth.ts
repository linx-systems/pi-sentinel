import browser from "webextension-polyfill";
import { apiClient } from "./client";
import { encryption } from "../crypto/encryption";
import { ALARMS, DEFAULTS, STORAGE_KEYS } from "~/utils/constants";
import { logger } from "~/utils/logger";
import { ErrorHandler, ErrorType } from "~/utils/error-handler";
import type {
  EncryptedData,
  PersistedConfig,
  SessionData,
} from "~/utils/types";

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
   * Attempts to restore session from storage, and auto-reauthenticate if "Remember Password" is enabled.
   *
   * Security Note: The "Remember Password" feature stores an encrypted master key using
   * a hardcoded entropy value. This is a convenience feature but provides limited security
   * since the decryption key is in the source code. For maximum security, users should
   * disable "Remember Password" and re-authenticate after each browser restart.
   */
  async initialize(): Promise<boolean> {
    try {
      const config = await this.getConfig();

      // Set base URL if configured
      if (config?.piholeUrl) {
        apiClient.setBaseUrl(config.piholeUrl);
        logger.info(`Pi-hole URL configured: ${config.piholeUrl}`);
      }

      // Try to restore existing session
      const session = await this.getSessionFromStorage();
      if (session && session.expiresAt > Date.now()) {
        apiClient.setSession(session.sid, session.csrf);
        await this.startSessionKeepalive();
        logger.info("Session restored from storage");
        return true;
      }

      // Try to auto-login with stored credentials if "Remember Password" is enabled
      if (
        config?.rememberPassword &&
        config?.encryptedPassword &&
        config?.encryptedMasterKey
      ) {
        logger.debug(
          "Attempting auto-reauthentication with stored credentials",
        );
        const autoLoginResult = await this.tryAutoReauthenticate();
        if (autoLoginResult) {
          logger.info("Auto-reauthentication successful");
          return true;
        }
        logger.warn("Auto-reauthentication failed");
      }

      logger.debug("No valid session or stored credentials");
      return false;
    } catch (error) {
      ErrorHandler.handle(
        error,
        "Auth manager initialization",
        ErrorType.AUTHENTICATION,
      );
      return false;
    }
  }

  /**
   * Save configuration (URL, encrypted password).
   * @param rememberPassword If true, the master key is encrypted and persisted for auto-reauthentication
   */
  async saveConfig(
    piholeUrl: string,
    password: string,
    options?: {
      notificationsEnabled?: boolean;
      refreshInterval?: number;
      rememberPassword?: boolean;
    },
  ): Promise<void> {
    // Generate or use existing master key
    if (!this.masterKey) {
      this.masterKey = encryption.generateMasterPassword();
    }

    // Always store master key in session storage for current session use
    await browser.storage.session.set({ masterKey: this.masterKey });

    // Encrypt the Pi-hole password
    const encryptedPassword = await encryption.encrypt(
      password,
      this.masterKey,
    );

    const rememberPassword = options?.rememberPassword ?? false;

    // If "Remember Password" is enabled, encrypt and persist the master key
    let encryptedMasterKey: EncryptedData | null = null;
    if (rememberPassword) {
      encryptedMasterKey = await encryption.encrypt(
        this.masterKey,
        EXTENSION_ENTROPY,
      );
    }

    const config: PersistedConfig = {
      piholeUrl,
      encryptedPassword,
      notificationsEnabled: options?.notificationsEnabled ?? true,
      refreshInterval: options?.refreshInterval ?? DEFAULTS.REFRESH_INTERVAL,
      rememberPassword,
      encryptedMasterKey,
    };

    await browser.storage.local.set({ [STORAGE_KEYS.CONFIG]: config });
    apiClient.setBaseUrl(piholeUrl);
  }

  /**
   * Update the "Remember Password" setting without changing other credentials.
   */
  async setRememberPassword(rememberPassword: boolean): Promise<void> {
    const config = await this.getConfig();
    if (!config) {
      throw new Error("No configuration found");
    }

    let encryptedMasterKey: EncryptedData | null = null;

    if (rememberPassword) {
      // Need to have the master key to encrypt it
      if (!this.masterKey) {
        // Try to get it from session storage
        const result = await browser.storage.session.get("masterKey");
        this.masterKey = (result.masterKey as string) || null;
      }

      if (!this.masterKey) {
        throw new Error(
          "Cannot enable Remember Password without active session",
        );
      }

      encryptedMasterKey = await encryption.encrypt(
        this.masterKey,
        EXTENSION_ENTROPY,
      );
    }

    const updatedConfig: PersistedConfig = {
      ...config,
      rememberPassword,
      encryptedMasterKey,
    };

    await browser.storage.local.set({ [STORAGE_KEYS.CONFIG]: updatedConfig });
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
    totp?: string,
  ): Promise<{ success: boolean; totpRequired?: boolean; error?: string }> {
    const config = await this.getConfig();
    if (!config?.piholeUrl) {
      return { success: false, error: "Pi-hole URL not configured" };
    }

    const result = await apiClient.authenticate(password, totp);

    if (!result.success) {
      // Check if TOTP is required
      if (
        result.error?.key === "totp_required" ||
        result.error?.status === 401
      ) {
        // Check if the response indicates TOTP is needed
        return { success: false, totpRequired: true };
      }
      return {
        success: false,
        error: result.error?.message || "Authentication failed",
      };
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
        result.data.session.validity,
      );

      // Start keepalive
      await this.startSessionKeepalive();

      return { success: true };
    }

    return { success: false, error: "Invalid response from Pi-hole" };
  }

  /**
   * Logout and clear session.
   */
  async logout(): Promise<void> {
    await apiClient.logout();
    await this.clearSession();
    await this.stopSessionKeepalive();
    // Clear master key to prevent auto-reauthentication
    this.masterKey = null;
    await browser.storage.session.remove("masterKey");

    // Clear encrypted credentials from config
    const config = await this.getConfig();
    if (config) {
      const cleanedConfig = {
        ...config,
        encryptedPassword: null,
        encryptedMasterKey: null,
        rememberPassword: false,
      };
      await browser.storage.local.set({ [STORAGE_KEYS.CONFIG]: cleanedConfig });
    }
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
    return (
      session !== null &&
      session.expiresAt > Date.now() &&
      apiClient.hasSession()
    );
  }

  /**
   * Get decrypted password (for re-authentication).
   * Works if master key is in session storage, or if "Remember Password" is enabled
   * and the encrypted master key is in local storage.
   */
  async getDecryptedPassword(): Promise<string | null> {
    // Try to get master key from session first
    if (!this.masterKey) {
      const result = await browser.storage.session.get("masterKey");
      this.masterKey = (result.masterKey as string) || null;
    }

    // If not in session, try to decrypt from persistent storage (Remember Password)
    if (!this.masterKey) {
      const config = await this.getConfig();
      if (config?.rememberPassword && config?.encryptedMasterKey) {
        try {
          this.masterKey = await encryption.decrypt(
            config.encryptedMasterKey,
            EXTENSION_ENTROPY,
          );
          // Also store in session for subsequent use
          await browser.storage.session.set({ masterKey: this.masterKey });
        } catch {
          // Decryption failed, master key is lost
          return null;
        }
      }
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

  /**
   * Check if "Remember Password" is enabled in the configuration.
   */
  async isRememberPasswordEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return config?.rememberPassword ?? false;
  }

  /**
   * Proactively renew session before it expires.
   * Called by the keepalive handler when session is about to expire.
   */
  async renewSessionBeforeExpiry(): Promise<boolean> {
    const session = await this.getSessionFromStorage();
    if (!session) {
      return false;
    }

    const timeUntilExpiry = session.expiresAt - Date.now();
    const renewalThreshold = DEFAULTS.SESSION_RENEWAL_THRESHOLD * 1000;

    // Only renew if within the renewal threshold
    if (timeUntilExpiry > renewalThreshold) {
      return true; // Session still valid, no renewal needed
    }

    // Try to re-authenticate
    const password = await this.getDecryptedPassword();
    if (!password) {
      return false;
    }

    const result = await this.authenticate(password);
    return result.success;
  }

  /**
   * Attempt to automatically re-authenticate using stored credentials.
   * Only works when "Remember Password" is enabled and master key is persisted.
   */
  private async tryAutoReauthenticate(): Promise<boolean> {
    try {
      const password = await this.getDecryptedPassword();
      if (!password) {
        logger.debug("Cannot auto-reauthenticate: password decryption failed");
        return false;
      }

      logger.debug("Attempting auto-reauthentication with decrypted password");
      const result = await this.authenticate(password);

      if (!result.success) {
        logger.warn("Auto-reauthentication failed:", result.error);
      }

      return result.success;
    } catch (error) {
      ErrorHandler.handle(
        error,
        "Auto-reauthentication",
        ErrorType.AUTHENTICATION,
      );
      return false;
    }
  }

  /**
   * Store session data in storage.session.
   */
  private async storeSession(
    sid: string,
    csrf: string,
    validity: number,
  ): Promise<void> {
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
}

// Singleton instance
export const authManager = new AuthManager();
