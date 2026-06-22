/** Core returned 401 → session no longer valid; caller must re-auth (Auth-Required). */
export class CoreAuthError extends Error {
  constructor() {
    super("Core authentication required");
    this.name = "CoreAuthError";
  }
}

/** Core returned a non-2xx (other than 401) or was unreachable. */
export class CoreError extends Error {
  constructor(public readonly status: number) {
    super(`Core error ${status}`);
    this.name = "CoreError";
  }
}
