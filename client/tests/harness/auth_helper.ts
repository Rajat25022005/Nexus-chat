import crypto from "node:crypto";

export const DEFAULT_JWT_SECRET = "supersecret-dev-key";

export interface JwtClaims {
  user_id?: string;
  sub?: string;
  email?: string;
  name?: string;
  role?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

/**
 * Creates a standard HS256 JWT string.
 */
export function createTestJwt(
  claims: JwtClaims = {},
  secret: string = DEFAULT_JWT_SECRET,
  expiresInSeconds: number = 3600
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);

  const payload: JwtClaims = {
    user_id: claims.user_id || claims.sub || "usr-" + crypto.randomUUID(),
    email: claims.email || "test.user@nexus.internal",
    name: claims.name || "Test User",
    role: claims.role || "user",
    iat: claims.iat ?? now,
    exp: claims.exp ?? now + expiresInSeconds,
    ...claims,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Creates a JWT that has expired 1 hour ago.
 */
export function createExpiredJwt(
  claims: JwtClaims = {},
  secret: string = DEFAULT_JWT_SECRET
): string {
  const now = Math.floor(Date.now() / 1000);
  return createTestJwt(
    {
      ...claims,
      iat: now - 7200,
      exp: now - 3600,
    },
    secret,
    -3600
  );
}

/**
 * Creates a JWT with an invalid/tampered cryptographic signature.
 */
export function createTamperedJwt(claims: JwtClaims = {}): string {
  const validToken = createTestJwt(claims, DEFAULT_JWT_SECRET);
  const parts = validToken.split(".");
  // Corrupt the signature segment
  const badSig = "INVALID" + parts[2].slice(7);
  return `${parts[0]}.${parts[1]}.${badSig}`;
}

/**
 * Creates an invalid token string with invalid segment count.
 */
export function createMalformedJwt(): string {
  return "not-a-valid-jwt-token";
}

/**
 * Creates a token containing CRLF injection characters.
 */
export function createCrlfInjectedJwt(): string {
  return "validheader.validpayload.validsig\r\nInjected-Header: evil";
}

/**
 * Decodes a token safely without verification.
 */
export function decodeTestJwt(token: string): { header: Record<string, unknown>; payload: JwtClaims } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return { header, payload };
  } catch {
    return null;
  }
}

/**
 * Cryptographically verifies HS256 signature and returns claims or null.
 */
export function verifyTestJwt(
  token: string,
  secret: string = DEFAULT_JWT_SECRET
): { header: Record<string, unknown>; payload: JwtClaims } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest("base64url");
    if (parts[2] !== expectedSig) {
      return null;
    }
    return decodeTestJwt(token);
  } catch {
    return null;
  }
}
