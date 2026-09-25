import base64

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app import auth
from app.auth import AuthError, decode_token
from app.config import settings


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_token(sub="user-123", secret=None, audience="authenticated"):
    return jwt.encode({"sub": sub, "aud": audience}, secret or settings.supabase_jwt_secret, algorithm="HS256")


def test_decode_token_accepts_valid_token():
    token = make_token()
    assert decode_token(token) == "user-123"


def test_decode_token_rejects_bad_signature():
    token = make_token(secret="wrong-secret")
    with pytest.raises(AuthError):
        decode_token(token)


def test_decode_token_rejects_wrong_audience():
    token = make_token(audience="not-authenticated")
    with pytest.raises(AuthError):
        decode_token(token)


def test_decode_token_rejects_missing_sub():
    token = jwt.encode({"aud": "authenticated"}, settings.supabase_jwt_secret, algorithm="HS256")
    with pytest.raises(AuthError):
        decode_token(token)


def test_decode_token_rejects_garbage():
    with pytest.raises(AuthError):
        decode_token("not-a-jwt")


class _FakeSigningKey:
    def __init__(self, key):
        self.key = key


def test_decode_token_verifies_es256_via_jwks(monkeypatch):
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()

    token = jwt.encode(
        {"sub": "es256-user", "aud": "authenticated"},
        private_key,
        algorithm="ES256",
        headers={"kid": "test-key-1"},
    )

    class _FakeJWKSClient:
        def get_signing_key_from_jwt(self, tok):
            assert tok == token
            return _FakeSigningKey(public_key)

    monkeypatch.setattr(auth, "_get_jwks_client", lambda: _FakeJWKSClient())
    assert decode_token(token) == "es256-user"


def test_decode_token_rejects_alg_none():
    # {"alg":"none"} header with no signature — the classic JWT confusion attack.
    header = _b64url(b'{"alg":"none","typ":"JWT"}')
    payload = _b64url(b'{"sub":"attacker","aud":"authenticated"}')
    token = f"{header}.{payload}."
    with pytest.raises(AuthError):
        decode_token(token)


def test_decode_token_rejects_hs512_even_if_secret_matches():
    # Not on the allowlist (only HS256, ES256, RS256), regardless of validity.
    token = jwt.encode(
        {"sub": "user-123", "aud": "authenticated"}, settings.supabase_jwt_secret, algorithm="HS512"
    )
    with pytest.raises(AuthError):
        decode_token(token)


def test_decode_token_rejects_es256_with_wrong_key(monkeypatch):
    private_key = ec.generate_private_key(ec.SECP256R1())
    other_private_key = ec.generate_private_key(ec.SECP256R1())

    token = jwt.encode(
        {"sub": "es256-user", "aud": "authenticated"}, private_key, algorithm="ES256"
    )

    class _FakeJWKSClient:
        def get_signing_key_from_jwt(self, tok):
            return _FakeSigningKey(other_private_key.public_key())

    monkeypatch.setattr(auth, "_get_jwks_client", lambda: _FakeJWKSClient())
    with pytest.raises(AuthError):
        decode_token(token)
