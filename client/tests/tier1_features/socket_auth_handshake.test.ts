import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import {
  createTestJwt,
  createExpiredJwt,
  createTamperedJwt,
  createCrlfInjectedJwt,
} from "../harness/auth_helper.ts";
import { sanitizeToken, isTokenExpired, isValidTokenFormat } from "../../src/lib/token.ts";

describe("Tier 1: Feature Coverage — Socket.IO v4 Auth Handshake & JWT Gateway", () => {
  const backend = new MockNexusBackend();
  const userId = "11111111-1111-4111-8111-111111111111";

  it("5.1: Socket connection handshake succeeds when valid HS256 JWT is provided in auth", async () => {
    const validToken = createTestJwt({ user_id: userId, name: "Alice Smith" });
    const conn = backend.connectSocket(validToken);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for connect")), 500);
      conn.on("connect", (data: unknown) => {
        clearTimeout(timer);
        const p = data as { sid: string };
        assert.ok(conn.connected, "Socket should be connected");
        assert.ok(p.sid, "Server should assign a socket id");
        assert.equal(conn.user?.id, userId);
        conn.disconnect();
        resolve();
      });
      conn.on("connect_error", (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  });

  it("5.2: Socket connection handshake fails with connect_error when token is missing (null/empty)", async () => {
    const conn = backend.connectSocket(null);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for connect_error")), 500);
      conn.on("connect", () => {
        clearTimeout(timer);
        reject(new Error("Connection should not have succeeded without token"));
      });
      conn.on("connect_error", (err: unknown) => {
        clearTimeout(timer);
        const errorObj = err as Error;
        assert.equal(conn.connected, false);
        assert.ok(errorObj.message.includes("token required"), `Expected error about missing token, got: ${errorObj.message}`);
        resolve();
      });
    });
  });

  it("5.3: Socket connection handshake fails with connect_error when JWT is expired", async () => {
    const expiredToken = createExpiredJwt({ user_id: userId });
    assert.equal(isTokenExpired(expiredToken), true, "Helper should report token expired");

    const conn = backend.connectSocket(expiredToken);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for connect_error")), 500);
      conn.on("connect", () => {
        clearTimeout(timer);
        reject(new Error("Connection should not have succeeded with expired token"));
      });
      conn.on("connect_error", (err: unknown) => {
        clearTimeout(timer);
        const errorObj = err as Error;
        assert.equal(conn.connected, false);
        assert.ok(errorObj.message.includes("expired"), `Expected error about expired token, got: ${errorObj.message}`);
        resolve();
      });
    });
  });

  it("5.4: Socket connection handshake fails with connect_error when token is tampered/corrupted", async () => {
    const tampered = createTamperedJwt({ user_id: userId });
    const conn = backend.connectSocket(tampered);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for connect_error")), 500);
      conn.on("connect_error", (err: unknown) => {
        clearTimeout(timer);
        const errorObj = err as Error;
        assert.equal(conn.connected, false);
        assert.ok(errorObj.message.includes("Invalid"), `Expected error about invalid token, got: ${errorObj.message}`);
        resolve();
      });
    });
  });

  it("5.5: Token sanitizer rejects CRLF injection before socket auth handshake begins", () => {
    const crlfToken = createCrlfInjectedJwt();
    assert.equal(isValidTokenFormat(crlfToken), false, "CRLF token format must be invalid");
    assert.equal(sanitizeToken(crlfToken), null, "sanitizeToken must return null for injection attempts");
  });
});
