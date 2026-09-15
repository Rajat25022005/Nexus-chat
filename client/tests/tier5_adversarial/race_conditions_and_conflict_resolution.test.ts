import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";


describe("Tier 5: Adversarial — Race Conditions & Conflict Resolution", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111"; // Alice
  const bobId = "22222222-2222-4222-8222-222222222222"; // Bob
  const carolId = "33333333-3333-4333-8333-333333333333"; // Carol
  const chatId = "chat-race-001";

  const aliceToken = createTestJwt({ user_id: aliceId, name: "Alice Smith" });
  const bobToken = createTestJwt({ user_id: bobId, name: "Bob Jones" });
  const carolToken = createTestJwt({ user_id: carolId, name: "Carol Danvers" });
  const aliceHeaders = { Authorization: `Bearer ${aliceToken}` };
  const bobHeaders = { Authorization: `Bearer ${bobToken}` };

  it("5.2.1: Concurrent direct chat creation race resolves to identical conversation (PG 23505 recovery)", async () => {
    // Alice and Bob simultaneously initiate direct chat with each other
    const promiseA = Promise.resolve().then(() =>
      backend.handleRestRequest("POST", "/api/v1/chats/direct", { recipient_id: bobId }, aliceHeaders)
    );
    const promiseB = Promise.resolve().then(() =>
      backend.handleRestRequest("POST", "/api/v1/chats/direct", { recipient_id: aliceId }, bobHeaders)
    );

    const [resA, resB] = await Promise.all([promiseA, promiseB]);

    assert.ok(resA.status === 200 || resA.status === 201, `Status A: ${resA.status}`);
    assert.ok(resB.status === 200 || resB.status === 201, `Status B: ${resB.status}`);

    const chatIdA = resA.data.chat_id;
    const chatIdB = resB.data.chat_id;
    assert.equal(chatIdA, chatIdB, "Both race participants must resolve to identical chat_id");
  });

  it("5.2.2: Concurrent multi-user reactions on single message preserve all distinct emojis", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    const bobConn = backend.connectSocket(bobToken);
    const carolConn = backend.connectSocket(carolToken);

    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => bobConn.on("connect", () => res())),
      new Promise<void>((res) => carolConn.on("connect", () => res())),
    ]);

    aliceConn.emit("join_chat", { chatId });
    bobConn.emit("join_chat", { chatId });
    carolConn.emit("join_chat", { chatId });

    const targetMsgId = "msg-concurrent-react-01";
    const reactions = new Map<string, Set<string>>(); // emoji -> Set of userIds

    const tracker = (p: { messageId: string; emoji: string; userId: string; action: string }) => {
      if (p.messageId === targetMsgId) {
        if (!reactions.has(p.emoji)) reactions.set(p.emoji, new Set());
        if (p.action === "add") reactions.get(p.emoji)!.add(p.userId);
        if (p.action === "remove") reactions.get(p.emoji)!.delete(p.userId);
      }
    };

    aliceConn.on("message_reacted", tracker);

    // Alice reacts ❤️, Bob reacts 🚀, Carol reacts 🎉 simultaneously
    const r1 = new Promise<void>((res) =>
      aliceConn.emit("react_message", { messageId: targetMsgId, chatId, emoji: "❤️", action: "add" }, () => res())
    );
    const r2 = new Promise<void>((res) =>
      bobConn.emit("react_message", { messageId: targetMsgId, chatId, emoji: "🚀", action: "add" }, () => res())
    );
    const r3 = new Promise<void>((res) =>
      carolConn.emit("react_message", { messageId: targetMsgId, chatId, emoji: "🎉", action: "add" }, () => res())
    );

    await Promise.all([r1, r2, r3]);

    assert.equal(reactions.size, 3, "All 3 distinct emoji reactions must be retained");
    assert.ok(reactions.has("❤️"));
    assert.ok(reactions.has("🚀"));
    assert.ok(reactions.has("🎉"));

    aliceConn.disconnect();
    bobConn.disconnect();
    carolConn.disconnect();
  });

  it("5.2.3: Interleaved message deletion and editing resolves gracefully", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    const bobConn = backend.connectSocket(bobToken);

    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => bobConn.on("connect", () => res())),
    ]);

    aliceConn.emit("join_chat", { chatId });
    bobConn.emit("join_chat", { chatId });

    const targetMsgId = "msg-delete-edit-race";
    let isDeleted = false;

    bobConn.on("message_deleted", (p: { id: string }) => {
      if (p.id === targetMsgId) isDeleted = true;
    });

    const editPromise = new Promise<void>((res) =>
      aliceConn.emit("edit_message", { messageId: targetMsgId, chatId, content: "Late edit" }, () => res())
    );
    const deletePromise = new Promise<void>((res) =>
      aliceConn.emit("delete_message", { messageId: targetMsgId, chatId, deleteType: "everyone" }, () => res())
    );

    await Promise.all([editPromise, deletePromise]);

    assert.equal(isDeleted, true, "Message should be marked deleted");

    aliceConn.disconnect();
    bobConn.disconnect();
  });

  it("5.2.4: Rapid connect/disconnect cycling does not leak sessions or ghost presence in rooms", async () => {
    const cycleCount = 10;
    const testChannel = "chat-cycle-test";

    for (let i = 0; i < cycleCount; i++) {
      const conn = backend.connectSocket(aliceToken);
      await new Promise<void>((res) => conn.on("connect", () => res()));
      conn.emit("join_chat", { chatId: testChannel });
      assert.ok(backend.activeRooms.get(testChannel)?.has(conn.id), `Cycle ${i} socket joined`);
      conn.disconnect();
      assert.equal(backend.activeRooms.get(testChannel)?.has(conn.id), false, `Cycle ${i} socket cleaned up`);
    }

    const remainingInRoom = backend.activeRooms.get(testChannel)?.size || 0;
    assert.equal(remainingInRoom, 0, "No stale ghost connections remain in room");
  });
});
