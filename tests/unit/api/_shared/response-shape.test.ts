import { describe, expect, it, jest, afterEach } from "@jest/globals";
import { z } from "zod";
import type { Response } from "express";
import { sendData } from "@/api/_shared/envelope.js";

function mockRes() {
  const res = {
    body: undefined as unknown,
    type() {
      return res;
    },
    send(b: string) {
      res.body = b;
      return res;
    },
    getHeader(): string | undefined {
      return "req-1";
    },
  };
  return res;
}

const Schema = z.object({ a: z.string() });

describe("sendData — dev-only response-shape assertion", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  it("does nothing when the payload matches the schema", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = mockRes();
    expect(() => sendData(res as unknown as Response, { a: "ok" }, Schema)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    expect(JSON.parse(res.body as string).data).toEqual({ a: "ok" });
  });

  it("warns AND throws on a mismatch under NODE_ENV=test", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = mockRes();
    expect(() => sendData(res as unknown as Response, { a: 123 }, Schema)).toThrow(
      /response-shape/,
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns but does NOT throw outside production/test (e.g. development)", () => {
    process.env.NODE_ENV = "development";
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = mockRes();
    expect(() => sendData(res as unknown as Response, { a: 123 }, Schema)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("is a complete no-op in production (never warns, never throws)", () => {
    process.env.NODE_ENV = "production";
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = mockRes();
    expect(() => sendData(res as unknown as Response, { a: 123 }, Schema)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("skips validation entirely when no schema is provided", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = mockRes();
    expect(() => sendData(res as unknown as Response, { anything: true })).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
