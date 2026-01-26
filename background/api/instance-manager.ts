import browser from "webextension-polyfill";
import { encryption } from "../crypto/encryption";
import { DEFAULTS, STORAGE_KEYS } from "~/utils/constants";
import { logger } from "~/utils/logger";
import { ErrorHandler, ErrorType } from "~/utils/error-handler";
import type {
  EncryptedData,
  PersistedConfig,
  PersistedInstances,
  PiHoleInstance,
} from "~/utils/types";

// Extension-specific entropy for encrypting master keys
const EXTENSION_ENTROPY = "PiSentinel-v1-MasterKey-Encryption";

/**
 * Instance Manager
 *
 * Handles multi Pi-hole instance storage, including:
 * - CRUD operations for instances
 * - Migration from single-instance to multi-instance format
 * - Per-instance credential encryption
 */
export class InstanceManager {
  /** In-memory master keys per instance (cleared on browser close) */
  private masterKeys: Map<string, string> = new Map();

  /**
   * In-memory cache for instance config.
   * Reduces storage I/O during frequent refreshes.
   */
  private instancesCache: PersistedInstances | null = null;

  /**
   * Initialize the instance manager.
   * Performs migration if needed and loads master keys from session storage.
   */
  async initialize(): Promise<void> {
    try {
      // Check if migration is needed
      await this.migrateIfNeeded();

      // Load any persisted master keys from session storage
      await this.loadMasterKeysFromSession();

      // Set up storage change listener to invalidate cache
      browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && changes[STORAGE_KEYS.INSTANCES]) {
          this.instancesCache = null;
          logger.debug("Instance cache invalidated due to storage change");
        }
      });

      logger.info("Instance manager initialized");
    } catch (error) {
      ErrorHandler.handle(
        error,
        "Instance manager initialization",
        ErrorType.INTERNAL,
      );
    }
  }

  /**
   * Get all configured instances.
   * Uses in-memory cache to reduce storage I/O.
   */
  async getInstances(): Promise<PersistedInstances> {
    // Return cached value if available
    if (this.instancesCache !== null) {
      return this.instancesCache;
    }

    const defaultConfig: PersistedInstances = {
      instances: [],
      activeInstanceId: null,
      globalSettings: {
        notificationsEnabled: true,
        refreshInterval: DEFAULTS.REFRESH_INTERVAL,
      },
    };

    try {
      const result = await browser.storage.local.get(STORAGE_KEYS.INSTANCES);
      const instances = result[STORAGE_KEYS.INSTANCES] as
        | PersistedInstances
        | undefined;

      const config = instances || defaultConfig;

      // Store in cache
      this.instancesCache = config;
      return config;
    } catch (error) {
      logger.error("[InstanceManager] Failed to load instances:", error);
      // Return default config on storage failure to keep extension functional
      this.instancesCache = defaultConfig;
      return defaultConfig;
    }
  }

  /**
   * Get a specific instance by ID.
   */
  async getInstance(instanceId: string): Promise<PiHoleInstance | null> {
    const { instances } = await this.getInstances();
    return instances.find((i) => i.id === instanceId) || null;
  }

  /**
   * Add a new Pi-hole instance.
   */
  async addInstance(
    name: string | null,
    piholeUrl: string,
    password: string,
    rememberPassword: boolean,
  ): Promise<PiHoleInstance> {
    const instanceId = crypto.randomUUID();

    // Generate master key for this instance
    const masterKey = encryption.generateMasterPassword();
    this.masterKeys.set(instanceId, masterKey);

    // Store master key in session storage
    await this.saveMasterKeyToSession(instanceId, masterKey);

    // Encrypt the password
    const encryptedPassword = await encryption.encrypt(password, masterKey);

    // If rememberPassword, also encrypt and persist the master key
    let encryptedMasterKey: EncryptedData | null = null;
    if (rememberPassword) {
      encryptedMasterKey = await encryption.encrypt(
        masterKey,
        EXTENSION_ENTROPY,
      );
      logger.info(
        `[addInstance] Encrypted master key for persistent storage: ${!!encryptedMasterKey}`,
      );
    }

    logger.info(
      `[addInstance] Creating instance with rememberPassword=${rememberPassword}, ` +
        `hasEncryptedMasterKey=${!!encryptedMasterKey}`,
    );

    const instance: PiHoleInstance = {
      id: instanceId,
      name,
      piholeUrl: piholeUrl.replace(/\/+$/, ""), // Normalize URL
      encryptedPassword,
      encryptedMasterKey,
      passwordless: password.length === 0,
      rememberPassword,
      createdAt: Date.now(),
    };

    // Add to storage
    const config = await this.getInstances();
    config.instances.push(instance);

    // If this is the first instance, set it as active
    if (config.instances.length === 1) {
      config.activeInstanceId = instanceId;
    }

    await this.saveInstances(config);

    logger.info(`Added new instance: ${instanceId}`);
    return instance;
  }

  /**
   * Update an existing instance.
   */
  async updateInstance(
    instanceId: string,
    updates: {
      name?: string | null;
      piholeUrl?: string;
      password?: string;
      rememberPassword?: boolean;
    },
  ): Promise<PiHoleInstance | null> {
    const config = await this.getInstances();
    const index = config.instances.findIndex((i) => i.id === instanceId);

    if (index === -1) {
      return null;
    }

    const instance = config.instances[index];

    // Update name
    if (updates.name !== undefined) {
      instance.name = updates.name;
    }

    // Update URL
    if (updates.piholeUrl !== undefined) {
      instance.piholeUrl = updates.piholeUrl.replace(/\/+$/, "");
    }

    // Update password if provided
    if (updates.password !== undefined) {
      let masterKey = this.masterKeys.get(instanceId);

      // Try to recover master key from persistent storage if not in memory
      if (!masterKey && instance.encryptedMasterKey) {
        try {
          masterKey = await encryption.decrypt(
            instance.encryptedMasterKey,
            EXTENSION_ENTROPY,
          );
          this.masterKeys.set(instanceId, masterKey);
          await this.saveMasterKeyToSession(instanceId, masterKey);
        } catch {
          logger.warn(
            `Failed to recover master key for instance: ${instanceId}`,
          );
        }
      }

      // If we still don't have the master key, generate a new one
      if (!masterKey) {
        masterKey = encryption.generateMasterPassword();
        this.masterKeys.set(instanceId, masterKey);
        await this.saveMasterKeyToSession(instanceId, masterKey);
      }

      instance.encryptedPassword = await encryption.encrypt(
        updates.password,
        masterKey,
      );
      instance.passwordless = updates.password.length === 0;

      // Update encrypted master key based on rememberPassword setting
      const shouldRemember =
        updates.rememberPassword ?? instance.rememberPassword;
      if (shouldRemember) {
        instance.encryptedMasterKey = await encryption.encrypt(
          masterKey,
          EXTENSION_ENTROPY,
        );
      } else {
        instance.encryptedMasterKey = null;
      }
    }

    // Update rememberPassword setting
    if (
      updates.rememberPassword !== undefined &&
      updates.password === undefined
    ) {
      if (updates.rememberPassword) {
        // Need to encrypt and store the master key
        let masterKey = this.masterKeys.get(instanceId);

        // Try to recover from persistent storage if not in memory
        if (!masterKey && instance.encryptedMasterKey) {
          try {
            masterKey = await encryption.decrypt(
              instance.encryptedMasterKey,
              EXTENSION_ENTROPY,
            );
            this.masterKeys.set(instanceId, masterKey);
            await this.saveMasterKeyToSession(instanceId, masterKey);
          } catch {
            // Ignore - will handle below
          }
        }

        if (masterKey) {
          instance.rememberPassword = true;
          instance.encryptedMasterKey = await encryption.encrypt(
            masterKey,
            EXTENSION_ENTROPY,
          );
        } else {
          // Cannot enable - master key not available
          logger.warn(
            `Cannot enable rememberPassword for ${instanceId}: master key not available. ` +
              `Re-enter password to enable this feature.`,
          );
          // Keep rememberPassword unchanged (don't set to true with null encryptedMasterKey)
        }
      } else {
        // Disabling remember password
        instance.rememberPassword = false;
        instance.encryptedMasterKey = null;
      }
    }

    config.instances[index] = instance;
    await this.saveInstances(config);

    logger.info(`Updated instance: ${instanceId}`);
    return instance;
  }

  /**
   * Delete an instance.
   */
  async deleteInstance(instanceId: string): Promise<boolean> {
    const config = await this.getInstances();
    const index = config.instances.findIndex((i) => i.id === instanceId);

    if (index === -1) {
      return false;
    }

    // Remove from instances array
    config.instances.splice(index, 1);

    // Clear master key
    this.masterKeys.delete(instanceId);

    // Clean up session storage (non-critical, log failures but continue)
    try {
      await browser.storage.session.remove(`masterKey_${instanceId}`);
      await browser.storage.session.remove(
        `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`,
      );
    } catch (error) {
      logger.warn(
        `[InstanceManager] Failed to clean up session storage for ${instanceId}:`,
        error,
      );
    }

    // If deleted instance was active, switch to first available or null
    if (config.activeInstanceId === instanceId) {
      config.activeInstanceId =
        config.instances.length > 0 ? config.instances[0].id : null;
    }

    await this.saveInstances(config);

    logger.info(`Deleted instance: ${instanceId}`);
    return true;
  }

  /**
   * Set the active instance.
   * @param instanceId Instance ID or null for "All" mode
   */
  async setActiveInstance(instanceId: string | null): Promise<void> {
    const config = await this.getInstances();

    // Validate instance exists (if not null)
    if (instanceId !== null) {
      const exists = config.instances.some((i) => i.id === instanceId);
      if (!exists) {
        throw new Error(`Instance not found: ${instanceId}`);
      }
    }

    config.activeInstanceId = instanceId;
    await this.saveInstances(config);

    logger.info(`Set active instance: ${instanceId || "All"}`);
  }

  /**
   * Get the currently active instance ID.
   * Returns null for "All" mode.
   */
  async getActiveInstanceId(): Promise<string | null> {
    const config = await this.getInstances();
    return config.activeInstanceId;
  }

  /**
   * Update global settings.
   */
  async updateGlobalSettings(settings: {
    notificationsEnabled?: boolean;
    refreshInterval?: number;
  }): Promise<void> {
    const config = await this.getInstances();

    if (settings.notificationsEnabled !== undefined) {
      config.globalSettings.notificationsEnabled =
        settings.notificationsEnabled;
    }
    if (settings.refreshInterval !== undefined) {
      config.globalSettings.refreshInterval = settings.refreshInterval;
    }

    await this.saveInstances(config);
  }

  /**
   * Get decrypted password for an instance.
   */
  async getDecryptedPassword(instanceId: string): Promise<string | null> {
    const instance = await this.getInstance(instanceId);
    if (!instance?.encryptedPassword) {
      logger.info(
        `[getDecryptedPassword] No encryptedPassword for instance: ${instanceId}`,
      );
      return null;
    }

    // Try to get master key from memory
    let masterKey = this.masterKeys.get(instanceId);
    logger.info(
      `[getDecryptedPassword] Memory masterKey for ${instanceId}: ${masterKey ? "found" : "not found"}`,
    );

    // If not in memory, try session storage
    if (!masterKey) {
      const result = await browser.storage.session.get(
        `masterKey_${instanceId}`,
      );
      masterKey = result[`masterKey_${instanceId}`] as string | undefined;
      if (masterKey) {
        this.masterKeys.set(instanceId, masterKey);
        logger.info(
          `[getDecryptedPassword] Session masterKey for ${instanceId}: found`,
        );
      } else {
        logger.info(
          `[getDecryptedPassword] Session masterKey for ${instanceId}: not found`,
        );
      }
    }

    // If not in session, try decrypting from persistent storage (rememberPassword)
    if (
      !masterKey &&
      instance.rememberPassword &&
      instance.encryptedMasterKey
    ) {
      logger.info(
        `[getDecryptedPassword] Trying persistent storage for ${instanceId}: ` +
          `rememberPassword=${instance.rememberPassword}, ` +
          `hasEncryptedMasterKey=${!!instance.encryptedMasterKey}`,
      );
      try {
        masterKey = await encryption.decrypt(
          instance.encryptedMasterKey,
          EXTENSION_ENTROPY,
        );
        this.masterKeys.set(instanceId, masterKey);
        await this.saveMasterKeyToSession(instanceId, masterKey);
        logger.info(
          `[getDecryptedPassword] Successfully decrypted masterKey from persistent storage for ${instanceId}`,
        );
      } catch (error) {
        logger.warn(
          `Failed to decrypt master key for instance: ${instanceId}`,
          error,
        );
        return null;
      }
    } else if (!masterKey) {
      logger.info(
        `[getDecryptedPassword] Cannot use persistent storage for ${instanceId}: ` +
          `rememberPassword=${instance.rememberPassword}, ` +
          `hasEncryptedMasterKey=${!!instance.encryptedMasterKey}`,
      );
    }

    if (!masterKey) {
      logger.info(
        `[getDecryptedPassword] No masterKey available for ${instanceId}`,
      );
      return null;
    }

    try {
      const password = await encryption.decrypt(
        instance.encryptedPassword,
        masterKey,
      );
      logger.info(
        `[getDecryptedPassword] Successfully decrypted password for ${instanceId}`,
      );
      return password;
    } catch (error) {
      logger.warn(
        `[getDecryptedPassword] Failed to decrypt password for instance: ${instanceId}`,
        error,
      );
      return null;
    }
  }

  /**
   * Store master key for an instance (used after successful authentication).
   */
  async setMasterKey(instanceId: string, masterKey: string): Promise<void> {
    this.masterKeys.set(instanceId, masterKey);
    await this.saveMasterKeyToSession(instanceId, masterKey);
  }

  /**
   * Get display name for an instance.
   * Falls back to hostname if name is null.
   */
  getDisplayName(instance: PiHoleInstance): string {
    if (instance.name) {
      return instance.name;
    }

    // Extract hostname from URL
    try {
      const url = new URL(instance.piholeUrl);
      return url.hostname;
    } catch {
      return instance.piholeUrl;
    }
  }

  /**
   * Migrate from single-instance to multi-instance format if needed.
   */
  private async migrateIfNeeded(): Promise<void> {
    // Check if already migrated
    const existingInstances = await browser.storage.local.get(
      STORAGE_KEYS.INSTANCES,
    );
    if (existingInstances[STORAGE_KEYS.INSTANCES]) {
      logger.debug("Already using multi-instance format");
      return;
    }

    // Check for legacy single-instance config
    const legacyResult = await browser.storage.local.get(STORAGE_KEYS.CONFIG);
    const legacyConfig = legacyResult[STORAGE_KEYS.CONFIG] as
      | PersistedConfig
      | undefined;

    if (!legacyConfig?.piholeUrl) {
      logger.debug("No legacy config to migrate");
      return;
    }

    logger.info("Migrating from single-instance to multi-instance format");

    // Create new instance from legacy config
    const instanceId = crypto.randomUUID();

    const instance: PiHoleInstance = {
      id: instanceId,
      name: null, // Will use hostname
      piholeUrl: legacyConfig.piholeUrl,
      encryptedPassword: legacyConfig.encryptedPassword,
      encryptedMasterKey: legacyConfig.encryptedMasterKey,
      rememberPassword: legacyConfig.rememberPassword,
      createdAt: Date.now(),
    };

    const newConfig: PersistedInstances = {
      instances: [instance],
      activeInstanceId: instanceId,
      globalSettings: {
        notificationsEnabled: legacyConfig.notificationsEnabled,
        refreshInterval: legacyConfig.refreshInterval,
      },
    };

    // Save new format
    await this.saveInstances(newConfig);

    // Migrate session data if exists
    const legacySession = await browser.storage.session.get([
      STORAGE_KEYS.SESSION,
      "masterKey",
    ]);

    if (legacySession[STORAGE_KEYS.SESSION]) {
      // Move to instance-specific session key
      await browser.storage.session.set({
        [`${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`]:
          legacySession[STORAGE_KEYS.SESSION],
      });
    }

    if (legacySession.masterKey) {
      // Move to instance-specific master key
      await browser.storage.session.set({
        [`masterKey_${instanceId}`]: legacySession.masterKey,
      });
      this.masterKeys.set(instanceId, legacySession.masterKey as string);
    }

    // Clean up legacy data (but keep backup for now)
    // await browser.storage.local.remove(STORAGE_KEYS.CONFIG);

    logger.info(`Migration complete. Created instance: ${instanceId}`);
  }

  /**
   * Save instances configuration to storage.
   * PERF-3: Also updates the in-memory cache.
   */
  private async saveInstances(config: PersistedInstances): Promise<void> {
    // PERF-3: Update cache before writing to storage
    // This ensures the cache is immediately up-to-date
    this.instancesCache = config;
    await browser.storage.local.set({ [STORAGE_KEYS.INSTANCES]: config });
  }

  /**
   * Load master keys from session storage into memory.
   */
  private async loadMasterKeysFromSession(): Promise<void> {
    const config = await this.getInstances();

    for (const instance of config.instances) {
      const result = await browser.storage.session.get(
        `masterKey_${instance.id}`,
      );
      const masterKey = result[`masterKey_${instance.id}`] as
        | string
        | undefined;
      if (masterKey) {
        this.masterKeys.set(instance.id, masterKey);
      }
    }
  }

  /**
   * Save master key to session storage.
   */
  private async saveMasterKeyToSession(
    instanceId: string,
    masterKey: string,
  ): Promise<void> {
    await browser.storage.session.set({
      [`masterKey_${instanceId}`]: masterKey,
    });
  }
}

// Singleton instance
export const instanceManager = new InstanceManager();
