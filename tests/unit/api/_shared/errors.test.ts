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

  it("leaves code/title/detail/properties undefined when constructed directly (existing 3-arg callers unaffected)", () => {
    const e = new CoreError(422, '{"title":"nope"}', "application/problem+json");
    expect(e.code).toBeUndefined();
    expect(e.title).toBeUndefined();
    expect(e.detail).toBeUndefined();
    expect(e.properties).toBeUndefined();
  });
});

describe("CoreError.fromResponse", () => {
  it("parses a coded 404 problem+json body: code/title/detail + extension members as properties", () => {
    const raw = JSON.stringify({
      code: "ACCOUNT_NOT_PROVISIONED",
      title: "Account not provisioned",
      detail: "No account is provisioned for this principal yet",
      role: "GUIDE",
    });
    const e = CoreError.fromResponse(404, raw, "application/problem+json");

    expect(e.status).toBe(404);
    expect(e.code).toBe("ACCOUNT_NOT_PROVISIONED");
    expect(e.title).toBe("Account not provisioned");
    expect(e.detail).toBe("No account is provisioned for this principal yet");
    expect(e.properties).toEqual({ role: "GUIDE" });
    // Additive-safety regression guard: body/contentType must still be populated verbatim
    // (the CTL-56 withMutation verbatim-relay path reads these).
    expect(e.body).toBe(raw);
    expect(e.contentType).toBe("application/problem+json");
  });

  it("distinguishes a different coded 404 (PROFILE_NOT_FOUND) — must not be mistaken for ACCOUNT_NOT_PROVISIONED", () => {
    const raw = JSON.stringify({ code: "PROFILE_NOT_FOUND" });
    const e = CoreError.fromResponse(404, raw, "application/json");

    expect(e.code).toBe("PROFILE_NOT_FOUND");
    expect(e.code).not.toBe("ACCOUNT_NOT_PROVISIONED");
  });

  it("does NOT fabricate a code for a non-JSON 404 body (e.g. an HTML error page)", () => {
    const raw = "<html><body>Not Found</body></html>";
    const e = CoreError.fromResponse(404, raw, "text/html");

    expect(e.status).toBe(404);
    expect(e.code).toBeUndefined();
    expect(e.title).toBeUndefined();
    expect(e.detail).toBeUndefined();
    expect(e.properties).toBeUndefined();
    // Verbatim relay fields still populated.
    expect(e.body).toBe(raw);
    expect(e.contentType).toBe("text/html");
  });

  it("does NOT fabricate a code when the content-type is plain text, even if the body happens to be JSON-shaped", () => {
    const raw = JSON.stringify({ code: "SHOULD_NOT_BE_PARSED" });
    const e = CoreError.fromResponse(404, raw, "text/plain");

    expect(e.code).toBeUndefined();
    expect(e.properties).toBeUndefined();
  });

  it("does NOT fabricate a code for unparseable JSON (malformed body with a JSON content-type)", () => {
    const raw = "{not valid json";
    const e = CoreError.fromResponse(404, raw, "application/json");

    expect(e.code).toBeUndefined();
    expect(e.title).toBeUndefined();
    expect(e.detail).toBeUndefined();
    expect(e.properties).toBeUndefined();
    expect(e.body).toBe(raw);
  });

  it("does NOT fabricate a code when JSON parses but carries no code member", () => {
    const raw = JSON.stringify({ title: "Some generic problem" });
    const e = CoreError.fromResponse(500, raw, "application/problem+json");

    expect(e.code).toBeUndefined();
    expect(e.title).toBe("Some generic problem");
  });

  it("carries a 409 conflict's reconciliationRequired extension member through properties", () => {
    const raw = JSON.stringify({
      code: "ROLE_ALREADY_GRANTED",
      title: "Role already granted: GUIDE",
      role: "GUIDE",
      reconciliationRequired: true,
    });
    const e = CoreError.fromResponse(409, raw, "application/problem+json");

    expect(e.status).toBe(409);
    expect(e.code).toBe("ROLE_ALREADY_GRANTED");
    expect(e.properties?.reconciliationRequired).toBe(true);
    expect(e.properties?.role).toBe("GUIDE");
  });

  it("handles the no-body transport-failure case (502) without throwing, all fields undefined", () => {
    const e = CoreError.fromResponse(502);

    expect(e.status).toBe(502);
    expect(e.code).toBeUndefined();
    expect(e.body).toBeUndefined();
    expect(e.contentType).toBeUndefined();
  });

  it("does not crash on non-object JSON (e.g. a bare JSON null body)", () => {
    const e = CoreError.fromResponse(404, "null", "application/json");
    expect(e.code).toBeUndefined();
    expect(e.properties).toBeUndefined();
  });
});
