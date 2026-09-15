import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import {
  createTestJwt,
  createTamperedJwt,
} from "../harness/auth_helper.ts";
import { assertHttpStatus, assertErrorMessage } from "../harness/assertions.ts";

describe("Tier 5: Adversarial — Injection, Tampering & Path Traversal Defenses", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111"; // Alice
  const bobId = "22222222-2222-4222-8222-222222222222"; // Bob
  const chatId = "chat-general-001";

  const aliceToken = createTestJwt({ user_id: aliceId, name: "Alice Smith" });
  const authHeaders = { Authorization: `Bearer ${aliceToken}` };

  it("5.3.1: SQL injection strings in user search are safely handled as literal queries without syntax leaks", () => {
    const payloads = [
      "' OR '1'='1",
      "admin'--",
      "'; DROP TABLE users; --",
      "' UNION SELECT null, null, null--",
    ];

    for (const p of payloads) {
      const encoded = encodeURIComponent(p);
      const res = backend.handleRestRequest("GET", `/api/v1/users/search?q=${encoded}`, null, authHeaders);
      // Either 400 (invalid prefix format) or 200 (literal match 0 users)
      assert.ok(res.status === 400 || res.status === 200, `Status for SQLi '${p}': ${res.status}`);
      if (res.status === 200) {
        assert.equal(res.data.total, 0, "SQL injection string must not match all records");
      }
    }
  });

  it("5.3.2: XSS script payloads in message content are preserved as inert literal strings", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    const bobToken = createTestJwt({ user_id: bobId, name: "Bob Jones" });
    const bobConn = backend.connectSocket(bobToken);

    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => bobConn.on("connect", () => res())),
    ]);

    aliceConn.emit("join_chat", { chatId });
    bobConn.emit("join_chat", { chatId });

    const xssPayload = `<script>alert('XSS')</script><img src="x" onerror="alert(1)">`;
    let receivedContent = "";

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for XSS message")), 1000);
      bobConn.on("new_message", (p: { content: string }) => {
        if (p.content === xssPayload) {
          clearTimeout(timer);
          receivedContent = p.content;
          resolve();
        }
      });

      aliceConn.emit("send_message", {
        chatId,
        content: xssPayload,
        tempId: "xss-01",
      });
    });

    assert.equal(receivedContent, xssPayload, "Content transmitted faithfully without server corruption");
    aliceConn.disconnect();
    bobConn.disconnect();
  });

  it("5.3.3: Cryptographically tampered JWT fails authentication immediately", async () => {
    const tampered = createTamperedJwt({ user_id: aliceId });
    const conn = backend.connectSocket(tampered);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on tampered connect_error")), 500);
      conn.on("connect_error", (err: unknown) => {
        clearTimeout(timer);
        const errObj = err as Error;
        assert.equal(conn.connected, false);
        assert.ok(errObj.message.toLowerCase().includes("invalid"));
        resolve();
      });
      conn.on("connect", () => {
        clearTimeout(timer);
        reject(new Error("Tampered JWT should never connect successfully"));
      });
    });
  });

  it("5.3.4: 'alg: none' unsigned JWT attack is rejected by REST and Socket gateways", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ user_id: aliceId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
    const algNoneToken = `${header}.${payload}.`;

    // REST test
    const res = backend.handleRestRequest(
      "GET",
      "/api/v1/users/search?q=bob",
      null,
      { Authorization: `Bearer ${algNoneToken}` }
    );
    assertHttpStatus(res.status, 401, "alg:none REST");

    // Socket test
    const conn = backend.connectSocket(algNoneToken);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on alg:none connect_error")), 500);
      conn.on("connect_error", () => {
        clearTimeout(timer);
        assert.equal(conn.connected, false);
        resolve();
      });
      conn.on("connect", () => {
        clearTimeout(timer);
        reject(new Error("alg:none token should not connect"));
      });
    });
  });

  it("5.3.5: Path traversal in file download URL is rejected with HTTP 404", () => {
    const res = backend.handleRestRequest(
      "GET",
      "/api/v1/files/../../etc/passwd/download",
      null,
      authHeaders
    );
    assertHttpStatus(res.status, 404, "path traversal download");
    assertErrorMessage(res.data, "not found");
  });
});
