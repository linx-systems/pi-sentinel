import { beforeEach, describe, expect, it, vi } from "vitest";
import { CredentialEncryption } from "~/background/crypto/encryption";

describe("CredentialEncryption", () => {
  let encryption: CredentialEncryption;

  beforeEach(() => {
    encryption = new CredentialEncryption();

    // Mock crypto.subtle methods
    vi.spyOn(crypto.subtle, "importKey").mockResolvedValue({} as CryptoKey);
    vi.spyOn(crypto.subtle, "deriveKey").mockResolvedValue({} as CryptoKey);
    vi.spyOn(crypto.subtle, "encrypt").mockResolvedValue(new ArrayBuffer(32));
    vi.spyOn(crypto.subtle, "decrypt").mockResolvedValue(
      new TextEncoder().encode("decrypted").buffer,
    );
  });

  describe("encrypt", () => {
    it("should encrypt plaintext with master password", async () => {
      const plaintext = "my-secret-password";
      const masterPassword = "master-password-123";

      const encrypted = await encryption.encrypt(plaintext, masterPassword);

      expect(encrypted).toHaveProperty("ciphertext");
      expect(encrypted).toHaveProperty("salt");
      expect(encrypted).toHaveProperty("iv");
      expect(encrypted.ciphertext).toBeTruthy();
      expect(encrypted.salt).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
    });

    it("should produce different ciphertext for same input (due to random salt/IV)", async () => {
      const plaintext = "test-password";
      const masterPassword = "master";

      const encrypted1 = await encryption.encrypt(plaintext, masterPassword);
      const encrypted2 = await encryption.encrypt(plaintext, masterPassword);

      // Different salt and IV should produce different results
      expect(encrypted1.salt).not.toBe(encrypted2.salt);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    it("should call crypto.subtle methods correctly", async () => {
      const plaintext = "test";
      const masterPassword = "master";

      await encryption.encrypt(plaintext, masterPassword);

      expect(crypto.subtle.importKey).toHaveBeenCalled();
      expect(crypto.subtle.deriveKey).toHaveBeenCalled();
      expect(crypto.subtle.encrypt).toHaveBeenCalled();
    });
  });

  describe("decrypt", () => {
    it("should decrypt encrypted data with correct password", async () => {
      const encryptedData = {
        ciphertext: "dGVzdA==",
        salt: "c2FsdA==",
        iv: "aXY=",
      };
      const masterPassword = "master-password";

      const decrypted = await encryption.decrypt(encryptedData, masterPassword);

      expect(typeof decrypted).toBe("string");
    });

    it("should call crypto.subtle methods correctly", async () => {
      const encryptedData = {
        ciphertext: "dGVzdA==",
        salt: "c2FsdA==",
        iv: "aXY=",
      };

      await encryption.decrypt(encryptedData, "password");

      expect(crypto.subtle.importKey).toHaveBeenCalled();
      expect(crypto.subtle.deriveKey).toHaveBeenCalled();
      expect(crypto.subtle.decrypt).toHaveBeenCalled();
    });

    it("should throw error with wrong password", async () => {
      vi.spyOn(crypto.subtle, "decrypt").mockRejectedValue(
        new Error("Decryption failed"),
      );

      const encryptedData = {
        ciphertext: "dGVzdA==",
        salt: "c2FsdA==",
        iv: "aXY=",
      };

      await expect(
        encryption.decrypt(encryptedData, "wrong-password"),
      ).rejects.toThrow("Decryption failed");
    });
  });

  describe("generateMasterPassword", () => {
    it("should generate password of default length", () => {
      const password = encryption.generateMasterPassword();

      expect(password).toBeTruthy();
      expect(password.length).toBe(32);
    });

    it("should generate password of custom length", () => {
      const password = encryption.generateMasterPassword(16);

      expect(password.length).toBe(16);
    });

    it("should generate different passwords each time", () => {
      const password1 = encryption.generateMasterPassword();
      const password2 = encryption.generateMasterPassword();

      expect(password1).not.toBe(password2);
    });

    it("should only contain valid characters", () => {
      const password = encryption.generateMasterPassword(100);
      const validCharset = /^[A-Za-z0-9!@#$%^&*]+$/;

      expect(password).toMatch(validCharset);
    });
  });

  describe("round-trip encryption", () => {
    it("should encrypt and decrypt correctly with mocked crypto", async () => {
      // For this test, we need a more realistic mock
      const originalText = "my-secret-password";
      const masterPassword = "master123";

      // Mock encrypt to return a predictable result
      const mockEncrypted = new TextEncoder().encode(originalText).buffer;
      vi.spyOn(crypto.subtle, "encrypt").mockResolvedValue(mockEncrypted);

      // Mock decrypt to return the original text
      vi.spyOn(crypto.subtle, "decrypt").mockResolvedValue(
        new TextEncoder().encode(originalText).buffer,
      );

      const encrypted = await encryption.encrypt(originalText, masterPassword);
      const decrypted = await encryption.decrypt(encrypted, masterPassword);

      expect(decrypted).toBe(originalText);
    });
  });
});
