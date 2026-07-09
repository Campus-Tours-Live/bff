import { CoreError } from "@/api/_shared/errors.js";

describe("CoreError", () => {
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
