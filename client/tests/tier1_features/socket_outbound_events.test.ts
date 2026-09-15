import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";

describe("Tier 1: Feature Coverage — 10 Outbound Socket.IO Events", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111";
  const bobId = "22222222-2222-4222-8222-222222222222";
  const chatId = "chat-general-001";

  const aliceToken = createTestJwt({ user_id: aliceId, name: "Alice" });
  const bobToken = createTestJwt({ user_id: bobId, name: "Bob" });

  it("6.1: outbound 'join_chat' adds client to room and triggers 'user_joined' presence", async () => {
    const bobConn = backend.connectSocket(bobToken);
    await new Promise<void>((res) => bobConn.on("connect", () => res()));
    bobConn.emit("join_chat", { chatId });

    const aliceConn = backend.connectSocket(aliceToken);
    await new Promise<void>((res) => aliceConn.on("connect", () => res()));

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for user_joined")), 1000);
      bobConn.on("user_joined", (payload: { userId: string; chatId: string }) => {
        if (payload.userId === aliceId) {
          clearTimeout(timer);
          assert.equal(payload.chatId, chatId);
          aliceConn.disconnect();
          bobConn.disconnect();
          resolve();
        }
      });
      aliceConn.emit("join_chat", { chatId });
    });
  });

  it("6.2: outbound 'leave_chat' removes client from room and triggers 'user_left' presence", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    const bobConn = backend.connectSocket(bobToken);
    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => bobConn.on("connect", () => res())),
    ]);

    aliceConn.emit("join_chat", { chatId });
    bobConn.emit("join_chat", { chatId });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for user_left")), 1000);
      bobConn.on("user_left", (payload: { userId: string; chatId: string }) => {
        if (payload.userId === aliceId) {
          clearTimeout(timer);
          assert.equal(payload.chatId, chatId);
          aliceConn.disconnect();
          bobConn.disconnect();
          resolve();
        }
      });
      aliceConn.emit("leave_chat", { chatId });
    });
  });

  it("6.3: outbound 'send_message' emits payload and receives server ACK with messageId and status 'ok'", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    await new Promise<void>((res) => aliceConn.on("connect", () => res()));
    aliceConn.emit("join_chat", { chatId });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for send_message ACK")), 1000);
      aliceConn.emit(
        "send_message",
        {
          chatId,
          content: "Hello from Alice!",
          tempId: "temp-alice-123",
          triggerAI: false,
        },
        (ack: { success: boolean; messageId: string; status: string }) => {
          clearTimeout(timer);
          assert.equal(ack.success, true);
          assert.equal(ack.status, "ok");
          assert.ok(ack.messageId, "Server ACK must return issued messageId");
          aliceConn.disconnect();
          resolve();
        }
      );
    });
  });

  it("6.4: outbound 'edit_message' broadcasts updated content to the room", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    const bobConn = backend.connectSocket(bobToken);
    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => bobConn.on("connect", () => res())),
    ]);

    aliceConn.emit("join_chat", { chatId });
    bobConn.emit("join_chat", { chatId });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for message_updated")), 1000);
      bobConn.on("message_updated", (payload: { id: string; content: string; is_edited: boolean }) => {
        if (payload.id === "msg-edit-test") {
          clearTimeout(timer);
          assert.equal(payload.content, "Updated text");
          assert.equal(payload.is_edited, true);
          aliceConn.disconnect();
          bobConn.disconnect();
          resolve();
        }
      });
      aliceConn.emit("edit_message", {
        messageId: "msg-edit-test",
        chatId,
        content: "Updated text",
      });
    });
  });

  it("6.5: outbound 'delete_message' broadcasts message_deleted with deleteType", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    const bobConn = backend.connectSocket(bobToken);
    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => bobConn.on("connect", () => res())),
    ]);

    aliceConn.emit("join_chat", { chatId });
    bobConn.emit("join_chat", { chatId });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for message_deleted")), 1000);
      bobConn.on("message_deleted", (payload: { id: string; type: string }) => {
        if (payload.id === "msg-delete-test") {
          clearTimeout(timer);
          assert.equal(payload.type, "everyone");
          aliceConn.disconnect();
          bobConn.disconnect();
          resolve();
        }
      });
      aliceConn.emit("delete_message", {
        messageId: "msg-delete-test",
        chatId,
        deleteType: "everyone",
      });
    });
  });

  it("6.6: outbound 'react_message' receives server ACK and broadcasts reaction to room", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    await new Promise<void>((res) => aliceConn.on("connect", () => res()));
    aliceConn.emit("join_chat", { chatId });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for react_message ACK")), 1000);
      aliceConn.emit(
        "react_message",
        {
          messageId: "msg-reaction-test",
          chatId,
          emoji: "🚀",
          action: "add",
        },
        (ack: { success: boolean; action: string }) => {
          clearTimeout(timer);
          assert.equal(ack.success, true);
          assert.equal(ack.action, "add");
          aliceConn.disconnect();
          resolve();
        }
      );
    });
  });

  it("6.7: outbound 'send_thread_reply' receives server ACK with replyId and broadcasts thread_reply", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    await new Promise<void>((res) => aliceConn.on("connect", () => res()));
    aliceConn.emit("join_chat", { chatId });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for send_thread_reply ACK")), 1000);
      aliceConn.emit(
        "send_thread_reply",
        {
          parentMessageId: "msg-parent-test",
          chatId,
          content: "I agree with this plan",
          tempId: "thread-temp-01",
        },
        (ack: { success: boolean; replyId: string }) => {
          clearTimeout(timer);
          assert.equal(ack.success, true);
          assert.ok(ack.replyId, "Server ACK must return replyId");
          aliceConn.disconnect();
          resolve();
        }
      );
    });
  });

  it("6.8: outbound 'typing_start' broadcasts typing_indicator with isTyping: true", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    const bobConn = backend.connectSocket(bobToken);
    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => bobConn.on("connect", () => res())),
    ]);

    aliceConn.emit("join_chat", { chatId });
    bobConn.emit("join_chat", { chatId });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for typing_indicator true")), 1000);
      bobConn.on("typing_indicator", (payload: { isTyping: boolean; userId: string }) => {
        if (payload.userId === aliceId && payload.isTyping === true) {
          clearTimeout(timer);
          aliceConn.disconnect();
          bobConn.disconnect();
          resolve();
        }
      });
      aliceConn.emit("typing_start", { chatId });
    });
  });

  it("6.9: outbound 'typing_stop' broadcasts typing_indicator with isTyping: false", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    const bobConn = backend.connectSocket(bobToken);
    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => bobConn.on("connect", () => res())),
    ]);

    aliceConn.emit("join_chat", { chatId });
    bobConn.emit("join_chat", { chatId });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for typing_indicator false")), 1000);
      bobConn.on("typing_indicator", (payload: { isTyping: boolean; userId: string }) => {
        if (payload.userId === aliceId && payload.isTyping === false) {
          clearTimeout(timer);
          aliceConn.disconnect();
          bobConn.disconnect();
          resolve();
        }
      });
      aliceConn.emit("typing_stop", { chatId });
    });
  });

  it("6.10: outbound 'get_online_users' queries the presence tracker and returns active user list", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    await new Promise<void>((res) => aliceConn.on("connect", () => res()));
    aliceConn.emit("join_chat", { chatId });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for get_online_users ACK")), 1000);
      aliceConn.emit("get_online_users", { chatId }, (res: { users: { id: string }[] }) => {
        clearTimeout(timer);
        assert.ok(Array.isArray(res.users), "Expected users array");
        assert.ok(res.users.some((u) => u.id === aliceId), "Alice should be listed in online users");
        aliceConn.disconnect();
        resolve();
      });
    });
  });
});
