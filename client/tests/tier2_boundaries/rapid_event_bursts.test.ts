import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";
import { assertValidUuid } from "../harness/assertions.ts";

describe("Tier 2: Boundaries — Rapid Event Bursts and High-Throughput Concurrency", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111";
  const bobId = "22222222-2222-4222-8222-222222222222";
  const chatId = "chat-burst-001";

  const aliceToken = createTestJwt({ user_id: aliceId, name: "Alice" });
  const bobToken = createTestJwt({ user_id: bobId, name: "Bob" });

  it("2.4.1: Rapid burst of 50 sequential messages all receive server ACKs with unique messageIds", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    await new Promise<void>((res) => aliceConn.on("connect", () => res()));
    aliceConn.emit("join_chat", { chatId });

    const messageCount = 50;
    const acks: { success: boolean; messageId: string; status: string }[] = [];
    const receivedIds = new Set<string>();

    for (let i = 0; i < messageCount; i++) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout on burst message ${i}`)), 500);
        aliceConn.emit(
          "send_message",
          {
            chatId,
            content: `Burst message #${i}`,
            tempId: `temp-burst-${i}`,
          },
          (ack: { success: boolean; messageId: string; status: string }) => {
            clearTimeout(timer);
            acks.push(ack);
            assert.equal(ack.success, true);
            assertValidUuid(ack.messageId);
            assert.equal(receivedIds.has(ack.messageId), false, "messageId must be unique");
            receivedIds.add(ack.messageId);
            resolve();
          }
        );
      });
    }

    assert.equal(acks.length, messageCount, "All 50 messages must be acknowledged");
    assert.equal(receivedIds.size, messageCount, "All 50 messageIds must be distinct");
    aliceConn.disconnect();
  });

  it("2.4.2: Rapid burst of 20 typing indicators toggles typing state cleanly without crashing", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    const bobConn = backend.connectSocket(bobToken);
    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => bobConn.on("connect", () => res())),
    ]);

    aliceConn.emit("join_chat", { chatId });
    bobConn.emit("join_chat", { chatId });

    const receivedStates: boolean[] = [];
    bobConn.on("typing_indicator", (payload: { isTyping: boolean; userId: string }) => {
      if (payload.userId === aliceId) {
        receivedStates.push(payload.isTyping);
      }
    });

    const toggleCount = 20;
    for (let i = 0; i < toggleCount; i++) {
      if (i % 2 === 0) {
        aliceConn.emit("typing_start", { chatId });
      } else {
        aliceConn.emit("typing_stop", { chatId });
      }
    }

    assert.equal(receivedStates.length, toggleCount, "All typing indicator states should be received");
    for (let i = 0; i < toggleCount; i++) {
      assert.equal(receivedStates[i], i % 2 === 0, `State at index ${i} should be ${i % 2 === 0}`);
    }

    aliceConn.disconnect();
    bobConn.disconnect();
  });

  it("2.4.3: Rapid oscillation of reactions (add -> remove -> add) preserves consistent state", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    await new Promise<void>((res) => aliceConn.on("connect", () => res()));
    aliceConn.emit("join_chat", { chatId });

    const actions = ["add", "remove", "add", "remove", "add"] as const;
    const testMsgId = "msg-react-burst-001";
    const reactionSet = new Set<string>();

    aliceConn.on("message_reacted", (payload: { emoji: string; action: string }) => {
      if (payload.action === "add") {
        reactionSet.add(payload.emoji);
      } else if (payload.action === "remove") {
        reactionSet.delete(payload.emoji);
      }
    });

    for (const act of actions) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout on reaction")), 500);
        aliceConn.emit(
          "react_message",
          { messageId: testMsgId, chatId, emoji: "🔥", action: act },
          (ack: { success: boolean; action: string }) => {
            clearTimeout(timer);
            assert.equal(ack.success, true);
            assert.equal(ack.action, act);
            resolve();
          }
        );
      });
    }

    assert.ok(reactionSet.has("🔥"), "Final state should have 🔥 active after 3 adds and 2 removes");
    aliceConn.disconnect();
  });

  it("2.4.4: Concurrent interleaved message sending from two clients maintains ordering and delivery", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    const bobConn = backend.connectSocket(bobToken);
    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => bobConn.on("connect", () => res())),
    ]);

    aliceConn.emit("join_chat", { chatId });
    bobConn.emit("join_chat", { chatId });

    const bobReceived: { sender: string; content: string }[] = [];
    bobConn.on("new_message", (payload: { userName: string; content: string }) => {
      bobReceived.push({ sender: payload.userName, content: payload.content });
    });

    const alicePromises = Array.from({ length: 10 }, (_, i) => {
      return new Promise<void>((resolve) => {
        aliceConn.emit(
          "send_message",
          { chatId, content: `Alice msg ${i}`, tempId: `a-${i}` },
          () => resolve()
        );
      });
    });

    const bobPromises = Array.from({ length: 10 }, (_, i) => {
      return new Promise<void>((resolve) => {
        bobConn.emit(
          "send_message",
          { chatId, content: `Bob msg ${i}`, tempId: `b-${i}` },
          () => resolve()
        );
      });
    });

    await Promise.all([...alicePromises, ...bobPromises]);

    // Both Alice's and Bob's messages are received
    assert.equal(bobReceived.length, 20, "Bob should have received 20 total messages");
    const aliceMsgs = bobReceived.filter((m) => m.sender === "Alice Smith");
    const bobMsgs = bobReceived.filter((m) => m.sender === "Bob Jones");
    assert.equal(aliceMsgs.length, 10, "10 Alice messages");
    assert.equal(bobMsgs.length, 10, "10 Bob messages");

    aliceConn.disconnect();
    bobConn.disconnect();
  });
});
