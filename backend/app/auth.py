import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient

from app.config import settings


class AuthError(HTTPException):
    def __init__(self, message: str = "invalid token"):
        super().__init__(status_code=401, detail={"error": {"code": "unauthorized", "message": message}})


_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    """Lazily built, process-wide cached JWKS client (PyJWKClient caches keys
    internally too), so a JWKS fetch happens at most once per key rotation,
    not per request."""
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(f"{settings.supabase_url}/auth/v1/.well-known/jwks.json", cache_keys=True)
    return _jwks_client


def decode_token(token: str) -> str:
    """Decode a Supabase-issued JWT and return the user_id (sub claim).
    HS256 (legacy shared-secret projects) verifies against
    SUPABASE_JWT_SECRET directly. Any other algorithm (new Supabase projects
    default to ES256/RS256 asymmetric signing keys) verifies via the
    project's JWKS endpoint.
    """
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as e:
        raise AuthError(str(e)) from e

    alg = header.get("alg", "HS256")
    try:
        # Allowlist explicitly rather than trusting `alg` from the untrusted
        # token header for algorithm/key selection (classic JWT confusion
        # attack surface, e.g. "none" or an unexpected alg).
        if alg == "HS256":
            payload = jwt.decode(
                token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated"
            )
        elif alg in ("ES256", "RS256"):
            signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
            payload = jwt.decode(token, signing_key.key, algorithms=[alg], audience="authenticated")
        else:
            raise AuthError(f"unsupported algorithm: {alg}")
    except jwt.PyJWTError as e:
        raise AuthError(str(e)) from e
    sub = payload.get("sub")
    if not sub:
        raise AuthError("missing sub claim")
    return sub


async def current_user(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthError("missing bearer token")
    token = authorization.split(" ", 1)[1]
    return decode_token(token)
