import { describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { AuthError, decodeToken } from "./auth";
import { config } from "./config";

function b64url(data: Uint8Array | string): string {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return Buffer.from(buf).toString("base64url");
}

async function makeToken(opts: {
  sub?: string;
  secret?: string;
  audience?: string;
  alg?: "HS256" | "HS512";
} = {}): Promise<string> {
  const { sub = "user-123", secret = config.supabaseJwtSecret, audience = "authenticated", alg = "HS256" } = opts;
  return new SignJWT({ sub, aud: audience })
    .setProtectedHeader({ alg })
    .sign(new TextEncoder().encode(secret));
}

describe("decodeToken", () => {
  it("accepts a valid HS256 token", async () => {
    const token = await makeToken();
    expect(await decodeToken(token)).toBe("user-123");
  });

  it("rejects a bad signature", async () => {
    const token = await makeToken({ secret: "wrong-secret" });
    await expect(decodeToken(token)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects the wrong audience", async () => {
    const token = await makeToken({ audience: "not-authenticated" });
    await expect(decodeToken(token)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a token missing sub", async () => {
    const token = await new SignJWT({ aud: "authenticated" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode(config.supabaseJwtSecret));
    await expect(decodeToken(token)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects garbage", async () => {
    await expect(decodeToken("not-a-jwt")).rejects.toBeInstanceOf(AuthError);
  });

  it("verifies ES256 via JWKS", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "test-key-1";
    jwk.alg = "ES256";
    jwk.use = "sig";

    const token = await new SignJWT({ sub: "es256-user", aud: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key-1" })
      .sign(privateKey);

    // decodeToken's ES256/RS256 path fetches SUPABASE_URL's JWKS endpoint
    // via createRemoteJWKSet; stub global fetch to serve our test key so the
    // real decodeToken code path (allowlist + JWKS + audience check) runs.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    try {
      expect(await decodeToken(token)).toBe("es256-user");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects ES256 signed with an unrelated key", async () => {
    const { privateKey } = await generateKeyPair("ES256");
    const { publicKey: otherPublicKey } = await generateKeyPair("ES256");
    const jwk = await exportJWK(otherPublicKey);
    jwk.kid = "test-key-2";
    jwk.alg = "ES256";
    jwk.use = "sig";

    const token = await new SignJWT({ sub: "es256-user", aud: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key-2" })
      .sign(privateKey);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    try {
      await expect(decodeToken(token)).rejects.toBeInstanceOf(AuthError);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects alg:none (JWT confusion attack)", async () => {
    const header = b64url('{"alg":"none","typ":"JWT"}');
    const payload = b64url('{"sub":"attacker","aud":"authenticated"}');
    const token = `${header}.${payload}.`;
    await expect(decodeToken(token)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects HS512 even if the secret matches (not on the allowlist)", async () => {
    const token = await makeToken({ alg: "HS512" });
    await expect(decodeToken(token)).rejects.toBeInstanceOf(AuthError);
  });
});
