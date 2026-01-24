import { DEFAULTS } from "~/utils/constants";
import type { EncryptedData } from "~/utils/types";

/**
 * Credential encryption using PBKDF2 key derivation and AES-256-GCM.
 *
 * Security model:
 * - Derives encryption key from master password using PBKDF2 with 100k iterations
 * - Uses AES-256-GCM for authenticated encryption
 * - Random salt and IV for each encryption operation
 * - Credentials stored encrypted in storage.local
 */

export class CredentialEncryption {
  /**
   * Encrypt plaintext using the given master password.
   * Returns encrypted data with salt and IV for decryption.
   */
  async encrypt(
    plaintext: string,
    masterPassword: string,
  ): Promise<EncryptedData> {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(DEFAULTS.SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(DEFAULTS.IV_LENGTH));

    const key = await this.deriveKey(masterPassword, salt);

    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(plaintext),
    );

    return {
      ciphertext: this.arrayBufferToBase64(encrypted),
      salt: this.arrayBufferToBase64(salt.buffer as ArrayBuffer),
      iv: this.arrayBufferToBase64(iv.buffer as ArrayBuffer),
    };
  }

  /**
   * Decrypt ciphertext using the given master password.
   * Throws if decryption fails (wrong password or tampered data).
   */
  async decrypt(
    encryptedData: EncryptedData,
    masterPassword: string,
  ): Promise<string> {
    const salt = this.base64ToUint8Array(encryptedData.salt);
    const iv = this.base64ToUint8Array(encryptedData.iv);
    const ciphertext = this.base64ToArrayBuffer(encryptedData.ciphertext);

    const key = await this.deriveKey(masterPassword, salt);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
      key,
      ciphertext,
    );

    return new TextDecoder().decode(decrypted);
  }

  /**
   * Generate a secure random master password.
   * Used when user doesn't provide their own master password.
   */
  generateMasterPassword(length: number = 32): string {
    const charset =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    const values = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(values, (v) => charset[v % charset.length]).join("");
  }

  /**
   * Derive an AES-256-GCM key from a password using PBKDF2.
   */
  private async deriveKey(
    password: string,
    salt: Uint8Array,
  ): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    // Import password as raw key material
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      passwordBuffer,
      "PBKDF2",
      false,
      ["deriveKey"],
    );

    // Derive AES-GCM key using PBKDF2
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt.buffer as ArrayBuffer,
        iterations: DEFAULTS.PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

// Singleton instance
export const encryption = new CredentialEncryption();
