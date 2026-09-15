import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";

describe("Tier 4: Real-World — AI Copilot Streaming & Collaborative Interaction", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111"; // Alice
  const bobId = "22222222-2222-4222-8222-222222222222"; // Bob
  const chatId = "chat-ai-collab-001";

  const aliceToken = createTestJwt({ user_id: aliceId, name: "Alice Smith" });
  const bobToken = createTestJwt({ user_id: bobId, name: "Bob Jones" });

  it("4.2: Prompt triggering -> AI typing indicator -> token chunk streaming -> multi-client assembly", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    const bobConn = backend.connectSocket(bobToken);

    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => bobConn.on("connect", () => res())),
    ]);

    aliceConn.emit("join_chat", { chatId });
    bobConn.emit("join_chat", { chatId });

    // 1. Bob listens for AI typing indicator when Alice triggers AI
    const bobSawAiTyping = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on Bob seeing AI typing")), 1000);
      bobConn.on("typing_indicator", (payload: { userId: string; isTyping: boolean }) => {
        if (payload.userId === "ai-assistant" && payload.isTyping) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    let userMsgId = "";
    aliceConn.emit(
      "send_message",
      {
        chatId,
        content: "@nexus Explain Delta-CRDT in 1 sentence",
        tempId: "ai-prompt-01",
        triggerAI: true,
      },
      (ack: { success: boolean; messageId: string }) => {
        assert.equal(ack.success, true);
        userMsgId = ack.messageId;
      }
    );

    await bobSawAiTyping;
    assert.ok(userMsgId, "Prompt message must be assigned an ID");

    // 2. Simulate AI streaming server chunks
    const aiMessageId = "msg-ai-response-999";
    const tokenChunks = ["Delta-CRDTs ", "allow ", "conflict-free ", "state ", "synchronization ", "with minimal ", "bandwidth."];

    let aliceAccumulated = "";
    let bobAccumulated = "";

    const aliceStreamPromise = new Promise<void>((resolve) => {
      aliceConn.on("ai_stream_chunk", (payload: { messageId: string; delta: string; isFinal?: boolean }) => {
        if (payload.messageId === aiMessageId) {
          aliceAccumulated += payload.delta;
          if (payload.isFinal) resolve();
        }
      });
    });

    const bobStreamPromise = new Promise<void>((resolve) => {
      bobConn.on("ai_stream_chunk", (payload: { messageId: string; delta: string; isFinal?: boolean }) => {
        if (payload.messageId === aiMessageId) {
          bobAccumulated += payload.delta;
          if (payload.isFinal) resolve();
        }
      });
    });

    // Broadcast stream chunks
    for (let i = 0; i < tokenChunks.length; i++) {
      const isFinal = i === tokenChunks.length - 1;
      backend.broadcastToRoom(chatId, "ai_stream_chunk", {
        chatId,
        messageId: aiMessageId,
        delta: tokenChunks[i],
        isFinal,
      });
    }

    await Promise.all([aliceStreamPromise, bobStreamPromise]);

    const expectedText = tokenChunks.join("");
    assert.equal(aliceAccumulated, expectedText, "Alice assembled complete AI text");
    assert.equal(bobAccumulated, expectedText, "Bob assembled identical AI text");

    // 3. Bob reacts to the AI answer with 🤖
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for AI reaction")), 1000);
      aliceConn.on("message_reacted", (payload: { messageId: string; emoji: string }) => {
        if (payload.messageId === aiMessageId && payload.emoji === "🤖") {
          clearTimeout(timer);
          resolve();
        }
      });

      bobConn.emit("react_message", {
        messageId: aiMessageId,
        chatId,
        emoji: "🤖",
        action: "add",
      });
    });

    aliceConn.disconnect();
    bobConn.disconnect();
  });
});
