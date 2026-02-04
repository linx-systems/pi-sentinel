import { describe, expect, test } from "bun:test";
import {
  andThen,
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  unwrap,
  unwrapOr,
} from "../../src/result";

describe("Result", () => {
  describe("ok", () => {
    test("creates Ok result", () => {
      const result = ok(42);
      expect(result.ok).toBe(true);
      expect(result.data).toBe(42);
    });
  });

  describe("err", () => {
    test("creates Err result", () => {
      const result = err("error");
      expect(result.ok).toBe(false);
      expect(result.error).toBe("error");
    });
  });

  describe("isOk", () => {
    test("returns true for Ok", () => {
      expect(isOk(ok(42))).toBe(true);
    });

    test("returns false for Err", () => {
      expect(isOk(err("error"))).toBe(false);
    });
  });

  describe("isErr", () => {
    test("returns true for Err", () => {
      expect(isErr(err("error"))).toBe(true);
    });

    test("returns false for Ok", () => {
      expect(isErr(ok(42))).toBe(false);
    });
  });

  describe("unwrap", () => {
    test("returns data for Ok", () => {
      expect(unwrap(ok(42))).toBe(42);
    });

    test("throws for Err", () => {
      expect(() => unwrap(err("error"))).toThrow("error");
    });
  });

  describe("unwrapOr", () => {
    test("returns data for Ok", () => {
      expect(unwrapOr(ok(42), 0)).toBe(42);
    });

    test("returns default for Err", () => {
      expect(unwrapOr(err("error"), 0)).toBe(0);
    });
  });

  describe("map", () => {
    test("transforms Ok value", () => {
      const result = map(ok(21), (x) => x * 2);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBe(42);
      }
    });

    test("passes through Err", () => {
      const result = map(err("error"), (x: number) => x * 2);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe("error");
      }
    });
  });

  describe("mapErr", () => {
    test("transforms Err value", () => {
      const result = mapErr(err("error"), (e) => e.toUpperCase());
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe("ERROR");
      }
    });

    test("passes through Ok", () => {
      const result = mapErr(ok(42), (e: string) => e.toUpperCase());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBe(42);
      }
    });
  });

  describe("andThen", () => {
    test("chains Ok results", () => {
      const result = andThen(ok(21), (x) => ok(x * 2));
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBe(42);
      }
    });

    test("passes through Err", () => {
      const result = andThen(err("error"), (x: number) => ok(x * 2));
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe("error");
      }
    });

    test("returns Err from chain function", () => {
      const result = andThen(ok(42), () => err("chain error"));
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe("chain error");
      }
    });
  });
});
