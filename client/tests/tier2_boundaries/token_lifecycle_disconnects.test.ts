import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import {
  createTestJwt,
  createExpiredJwt,
  createMalformedJwt,
} from "../harness/auth_helper.ts";
import { assertHttpStatus, assertErrorMessage } from "../harness/assertions.ts";

describe("Tier 2: Boundaries — Token Lifecycle and Socket Disconnections", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111";
  const bobId = "22222222-2222-4222-8222-222222222222";
  const chatId = "chat-general-001";

  it("2.3.1: Expired token in REST Authorization header returns HTTP 401", () => {
    const expiredToken = createExpiredJwt({ user_id: aliceId });
    const res = backend.handleRestRequest(
      "GET",
      "/api/v1/users/search?q=bob",
      null,
      { Authorization: `Bearer ${expiredToken}` }
    );
    assertHttpStatus(res.status, 401, "expired token REST");
    assertErrorMessage(res.data, "expired");
  });

  it("2.3.2: Malformed token in REST Authorization header returns HTTP 401", () => {
    const malformed = createMalformedJwt();
    const res = backend.handleRestRequest(
      "GET",
      "/api/v1/users/search?q=bob",
      null,
      { Authorization: `Bearer ${malformed}` }
    );
    assertHttpStatus(res.status, 401, "malformed token REST");
  });

  it("2.3.3: Missing Authorization header in REST returns HTTP 401 unauthorized", () => {
    const res = backend.handleRestRequest("GET", "/api/v1/users/search?q=bob", null, {});
    assertHttpStatus(res.status, 401, "missing auth REST");
    assertErrorMessage(res.data, "unauthorized");
  });

  it("2.3.4: Socket connect with expired token fires connect_error", async () => {
    const expiredToken = createExpiredJwt({ user_id: aliceId });
    const conn = backend.connectSocket(expiredToken);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for connect_error")), 500);
      conn.on("connect_error", (err: unknown) => {
        clearTimeout(timer);
        const errObj = err as Error;
        assert.equal(conn.connected, false);
        assert.ok(errObj.message.includes("expired"));
        resolve();
      });
      conn.on("connect", () => {
        clearTimeout(timer);
        reject(new Error("Should not connect with expired token"));
      });
    });
  });

  it("2.3.5: Clean socket disconnect removes client from room and sets connected to false", async () => {
    const token = createTestJwt({ user_id: aliceId, name: "Alice" });
    const conn = backend.connectSocket(token);
    await new Promise<void>((res) => conn.on("connect", () => res()));

    conn.emit("join_chat", { chatId });
    assert.ok(conn.joinedRooms.has(chatId), "Alice should be in chatId");
    assert.ok(backend.activeRooms.get(chatId)?.has(conn.id), "Backend activeRooms should contain socket id");

    conn.disconnect();
    assert.equal(conn.connected, false, "Socket state should be disconnected");
    assert.equal(conn.joinedRooms.size, 0, "Socket joined rooms should be empty");
    assert.equal(backend.activeRooms.get(chatId)?.has(conn.id), false, "Active rooms must not have socket id");
  });

  it("2.3.6: Socket disconnect triggers user_left broadcast to room members", async () => {
    const aliceToken = createTestJwt({ user_id: aliceId, name: "Alice" });
    const bobToken = createTestJwt({ user_id: bobId, name: "Bob" });

    const bobConn = backend.connectSocket(bobToken);
    await new Promise<void>((res) => bobConn.on("connect", () => res()));
    bobConn.emit("join_chat", { chatId });

    const aliceConn = backend.connectSocket(aliceToken);
    await new Promise<void>((res) => aliceConn.on("connect", () => res()));
    aliceConn.emit("join_chat", { chatId });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for user_left")), 1000);
      bobConn.on("user_left", (payload: { userId: string; chatId: string }) => {
        if (payload.userId === aliceId) {
          clearTimeout(timer);
          assert.equal(payload.chatId, chatId);
          bobConn.disconnect();
          resolve();
        }
      });
      aliceConn.disconnect();
    });
  });

  it("2.3.7: Multiple disconnect calls are idempotent and do not throw", async () => {
    const token = createTestJwt({ user_id: aliceId, name: "Alice" });
    const conn = backend.connectSocket(token);
    await new Promise<void>((res) => conn.on("connect", () => res()));

    assert.doesNotThrow(() => {
      conn.disconnect();
      conn.disconnect();
      conn.disconnect();
    });
    assert.equal(conn.connected, false);
  });

  it("2.3.8: Emitting events on a disconnected socket invokes ACK callback with error", async () => {
    const token = createTestJwt({ user_id: aliceId, name: "Alice" });
    const conn = backend.connectSocket(token);
    await new Promise<void>((res) => conn.on("connect", () => res()));
    conn.disconnect();

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for disconnected ACK")), 500);
      conn.emit(
        "send_message",
        { chatId, content: "Should fail" },
        (ack: { error?: string }) => {
          clearTimeout(timer);
          assert.ok(ack.error?.includes("not connected"), `Expected not connected error, got ${ack.error}`);
          resolve();
        }
      );
    });
  });

  it("2.3.9: Reconnecting with a refreshed valid token creates a new distinct session", async () => {
    const initialToken = createTestJwt({ user_id: aliceId, name: "Alice" });
    const conn1 = backend.connectSocket(initialToken);
    await new Promise<void>((res) => conn1.on("connect", () => res()));
    const sid1 = conn1.id;
    conn1.disconnect();

    const refreshedToken = createTestJwt({ user_id: aliceId, name: "Alice" });
    const conn2 = backend.connectSocket(refreshedToken);
    await new Promise<void>((res) => conn2.on("connect", () => res()));
    const sid2 = conn2.id;

    assert.ok(conn2.connected, "Reconnection should succeed");
    assert.notEqual(sid1, sid2, "Reconnected socket must receive a new distinct socket ID");
    conn2.disconnect();
  });
});
