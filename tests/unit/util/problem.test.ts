import type { Response } from "express";
import { sendProblem } from "@/util/problem.js";

function mockRes(requestId?: string) {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(c: number) {
      res.statusCode = c;
      return res;
    },
    type(t: string) {
      res.headers["content-type"] = t;
      return res;
    },
    send(b: string) {
      res.body = b;
      return res;
    },
    getHeader(_n: string): string | undefined {
      return requestId;
    },
  };
  return res;
}

describe("sendProblem", () => {
  it("writes a problem+json body with status/title/code and default type", () => {
    const res = mockRes();
    sendProblem(res as unknown as Response, 422, "Bad input", { code: "X_INVALID" });
    expect(res.statusCode).toBe(422);
    expect(res.headers["content-type"]).toBe("application/problem+json");
    expect(JSON.parse(res.body as string)).toMatchObject({
      type: "about:blank",
      title: "Bad input",
      status: 422,
      code: "X_INVALID",
    });
  });

  it("includes detail when given", () => {
    const res = mockRes();
    sendProblem(res as unknown as Response, 400, "Nope", { detail: "field x is required" });
    expect(JSON.parse(res.body as string)).toMatchObject({ detail: "field x is required" });
  });

  it("omits code and detail when absent", () => {
    const res = mockRes();
    sendProblem(res as unknown as Response, 500, "Boom");
    const body = JSON.parse(res.body as string);
    expect(body).not.toHaveProperty("code");
    expect(body).not.toHaveProperty("detail");
    expect(body).toMatchObject({ type: "about:blank", title: "Boom", status: 500 });
  });

  it("sets requestId from the X-Request-Id header", () => {
    const res = mockRes("req-123");
    sendProblem(res as unknown as Response, 404, "Not found");
    expect(JSON.parse(res.body as string).requestId).toBe("req-123");
  });

  it("leaves requestId undefined (absent in JSON) when no header is set", () => {
    const res = mockRes();
    sendProblem(res as unknown as Response, 404, "Not found");
    expect(JSON.parse(res.body as string)).not.toHaveProperty("requestId");
  });

  it("respects an explicit type override", () => {
    const res = mockRes();
    sendProblem(res as unknown as Response, 409, "Conflict", { type: "https://example/err" });
    expect(JSON.parse(res.body as string).type).toBe("https://example/err");
  });

  it("sets status, title, type and content-type together", () => {
    const res = mockRes();
    sendProblem(res as unknown as Response, 418, "Teapot");
    expect(res.statusCode).toBe(418);
    expect(res.headers["content-type"]).toBe("application/problem+json");
    expect(JSON.parse(res.body as string)).toMatchObject({
      type: "about:blank",
      title: "Teapot",
      status: 418,
    });
  });
});
