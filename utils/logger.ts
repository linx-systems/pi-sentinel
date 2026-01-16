import browser from "webextension-polyfill";

/**
 * Log levels in order of severity
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Log entry structure for storage
 */
interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  context?: any[];
}

/**
 * Centralized logger with level-based filtering and production mode support
 */
class Logger {
  private level: LogLevel = "info";
  private enabled: boolean = true;
  private logs: LogEntry[] = [];
  private readonly MAX_LOGS = 100;

  constructor() {
    this.initialize();
  }

  /**
   * Initialize logger - disable in production builds
   */
  private initialize(): void {
    const manifest = browser.runtime.getManifest();

    // Disable verbose logging in production (when extension is signed and has update_url)
    if (manifest.browser_specific_settings?.gecko?.update_url) {
      this.level = "error"; // Only log errors in production
    }

    // Check if debug mode is explicitly enabled
    browser.storage.local.get("debug_mode").then(({ debug_mode }) => {
      if (debug_mode === true) {
        this.level = "debug";
        this.info("Debug mode enabled");
      }
    });
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
    this.info(`Log level set to: ${level}`);
  }

  /**
   * Enable or disable logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    if (!this.enabled) return false;

    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    const currentLevelIndex = levels.indexOf(this.level);
    const messageLevelIndex = levels.indexOf(level);

    return messageLevelIndex >= currentLevelIndex;
  }

  /**
   * Store log entry
   */
  private storeLog(level: LogLevel, message: string, context: any[]): void {
    this.logs.push({
      level,
      message,
      timestamp: Date.now(),
      context,
    });

    // Maintain size limit
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }
  }

  /**
   * Format log message with timestamp
   */
  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  }

  /**
   * Debug log - most verbose
   */
  debug(message: string, ...context: any[]): void {
    if (!this.shouldLog("debug")) return;

    this.storeLog("debug", message, context);
    console.log(this.formatMessage("debug", message), ...context);
  }

  /**
   * Info log - general information
   */
  info(message: string, ...context: any[]): void {
    if (!this.shouldLog("info")) return;

    this.storeLog("info", message, context);
    console.log(this.formatMessage("info", message), ...context);
  }

  /**
   * Warning log - potential issues
   */
  warn(message: string, ...context: any[]): void {
    if (!this.shouldLog("warn")) return;

    this.storeLog("warn", message, context);
    console.warn(this.formatMessage("warn", message), ...context);
  }

  /**
   * Error log - always logged, even in production
   */
  error(message: string, ...context: any[]): void {
    this.storeLog("error", message, context);
    console.error(this.formatMessage("error", message), ...context);
  }

  /**
   * Get recent logs for debugging
   */
  getRecentLogs(limit = 50): LogEntry[] {
    return this.logs.slice(-limit);
  }

  /**
   * Get logs by level
   */
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter((log) => log.level === level);
  }

  /**
   * Clear all stored logs
   */
  clearLogs(): void {
    this.logs = [];
    this.debug("Logs cleared");
  }

  /**
   * Export logs as JSON for debugging
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

/**
 * Singleton logger instance
 */
export const logger = new Logger();

/**
 * Enable debug mode programmatically
 */
export function enableDebugMode(): void {
  browser.storage.local.set({ debug_mode: true });
  logger.setLevel("debug");
  logger.info("Debug mode enabled");
}

/**
 * Disable debug mode
 */
export function disableDebugMode(): void {
  browser.storage.local.set({ debug_mode: false });
  logger.setLevel("info");
  logger.info("Debug mode disabled");
}
