import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";
import { assertHttpStatus, assertErrorMessage } from "../harness/assertions.ts";

describe("Tier 2: Boundaries — Empty and Whitespace Inputs", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111";
  const token = createTestJwt({ user_id: aliceId, name: "Alice" });
  const authHeaders = { Authorization: `Bearer ${token}` };
  const chatId = "chat-general-001";

  it("2.1.1: User discovery rejects empty query string with HTTP 400", () => {
    const res = backend.handleRestRequest("GET", "/api/v1/users/search?q=", null, authHeaders);
    assertHttpStatus(res.status, 400, "empty search query");
    assertErrorMessage(res.data, "must be at least 3 characters");
  });

  it("2.1.2: User discovery rejects whitespace-only query string with HTTP 400", () => {
    const res = backend.handleRestRequest("GET", "/api/v1/users/search?q=%20%20%20", null, authHeaders);
    assertHttpStatus(res.status, 400, "whitespace query");
    assertErrorMessage(res.data, "must be at least 3 characters");
  });

  it("2.1.3: User discovery rejects 1 and 2 character queries with HTTP 400", () => {
    const res1 = backend.handleRestRequest("GET", "/api/v1/users/search?q=a", null, authHeaders);
    assertHttpStatus(res1.status, 400, "1 char query");

    const res2 = backend.handleRestRequest("GET", "/api/v1/users/search?q=al", null, authHeaders);
    assertHttpStatus(res2.status, 400, "2 char query");
  });

  it("2.1.4: Direct chat initiation rejects empty or missing recipient_id with HTTP 400", () => {
    const res1 = backend.handleRestRequest("POST", "/api/v1/chats/direct", { recipient_id: "" }, authHeaders);
    assertHttpStatus(res1.status, 400, "empty recipient_id");
    assertErrorMessage(res1.data, "recipient_id is required");

    const res2 = backend.handleRestRequest("POST", "/api/v1/chats/direct", {}, authHeaders);
    assertHttpStatus(res2.status, 400, "missing recipient_id");
  });

  it("2.1.5: Workspace join rejects empty or whitespace invite code with HTTP 400", () => {
    const res1 = backend.handleRestRequest("POST", "/api/groups/join", { code: "" }, authHeaders);
    assertHttpStatus(res1.status, 400, "empty code");
    assertErrorMessage(res1.data, "invite code is required");

    const res2 = backend.handleRestRequest("POST", "/api/groups/join", { code: "   " }, authHeaders);
    assertHttpStatus(res2.status, 400, "whitespace code");
    assertErrorMessage(res2.data, "invite code is required");
  });

  it("2.1.6: Socket send_message rejects empty content or whitespace-only strings via ACK error", async () => {
    const conn = backend.connectSocket(token);
    await new Promise<void>((res) => conn.on("connect", () => res()));
    conn.emit("join_chat", { chatId });

    // Empty string
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for empty message ACK")), 500);
      conn.emit(
        "send_message",
        { chatId, content: "", tempId: "temp-empty" },
        (ack: { success: boolean; error?: string }) => {
          clearTimeout(timer);
          assert.equal(ack.success, false);
          assert.ok(ack.error?.includes("required"));
          resolve();
        }
      );
    });

    // Whitespace only
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for whitespace message ACK")), 500);
      conn.emit(
        "send_message",
        { chatId, content: "    \n\t   ", tempId: "temp-ws" },
        (ack: { success: boolean; error?: string }) => {
          clearTimeout(timer);
          assert.equal(ack.success, false);
          assert.ok(ack.error?.includes("required"));
          resolve();
        }
      );
    });

    conn.disconnect();
  });

  it("2.1.7: Socket edit_message rejects empty content via ACK error", async () => {
    const conn = backend.connectSocket(token);
    await new Promise<void>((res) => conn.on("connect", () => res()));
    conn.emit("join_chat", { chatId });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for edit_message ACK")), 500);
      conn.emit(
        "edit_message",
        { messageId: "msg-001", chatId, content: "  " },
        (ack: { success: boolean; error?: string }) => {
          clearTimeout(timer);
          assert.equal(ack.success, false);
          assert.ok(ack.error?.includes("required"));
          conn.disconnect();
          resolve();
        }
      );
    });
  });

  it("2.1.8: Socket send_thread_reply rejects empty content via ACK error", async () => {
    const conn = backend.connectSocket(token);
    await new Promise<void>((res) => conn.on("connect", () => res()));
    conn.emit("join_chat", { chatId });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for thread_reply ACK")), 500);
      conn.emit(
        "send_thread_reply",
        { parentMessageId: "msg-001", chatId, content: "" },
        (ack: { success: boolean; error?: string }) => {
          clearTimeout(timer);
          assert.equal(ack.success, false);
          assert.ok(ack.error?.includes("required"));
          conn.disconnect();
          resolve();
        }
      );
    });
  });
});
