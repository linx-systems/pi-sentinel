import { logger } from "./logger";

export enum ErrorType {
  NETWORK = "NETWORK",
  API = "API",
  INTERNAL = "INTERNAL",
}

/**
 * Records operational failures at the boundary where they are handled.
 */
export class ErrorHandler {
  static handle(
    error: unknown,
    context: string,
    type: ErrorType = ErrorType.INTERNAL,
  ): void {
    logger.error(`[${type}] ${context}:`, error);
  }
}
