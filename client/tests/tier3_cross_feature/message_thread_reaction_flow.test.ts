import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";

describe("Tier 3: Cross-Feature — Message, Thread Replies, Reactions & Mutation Lifecycles", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111"; // Alice
  const bobId = "22222222-2222-4222-8222-222222222222"; // Bob
  const chatId = "chat-general-001";

  const aliceToken = createTestJwt({ user_id: aliceId, name: "Alice Smith" });
  const bobToken = createTestJwt({ user_id: bobId, name: "Bob Jones" });

  it("3.3: Complete lifecycle: Send Message -> Typing -> Thread Reply -> Reactions -> Edit -> Delete", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    const bobConn = backend.connectSocket(bobToken);

    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => bobConn.on("connect", () => res())),
    ]);

    aliceConn.emit("join_chat", { chatId });
    bobConn.emit("join_chat", { chatId });

    // 1. Bob sends initial announcement message
    let rootMessageId = "";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for Bob message")), 1000);
      aliceConn.on("new_message", (payload: { id: string; content: string }) => {
        if (payload.content === "Sprint Planning @ 10:00 AM") {
          clearTimeout(timer);
          rootMessageId = payload.id;
          resolve();
        }
      });

      bobConn.emit(
        "send_message",
        {
          chatId,
          content: "Sprint Planning @ 10:00 AM",
          tempId: "bob-msg-01",
        },
        (ack: { success: boolean; messageId: string }) => {
          assert.equal(ack.success, true);
        }
      );
    });

    // 2. Alice starts typing; Bob observes typing indicator
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on typing_start")), 1000);
      bobConn.on("typing_indicator", (payload: { isTyping: boolean; userId: string }) => {
        if (payload.userId === aliceId && payload.isTyping) {
          clearTimeout(timer);
          resolve();
        }
      });
      aliceConn.emit("typing_start", { chatId });
    });

    // 3. Alice sends thread reply referencing rootMessageId
    let threadReplyId = "";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on thread_reply")), 1000);
      bobConn.on("thread_reply", (payload: { parentMessageId: string; reply: { id: string; content: string } }) => {
        if (payload.parentMessageId === rootMessageId) {
          clearTimeout(timer);
          assert.equal(payload.reply.content, "I'll prepare the slide deck.");
          threadReplyId = payload.reply.id;
          resolve();
        }
      });

      aliceConn.emit("typing_stop", { chatId });
      aliceConn.emit(
        "send_thread_reply",
        {
          parentMessageId: rootMessageId,
          chatId,
          content: "I'll prepare the slide deck.",
          tempId: "thread-temp-01",
        },
        (ack: { success: boolean; replyId: string }) => {
          assert.equal(ack.success, true);
        }
      );
    });

    // 4. Bob reacts to root message with 🎯
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on reaction")), 1000);
      aliceConn.on("message_reacted", (payload: { messageId: string; emoji: string }) => {
        if (payload.messageId === rootMessageId && payload.emoji === "🎯") {
          clearTimeout(timer);
          resolve();
        }
      });

      bobConn.emit("react_message", {
        messageId: rootMessageId,
        chatId,
        emoji: "🎯",
        action: "add",
      });
    });

    // 5. Alice edits the thread reply
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on edit_message")), 1000);
      bobConn.on("message_updated", (payload: { id: string; content: string; is_edited: boolean }) => {
        if (payload.id === threadReplyId) {
          clearTimeout(timer);
          assert.equal(payload.content, "I'll prepare the slide deck and meeting notes.");
          assert.equal(payload.is_edited, true);
          resolve();
        }
      });

      aliceConn.emit("edit_message", {
        messageId: threadReplyId,
        chatId,
        content: "I'll prepare the slide deck and meeting notes.",
      });
    });

    // 6. Alice deletes the thread reply
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on delete_message")), 1000);
      bobConn.on("message_deleted", (payload: { id: string; type: string }) => {
        if (payload.id === threadReplyId) {
          clearTimeout(timer);
          assert.equal(payload.type, "everyone");
          resolve();
        }
      });

      aliceConn.emit("delete_message", {
        messageId: threadReplyId,
        chatId,
        deleteType: "everyone",
      });
    });

    aliceConn.disconnect();
    bobConn.disconnect();
  });
});
