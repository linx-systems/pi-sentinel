export type ConnectInstanceFailure =
  | {
      kind: "network";
      message: string;
      status: 0;
    }
  | {
      kind: "authentication";
      message: string;
      status: number;
    }
  | {
      kind: "other";
      message: string;
      status: number | null;
    };

export function classifyConnectInstanceFailure(input: {
  message: string;
  status?: number;
}): ConnectInstanceFailure {
  if (input.status === 0) {
    return { kind: "network", message: input.message, status: 0 };
  }

  if (input.status === 401 || input.status === 403) {
    return {
      kind: "authentication",
      message: input.message,
      status: input.status,
    };
  }

  return {
    kind: "other",
    message: input.message,
    status: input.status ?? null,
  };
}

export function isConnectInstanceFailure(
  value: unknown,
): value is ConnectInstanceFailure {
  if (typeof value !== "object" || value === null) return false;
  if (
    !("kind" in value) ||
    !("message" in value) ||
    !("status" in value) ||
    typeof value.kind !== "string" ||
    typeof value.message !== "string" ||
    (typeof value.status !== "number" && value.status !== null)
  ) {
    return false;
  }

  return (
    (value.kind === "network" && value.status === 0) ||
    (value.kind === "authentication" &&
      (value.status === 401 || value.status === 403)) ||
    value.kind === "other"
  );
}
