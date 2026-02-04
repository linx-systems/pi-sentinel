/**
 * DNS types.
 */

export interface BlockingStatus {
  blocking: "enabled" | "disabled";
  timer: number | null;
  took?: number;
}

export interface BlockingOptions {
  /** Timer in seconds (0 = indefinite) */
  timer?: number;
}
