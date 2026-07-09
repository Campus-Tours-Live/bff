import { writeOpts } from "@/api/_shared/write-opts.js";
import type { Request, Response } from "express";

/** Minimal Request exposing only `header()` — the one method writeOpts reads. */
function req(headers: Record<string, string> = {}): Request {
  return { header: (name: string) => headers[name] } as unknown as Request;
}

/** Minimal Response exposing only `getHeader()` — writeOpts reads X-Request-Id from res. */
function res(headers: Record<string, string | number> = {}): Response {
  return { getHeader: (name: string) => headers[name] } as unknown as Response;
}

describe("writeOpts", () => {
  it("forwards the client's Idempotency-Key and the canonical X-Request-Id from res", () => {
    const opts = writeOpts(
      req({ "Idempotency-Key": "idem-123" }),
      res({ "X-Request-Id": "req-abc" }),
    );
    expect(opts).toEqual({ idempotencyKey: "idem-123", correlationId: "req-abc" });
  });

  it("leaves idempotencyKey undefined when the request has no Idempotency-Key", () => {
    const opts = writeOpts(req(), res({ "X-Request-Id": "req-abc" }));
    expect(opts.idempotencyKey).toBeUndefined();
    expect(opts.correlationId).toBe("req-abc");
  });

  it("leaves correlationId undefined when res carries no X-Request-Id", () => {
    const opts = writeOpts(req({ "Idempotency-Key": "idem-123" }), res());
    expect(opts.correlationId).toBeUndefined();
    expect(opts.idempotencyKey).toBe("idem-123");
  });

  it("reads X-Request-Id from res, never from the inbound request", () => {
    const opts = writeOpts(
      req({ "Idempotency-Key": "idem-123", "X-Request-Id": "inbound-ignored" }),
      res({ "X-Request-Id": "canonical-from-res" }),
    );
    expect(opts.correlationId).toBe("canonical-from-res");
  });

  it("stringifies a numeric X-Request-Id from res", () => {
    const opts = writeOpts(req(), res({ "X-Request-Id": 42 }));
    expect(opts.correlationId).toBe("42");
  });
});
