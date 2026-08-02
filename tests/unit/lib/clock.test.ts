import { clock } from "@/lib/clock.js";

describe("clock", () => {
  it("the default implementation returns the real current time (Date.now)", () => {
    const before = Date.now();
    const value = clock.now();
    const after = Date.now();

    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });

  it("is a mutable singleton — tests can pin `now` to a fixed value", () => {
    const original = clock.now;
    try {
      clock.now = () => 42;
      expect(clock.now()).toBe(42);
    } finally {
      clock.now = original;
    }
    // Restored — back to reading the real clock.
    expect(clock.now()).toBeGreaterThan(42);
  });
});
