/** Core returned 401 → session no longer valid; caller must re-auth (Auth-Required). */
export class CoreAuthError extends Error {
  constructor() {
    super("Core authentication required");
    this.name = "CoreAuthError";
  }
}

/** Core returned a non-2xx (other than 401) or was unreachable. Carries the raw body for
 *  verbatim relay on mutations (reads ignore it). */
export class CoreError extends Error {
  constructor(
    public readonly status: number,
    public readonly body?: string,
    public readonly contentType?: string,
  ) {
    super(`Core error ${status}`);
    this.name = "CoreError";
  }
}
