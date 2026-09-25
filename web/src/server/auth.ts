import "server-only";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import { config } from "./config";
import { ApiError } from "./errors";

export class AuthError extends ApiError {
  constructor(message = "invalid token") {
    super(401, "unauthorized", message);
  }
}

const ALLOWED_ALGS = ["HS256", "ES256", "RS256"] as const;

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Lazily built, process-wide cached JWKS set (jose caches keys internally
 * too), so a JWKS fetch happens at most once per key rotation, not per
 * request. */
function getJwks() {
  if (_jwks === null) {
    _jwks = createRemoteJWKSet(
      new URL(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`),
    );
  }
  return _jwks;
}

/** Decode a Supabase-issued JWT and return the user_id (sub claim). HS256
 * (legacy shared-secret projects) verifies against SUPABASE_JWT_SECRET
 * directly. ES256/RS256 (new Supabase projects' asymmetric signing keys)
 * verify via the project's JWKS endpoint. Algorithm is allowlisted rather
 * than trusted from the untrusted token header (classic JWT confusion
 * attack surface, e.g. "none" or an unexpected alg). */
export async function decodeToken(token: string): Promise<string> {
  let alg: string | undefined;
  try {
    ({ alg } = decodeProtectedHeader(token));
  } catch (e) {
    throw new AuthError(e instanceof Error ? e.message : "malformed token");
  }
  if (!alg || !(ALLOWED_ALGS as readonly string[]).includes(alg)) {
    throw new AuthError(`unsupported algorithm: ${alg}`);
  }

  try {
    let payload;
    if (alg === "HS256") {
      const secret = new TextEncoder().encode(config.supabaseJwtSecret);
      ({ payload } = await jwtVerify(token, secret, {
        algorithms: ["HS256"],
        audience: "authenticated",
      }));
    } else {
      ({ payload } = await jwtVerify(token, getJwks(), {
        algorithms: [alg as "ES256" | "RS256"],
        audience: "authenticated",
      }));
    }
    const sub = payload.sub;
    if (!sub) throw new AuthError("missing sub claim");
    return sub;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError(e instanceof Error ? e.message : "invalid token");
  }
}

export async function requireUser(req: Request): Promise<string> {
  const authorization = req.headers.get("authorization");
  if (!authorization || !authorization.toLowerCase().startsWith("bearer ")) {
    throw new AuthError("missing bearer token");
  }
  const token = authorization.slice(authorization.indexOf(" ") + 1);
  return decodeToken(token);
}
