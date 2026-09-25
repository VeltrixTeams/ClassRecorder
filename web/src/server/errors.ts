import "server-only";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function apiError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function notFound(what = "resource"): ApiError {
  return new ApiError(404, "not_found", `${what} not found`);
}

/** Wraps a route handler: thrown ApiError (or AuthError, which extends it)
 * becomes `{error:{code,message}}` with the right status; anything else is a
 * 500 `internal_error`. */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof ApiError) {
        return apiError(e.status, e.code, e.message);
      }
      console.error(e);
      return apiError(500, "internal_error", "internal error");
    }
  };
}
