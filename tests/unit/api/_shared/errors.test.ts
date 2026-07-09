import { CoreAuthError, CoreError } from "@/api/_shared/errors.js";

describe("CoreAuthError", () => {
  it("is an Error subclass with name CoreAuthError and a fixed message", () => {
    const err = new CoreAuthError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CoreAuthError);
    expect(err.name).toBe("CoreAuthError");
    expect(err.message).toBe("Core authentication required");
  });
});

describe("CoreError", () => {
  it("is an Error subclass with name CoreError and carries the status", () => {
    const err = new CoreError(404);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CoreError);
    expect(err.name).toBe("CoreError");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Core error 404");
  });

  it("preserves arbitrary status codes (e.g. 502)", () => {
    const err = new CoreError(502);
    expect(err.status).toBe(502);
    expect(err.message).toBe("Core error 502");
  });

  it("is distinguishable from CoreAuthError", () => {
    expect(new CoreError(500)).not.toBeInstanceOf(CoreAuthError);
    expect(new CoreAuthError()).not.toBeInstanceOf(CoreError);
  });

  it("keeps status with no body (existing behaviour)", () => {
    const e = new CoreError(404);
    expect(e.status).toBe(404);
    expect(e.body).toBeUndefined();
  });

  it("carries body + content-type when provided", () => {
    const e = new CoreError(422, '{"title":"nope"}', "application/problem+json");
    expect(e.status).toBe(422);
    expect(e.body).toBe('{"title":"nope"}');
    expect(e.contentType).toBe("application/problem+json");
  });
});
