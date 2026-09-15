import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";

describe("Tier 5: Adversarial — Malformed Payloads & Event Fuzzing", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111";
  const token = createTestJwt({ user_id: aliceId, name: "Alice Smith" });
  const chatId = "chat-general-001";

  it("5.1.1: Emitting null or empty payload to socket events does not crash the gateway", async () => {
    const conn = backend.connectSocket(token);
    await new Promise<void>((res) => conn.on("connect", () => res()));

    assert.doesNotThrow(() => {
      conn.emit("join_chat", null);
      conn.emit("send_message", null);
      conn.emit("edit_message", null);
      conn.emit("delete_message", null);
      conn.emit("react_message", null);
      conn.emit("send_thread_reply", null);
      conn.emit("typing_start", null);
      conn.emit("typing_stop", null);
      conn.emit("get_online_users", null);
    });

    conn.disconnect();
  });

  it("5.1.2: send_message with non-string or missing content returns ACK failure", async () => {
    const conn = backend.connectSocket(token);
    await new Promise<void>((res) => conn.on("connect", () => res()));
    conn.emit("join_chat", { chatId });

    // Missing content
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for ACK")), 500);
      conn.emit(
        "send_message",
        { chatId },
        (ack: { success: boolean; error?: string }) => {
          clearTimeout(timer);
          assert.equal(ack.success, false);
          resolve();
        }
      );
    });

    // Object instead of string
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for ACK")), 500);
      conn.emit(
        "send_message",
        { chatId, content: { evil: true } as unknown as string },
        (ack: { success: boolean; error?: string }) => {
          clearTimeout(timer);
          assert.equal(ack.success, false);
          resolve();
        }
      );
    });

    conn.disconnect();
  });

  it("5.1.3: edit_message with missing required fields returns ACK failure", async () => {
    const conn = backend.connectSocket(token);
    await new Promise<void>((res) => conn.on("connect", () => res()));

    // Missing messageId
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on edit")), 500);
      conn.emit(
        "edit_message",
        { chatId, content: "New text" },
        (ack: { success: boolean; error?: string }) => {
          clearTimeout(timer);
          assert.equal(ack.success, false);
          resolve();
        }
      );
    });

    // Missing chatId
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on edit")), 500);
      conn.emit(
        "edit_message",
        { messageId: "msg-01", content: "New text" },
        (ack: { success: boolean; error?: string }) => {
          clearTimeout(timer);
          assert.equal(ack.success, false);
          resolve();
        }
      );
    });

    conn.disconnect();
  });

  it("5.1.4: react_message with missing emoji or empty emoji returns ACK failure", async () => {
    const conn = backend.connectSocket(token);
    await new Promise<void>((res) => conn.on("connect", () => res()));

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on react")), 500);
      conn.emit(
        "react_message",
        { messageId: "msg-01", chatId, emoji: "" },
        (ack: { success: boolean; error?: string }) => {
          clearTimeout(timer);
          assert.equal(ack.success, false);
          resolve();
        }
      );
    });

    conn.disconnect();
  });

  it("5.1.5: Completely unknown event names are safely ignored without crashing connection", async () => {
    const conn = backend.connectSocket(token);
    await new Promise<void>((res) => conn.on("connect", () => res()));

    assert.doesNotThrow(() => {
      conn.emit("UNKNOWN_DUMMY_EVENT", { foo: "bar" });
      conn.emit("__proto__", { pollution: true });
      conn.emit("constructor", { exploit: true });
    });

    assert.equal(conn.connected, true, "Socket should remain connected after invalid event names");
    conn.disconnect();
  });
});
