import browser from "webextension-polyfill";
import { encryption } from "../crypto/encryption";
import { isSessionData } from "../session-storage";
import { DEFAULTS, EXTENSION_ENTROPY, STORAGE_KEYS } from "~/utils/constants";
import { logger } from "~/utils/logger";
import { ErrorHandler, ErrorType } from "~/utils/error-handler";
import type {
  EncryptedData,
  PersistedConfig,
  PersistedInstances,
  PiHoleInstance,
} from "~/utils/types";

type LegacyMigrationMarker = {
  version: 1;
  instanceId?: string;
};

const LEGACY_MIGRATION_KEY = "pisentinel_instances_migration_v1";

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
  private instanceMutationTail: Promise<void> = Promise.resolve();

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
      throw error;
    }
  }

  /**
   * Get all configured instances.
   * Uses in-memory cache to reduce storage I/O.
   */
  async getInstances(): Promise<PersistedInstances> {
    if (this.instancesCache !== null) {
      return structuredClone(this.instancesCache);
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
      const config =
        (result[STORAGE_KEYS.INSTANCES] as PersistedInstances | undefined) ??
        defaultConfig;
      this.instancesCache = structuredClone(config);
      return structuredClone(config);
    } catch (error) {
      logger.error("[InstanceManager] Failed to load instances:", error);
      throw error;
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
    return this.mutateInstances(async () => {
      const instanceId = crypto.randomUUID();
      const masterKey = encryption.generateMasterPassword();
      this.masterKeys.set(instanceId, masterKey);
      await this.saveMasterKeyToSession(instanceId, masterKey);

      const encryptedPassword = await encryption.encrypt(password, masterKey);
      const encryptedMasterKey = rememberPassword
        ? await encryption.encrypt(masterKey, EXTENSION_ENTROPY)
        : null;

      const instance: PiHoleInstance = {
        id: instanceId,
        name,
        piholeUrl: piholeUrl.replace(/\/+$/, ""),
        encryptedPassword,
        encryptedMasterKey,
        passwordless: password.length === 0,
        rememberPassword,
        createdAt: Date.now(),
      };

      const config = await this.getInstances();
      config.instances.push(instance);
      if (config.instances.length === 1) {
        config.activeInstanceId = instanceId;
      }
      await this.saveInstances(config);

      logger.info(`Added new instance: ${instanceId}`);
      return instance;
    });
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
    return this.mutateInstances(async () => {
      const config = await this.getInstances();
      const index = config.instances.findIndex((i) => i.id === instanceId);
      if (index === -1) return null;

      const instance = config.instances[index];
      if (updates.name !== undefined) instance.name = updates.name;
      if (updates.piholeUrl !== undefined) {
        instance.piholeUrl = updates.piholeUrl.replace(/\/+$/, "");
      }

      if (updates.password !== undefined) {
        let masterKey = this.masterKeys.get(instanceId);
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
        const shouldRemember =
          updates.rememberPassword ?? instance.rememberPassword;
        instance.encryptedMasterKey = shouldRemember
          ? await encryption.encrypt(masterKey, EXTENSION_ENTROPY)
          : null;
      }

      if (
        updates.rememberPassword !== undefined &&
        updates.password === undefined
      ) {
        if (updates.rememberPassword) {
          let masterKey = this.masterKeys.get(instanceId);
          if (!masterKey && instance.encryptedMasterKey) {
            try {
              masterKey = await encryption.decrypt(
                instance.encryptedMasterKey,
                EXTENSION_ENTROPY,
              );
              this.masterKeys.set(instanceId, masterKey);
              await this.saveMasterKeyToSession(instanceId, masterKey);
            } catch {
              // The user must re-enter the password when recovery fails.
            }
          }
          if (masterKey) {
            instance.rememberPassword = true;
            instance.encryptedMasterKey = await encryption.encrypt(
              masterKey,
              EXTENSION_ENTROPY,
            );
          } else {
            logger.warn(
              `Cannot enable rememberPassword for ${instanceId}: master key not available. Re-enter password to enable this feature.`,
            );
          }
        } else {
          instance.rememberPassword = false;
          instance.encryptedMasterKey = null;
        }
      }

      config.instances[index] = instance;
      await this.saveInstances(config);
      logger.info(`Updated instance: ${instanceId}`);
      return instance;
    });
  }

  /**
   * Delete an instance.
   */
  async deleteInstance(instanceId: string): Promise<boolean> {
    const deleted = await this.removeInstanceConfiguration(instanceId);
    if (!deleted) return false;
    await this.deleteInstanceSessionMaterial(instanceId);
    logger.info(`Deleted instance: ${instanceId}`);
    return true;
  }

  /**
   * Durably remove an instance configuration without touching credentials.
   * Runtime deletion uses this after temporary-allow cleanup and before its
   * ordered credential cleanup.
   */
  async removeInstanceConfiguration(instanceId: string): Promise<boolean> {
    return this.mutateInstances(async () => {
      const config = await this.getInstances();
      const index = config.instances.findIndex((i) => i.id === instanceId);
      if (index === -1) return false;

      config.instances.splice(index, 1);
      if (config.activeInstanceId === instanceId) {
        config.activeInstanceId =
          config.instances.length > 0 ? config.instances[0].id : null;
      }
      await this.saveInstances(config);
      return true;
    });
  }

  /**
   * Removes only ephemeral credentials after their instance has been durably removed.
   * This stays inside the background composition boundary so runtime callers
   * cannot access credential material.
   */
  async deleteInstanceSessionMaterial(instanceId: string): Promise<void> {
    await browser.storage.session.remove([
      `masterKey_${instanceId}`,
      `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`,
    ]);
    this.masterKeys.delete(instanceId);
  }

  /**
   * Set the active instance.
   * @param instanceId Instance ID or null for "All" mode
   */
  async setActiveInstance(instanceId: string | null): Promise<void> {
    await this.mutateInstances(async () => {
      const config = await this.getInstances();
      if (
        instanceId !== null &&
        !config.instances.some((instance) => instance.id === instanceId)
      ) {
        throw new Error(`Instance not found: ${instanceId}`);
      }
      config.activeInstanceId = instanceId;
      await this.saveInstances(config);
      logger.info(`Set active instance: ${instanceId || "All"}`);
    });
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
    await this.mutateInstances(async () => {
      const config = await this.getInstances();
      if (settings.notificationsEnabled !== undefined) {
        config.globalSettings.notificationsEnabled =
          settings.notificationsEnabled;
      }
      if (settings.refreshInterval !== undefined) {
        config.globalSettings.refreshInterval = settings.refreshInterval;
      }
      await this.saveInstances(config);
    });
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

    // Passwordless instances always use empty string - no decryption needed
    if (instance.passwordless) {
      logger.info(
        `[getDecryptedPassword] Passwordless instance ${instanceId}: returning empty password`,
      );
      return "";
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
   * Converts a legacy single-instance snapshot into a verified multi-instance
   * snapshot. The legacy source remains untouched: it is migration input only,
   * never a runtime fallback.
   *
   * Each write is independently repeatable. The completion marker is the
   * final write, after the local target and every available session value are
   * read back and verified.
   */
  private async migrateIfNeeded(): Promise<void> {
    const stored = await browser.storage.local.get([
      STORAGE_KEYS.INSTANCES,
      STORAGE_KEYS.CONFIG,
      LEGACY_MIGRATION_KEY,
    ]);
    if (this.isMigrationComplete(stored[LEGACY_MIGRATION_KEY])) {
      return;
    }

    const legacyConfig = stored[STORAGE_KEYS.CONFIG];
    if (!this.isLegacyConfig(legacyConfig)) {
      return;
    }

    const expected = this.createMigrationTarget(legacyConfig);
    const existing = stored[STORAGE_KEYS.INSTANCES];
    const equivalent = this.findEquivalentLegacyInstance(
      existing,
      expected.instances[0],
    );
    const targetInstance = equivalent ?? expected.instances[0];
    const instanceId = targetInstance.id;
    const sessionMaterial = await browser.storage.session.get([
      STORAGE_KEYS.SESSION,
      "masterKey",
      `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`,
      `masterKey_${instanceId}`,
    ]);
    const targetSessionKey = `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`;
    const targetMasterKey = `masterKey_${instanceId}`;
    const sourceSession =
      sessionMaterial[targetSessionKey] ??
      (isSessionData(sessionMaterial[STORAGE_KEYS.SESSION])
        ? sessionMaterial[STORAGE_KEYS.SESSION]
        : undefined);
    const sourceMasterKey =
      sessionMaterial[targetMasterKey] ?? sessionMaterial.masterKey;

    if (
      sourceSession !== undefined &&
      !this.isEqual(sessionMaterial[targetSessionKey], sourceSession)
    ) {
      await browser.storage.session.set({ [targetSessionKey]: sourceSession });
    }

    if (
      sourceMasterKey !== undefined &&
      sessionMaterial[targetMasterKey] !== sourceMasterKey
    ) {
      await browser.storage.session.set({ [targetMasterKey]: sourceMasterKey });
    }

    if (
      !(await this.isMigrationSessionMaterialVerified(
        instanceId,
        sourceSession,
        sourceMasterKey,
      ))
    ) {
      throw new Error("Legacy migration credential verification failed");
    }

    const target = this.mergeMigrationTarget(existing, expected);
    if (!this.hasMigratedInstance(existing, targetInstance)) {
      await this.saveInstances(target);
    }

    if (
      !(await this.isMigrationTargetVerified(
        targetInstance,
        sourceSession,
        sourceMasterKey,
      ))
    ) {
      throw new Error("Legacy migration target verification failed");
    }

    await browser.storage.local.set({
      [LEGACY_MIGRATION_KEY]: {
        version: 1,
        instanceId,
      } satisfies LegacyMigrationMarker,
    });
    logger.info(`Migrated legacy configuration to instance: ${instanceId}`);
  }

  private isLegacyConfig(value: unknown): value is PersistedConfig {
    if (!value || typeof value !== "object") {
      return false;
    }
    const config = value as Record<string, unknown>;
    return (
      typeof config.piholeUrl === "string" &&
      config.piholeUrl.length > 0 &&
      Number.isFinite(config.refreshInterval) &&
      typeof config.notificationsEnabled === "boolean" &&
      typeof config.rememberPassword === "boolean" &&
      this.isEncryptedDataOrNull(config.encryptedPassword) &&
      this.isEncryptedDataOrNull(config.encryptedMasterKey)
    );
  }

  private isEncryptedDataOrNull(value: unknown): value is EncryptedData | null {
    if (value === null) {
      return true;
    }
    if (!value || typeof value !== "object") {
      return false;
    }
    const encrypted = value as Record<string, unknown>;
    return (
      typeof encrypted.ciphertext === "string" &&
      typeof encrypted.salt === "string" &&
      typeof encrypted.iv === "string"
    );
  }

  private createMigrationTarget(legacy: PersistedConfig): PersistedInstances {
    const instanceId = `legacy-${this.fingerprintLegacyConfig(legacy)}`;
    return {
      instances: [
        {
          id: instanceId,
          name: null,
          piholeUrl: legacy.piholeUrl,
          encryptedPassword: legacy.encryptedPassword,
          encryptedMasterKey: legacy.encryptedMasterKey,
          rememberPassword: legacy.rememberPassword,
          passwordless: legacy.encryptedPassword === null,
          createdAt: Date.now(),
        },
      ],
      activeInstanceId: instanceId,
      globalSettings: {
        notificationsEnabled: legacy.notificationsEnabled,
        refreshInterval: legacy.refreshInterval,
      },
    };
  }

  private fingerprintLegacyConfig(legacy: PersistedConfig): string {
    const input = JSON.stringify([
      legacy.piholeUrl,
      legacy.encryptedPassword,
      legacy.encryptedMasterKey,
      legacy.rememberPassword,
    ]);
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  private mergeMigrationTarget(
    existing: unknown,
    expected: PersistedInstances,
  ): PersistedInstances {
    if (!this.isPersistedInstances(existing)) {
      return expected;
    }

    const target = structuredClone(existing);
    const expectedInstance = expected.instances[0];
    if (
      target.instances.some((instance) =>
        this.isSameLegacyInstance(instance, expectedInstance),
      )
    ) {
      return target;
    }

    target.instances.push(expectedInstance);
    return target;
  }

  private isPersistedInstances(value: unknown): value is PersistedInstances {
    return (
      !!value &&
      typeof value === "object" &&
      Array.isArray((value as PersistedInstances).instances) &&
      "activeInstanceId" in value &&
      "globalSettings" in value
    );
  }

  private isSameLegacyInstance(
    candidate: PiHoleInstance,
    expected: PiHoleInstance,
  ): boolean {
    return (
      candidate.piholeUrl === expected.piholeUrl &&
      candidate.rememberPassword === expected.rememberPassword &&
      candidate.passwordless === expected.passwordless &&
      this.isEqual(candidate.encryptedPassword, expected.encryptedPassword) &&
      this.isEqual(candidate.encryptedMasterKey, expected.encryptedMasterKey)
    );
  }

  private findEquivalentLegacyInstance(
    value: unknown,
    expected: PiHoleInstance,
  ): PiHoleInstance | undefined {
    if (!this.isPersistedInstances(value)) {
      return undefined;
    }
    return value.instances.find((instance) =>
      this.isSameLegacyInstance(instance, expected),
    );
  }

  private hasMigratedInstance(
    value: unknown,
    expected: PiHoleInstance,
  ): boolean {
    return (
      this.isPersistedInstances(value) &&
      value.instances.some(
        (instance) =>
          instance.id === expected.id &&
          this.isSameLegacyInstance(instance, expected),
      )
    );
  }

  private async isMigrationTargetVerified(
    expected: PiHoleInstance,
    sourceSession: unknown,
    sourceMasterKey: unknown,
  ): Promise<boolean> {
    const stored = await browser.storage.local.get(STORAGE_KEYS.INSTANCES);
    return (
      this.hasMigratedInstance(stored[STORAGE_KEYS.INSTANCES], expected) &&
      (await this.isMigrationSessionMaterialVerified(
        expected.id,
        sourceSession,
        sourceMasterKey,
      ))
    );
  }

  private async isMigrationSessionMaterialVerified(
    instanceId: string,
    sourceSession: unknown,
    sourceMasterKey: unknown,
  ): Promise<boolean> {
    const keys = [
      ...(sourceSession === undefined
        ? []
        : [`${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`]),
      ...(sourceMasterKey === undefined ? [] : [`masterKey_${instanceId}`]),
    ];
    if (keys.length === 0) {
      return true;
    }

    const sessionMaterial = await browser.storage.session.get(keys);
    return (
      (sourceSession === undefined ||
        this.isEqual(
          sessionMaterial[
            `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`
          ],
          sourceSession,
        )) &&
      (sourceMasterKey === undefined ||
        sessionMaterial[`masterKey_${instanceId}`] === sourceMasterKey)
    );
  }

  private isMigrationComplete(value: unknown): value is LegacyMigrationMarker {
    return (
      !!value &&
      typeof value === "object" &&
      (value as LegacyMigrationMarker).version === 1
    );
  }

  private isEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private mutateInstances<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.instanceMutationTail
      .catch(() => undefined)
      .then(operation);
    this.instanceMutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async saveInstances(config: PersistedInstances): Promise<void> {
    const snapshot = structuredClone(config);
    await browser.storage.local.set({ [STORAGE_KEYS.INSTANCES]: snapshot });
    this.instancesCache = snapshot;
  }
  private async loadMasterKeysFromSession(): Promise<void> {
    const config = await this.getInstances();

    for (const instance of config.instances) {
      const result = await browser.storage.session.get(
        `masterKey_${instance.id}`,
      );
      const masterKey = result[`masterKey_${instance.id}`] as
        string | undefined;
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
