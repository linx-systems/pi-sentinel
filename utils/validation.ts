/**
 * Validation result structure
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Known multi-part TLDs for domain validation
 * This list covers common cases but is not exhaustive
 */
const MULTI_PART_TLDS = new Set([
  // UK
  "co.uk",
  "ac.uk",
  "gov.uk",
  "org.uk",
  "nhs.uk",
  "police.uk",
  "sch.uk",
  // Australia
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  // New Zealand
  "co.nz",
  "net.nz",
  "org.nz",
  "govt.nz",
  "ac.nz",
  // Other common multi-part TLDs
  "co.za",
  "co.jp",
  "co.kr",
  "co.in",
  "com.br",
  "com.cn",
  "com.mx",
  "com.sg",
]);

/**
 * Comprehensive input validators
 */
export const Validators = {
  /**
   * Validate Pi-hole server URL
   * Must be HTTP or HTTPS, cannot contain javascript: or data: schemes
   */
  piHoleUrl(url: string): ValidationResult {
    if (!url || url.trim().length === 0) {
      return { valid: false, error: "URL is required" };
    }

    try {
      const parsed = new URL(url.trim());

      // Only allow HTTP and HTTPS
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return {
          valid: false,
          error: "Only HTTP and HTTPS URLs are allowed",
        };
      }

      // Reject javascript:, data:, file:, etc.
      if (
        parsed.protocol === "javascript:" ||
        parsed.protocol === "data:" ||
        parsed.protocol === "file:"
      ) {
        return {
          valid: false,
          error: "Invalid URL scheme",
        };
      }

      // Ensure hostname exists
      if (!parsed.hostname) {
        return {
          valid: false,
          error: "URL must have a valid hostname",
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: "Invalid URL format. Please enter a valid HTTP or HTTPS URL.",
      };
    }
  },

  /**
   * Validate domain name
   * Supports standard domain formats including internationalized domains
   */
  domain(domain: string): ValidationResult {
    if (!domain || domain.trim().length === 0) {
      return { valid: false, error: "Domain is required" };
    }

    const trimmed = domain.trim().toLowerCase();

    // Basic length check (RFC 1035)
    if (trimmed.length > 253) {
      return {
        valid: false,
        error: "Domain name too long (max 253 characters)",
      };
    }

    // Check for valid domain format
    // Allows alphanumeric, hyphens, and dots
    // Each label (part between dots) must start and end with alphanumeric
    const domainRegex =
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

    if (!domainRegex.test(trimmed)) {
      return {
        valid: false,
        error:
          "Invalid domain format. Use letters, numbers, hyphens, and dots only.",
      };
    }

    // Ensure it has at least one dot (TLD)
    if (!trimmed.includes(".")) {
      return {
        valid: false,
        error: "Domain must include a top-level domain (e.g., .com)",
      };
    }

    // Check individual label lengths (RFC 1035)
    const labels = trimmed.split(".");
    for (const label of labels) {
      if (label.length > 63) {
        return {
          valid: false,
          error: "Domain label too long (max 63 characters per label)",
        };
      }
      if (label.length === 0) {
        return {
          valid: false,
          error: "Domain cannot have empty labels",
        };
      }
    }

    return { valid: true };
  },

  /**
   * Validate TOTP code (6 digits)
   */
  totp(code: string): ValidationResult {
    if (!code || code.trim().length === 0) {
      return { valid: false, error: "TOTP code is required" };
    }

    const trimmed = code.trim();

    // Must be exactly 6 digits
    if (!/^\d{6}$/.test(trimmed)) {
      return {
        valid: false,
        error: "TOTP code must be exactly 6 digits",
      };
    }

    return { valid: true };
  },

  /**
   * Validate timer value (in seconds)
   * Must be between 0 and 86400 (24 hours)
   */
  timer(seconds: number): ValidationResult {
    if (typeof seconds !== "number" || isNaN(seconds)) {
      return {
        valid: false,
        error: "Timer value must be a number",
      };
    }

    if (seconds < 0) {
      return {
        valid: false,
        error: "Timer value cannot be negative",
      };
    }

    if (seconds > 86400) {
      return {
        valid: false,
        error: "Timer value cannot exceed 24 hours (86400 seconds)",
      };
    }

    return { valid: true };
  },

  /**
   * Validate password
   * Basic check - not empty
   */
  password(password: string): ValidationResult {
    if (!password || password.length === 0) {
      return { valid: false, error: "Password is required" };
    }

    // Could add more sophisticated checks here
    // For now, just ensure it's not empty
    return { valid: true };
  },

  /**
   * Validate port number
   */
  port(port: number): ValidationResult {
    if (typeof port !== "number" || isNaN(port)) {
      return {
        valid: false,
        error: "Port must be a number",
      };
    }

    if (port < 1 || port > 65535) {
      return {
        valid: false,
        error: "Port must be between 1 and 65535",
      };
    }

    return { valid: true };
  },

  /**
   * Validate IP address (IPv4 or IPv6)
   */
  ipAddress(ip: string): ValidationResult {
    if (!ip || ip.trim().length === 0) {
      return { valid: false, error: "IP address is required" };
    }

    const trimmed = ip.trim();

    // Check IPv4
    const ipv4Regex =
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (ipv4Regex.test(trimmed)) {
      return { valid: true };
    }

    // Check IPv6 (simplified - full IPv6 validation is complex)
    const ipv6Regex = /^(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i;
    if (ipv6Regex.test(trimmed)) {
      return { valid: true };
    }

    // Check compressed IPv6
    if (trimmed.includes("::")) {
      const parts = trimmed.split("::");
      if (parts.length === 2) {
        return { valid: true }; // Simplified check
      }
    }

    return {
      valid: false,
      error: "Invalid IP address format",
    };
  },
};

/**
 * Helper function to throw validation error
 * Useful for cases where you want to validate and throw in one step
 */
export function assertValid(
  result: ValidationResult,
  fieldName: string = "Input",
): void {
  if (!result.valid) {
    throw new Error(`${fieldName} validation failed: ${result.error}`);
  }
}

/**
 * Batch validate multiple fields
 * Returns first error encountered, or success if all valid
 */
export function validateAll(
  validations: Array<{ name: string; result: ValidationResult }>,
): ValidationResult {
  for (const { name, result } of validations) {
    if (!result.valid) {
      return {
        valid: false,
        error: `${name}: ${result.error}`,
      };
    }
  }
  return { valid: true };
}

/**
 * Get registrable domain (eTLD+1) for site comparison.
 * Handles multi-part TLDs (e.g., .co.uk, .com.au) correctly.
 *
 * @example
 * getRegistrableDomain("www.example.com")     // "example.com"
 * getRegistrableDomain("api.example.co.uk")   // "example.co.uk"
 * getRegistrableDomain("sub.domain.com.au")   // "domain.com.au"
 *
 * @param domain - Full domain name
 * @returns Registrable domain (eTLD+1)
 */
export function getRegistrableDomain(domain: string): string {
  const parts = domain.toLowerCase().split(".");

  // Check for multi-part TLD
  if (parts.length >= 3) {
    const possibleTld = parts.slice(-2).join(".");
    if (MULTI_PART_TLDS.has(possibleTld)) {
      // Return eTLD+1 (three parts for multi-part TLD)
      return parts.slice(-3).join(".");
    }
  }

  // Default: return last 2 parts (domain.tld)
  return parts.slice(-2).join(".");
}

/**
 * Check if two domains are from the same site (same eTLD+1).
 *
 * @example
 * isSameSite("www.example.com", "api.example.com")   // true
 * isSameSite("example.co.uk", "other.co.uk")         // false
 * isSameSite("192.168.1.1", "192.168.1.1")           // true (exact match for IPs)
 * isSameSite("localhost", "localhost")               // true
 *
 * @param domain1 - First domain
 * @param domain2 - Second domain
 * @returns True if domains share the same registrable domain
 */
export function isSameSite(domain1: string, domain2: string): boolean {
  // Handle IP addresses
  if (
    Validators.ipAddress(domain1).valid &&
    Validators.ipAddress(domain2).valid
  ) {
    return domain1 === domain2;
  }

  // Handle localhost
  if (domain1 === "localhost" || domain2 === "localhost") {
    return domain1 === domain2;
  }

  // Compare registrable domains
  const reg1 = getRegistrableDomain(domain1);
  const reg2 = getRegistrableDomain(domain2);

  return reg1 === reg2;
}
