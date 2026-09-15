import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";

describe("Tier 4: Real-World — Multi-Channel Switching and Room Isolation", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111"; // Alice
  const bobId = "22222222-2222-4222-8222-222222222222"; // Bob
  const carolId = "33333333-3333-4333-8333-333333333333"; // Carol

  const roomAlpha = "chat-room-alpha";
  const roomBeta = "chat-room-beta";

  const aliceToken = createTestJwt({ user_id: aliceId, name: "Alice Smith" });
  const bobToken = createTestJwt({ user_id: bobId, name: "Bob Jones" });
  const carolToken = createTestJwt({ user_id: carolId, name: "Carol Danvers" });

  it("4.3: Room multiplexing, channel boundary isolation, and selective leave semantics", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    const bobConn = backend.connectSocket(bobToken);
    const carolConn = backend.connectSocket(carolToken);

    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => bobConn.on("connect", () => res())),
      new Promise<void>((res) => carolConn.on("connect", () => res())),
    ]);

    // Alice joins both Alpha and Beta
    aliceConn.emit("join_chat", { chatId: roomAlpha });
    aliceConn.emit("join_chat", { chatId: roomBeta });

    // Bob joins only Alpha, Carol joins only Beta
    bobConn.emit("join_chat", { chatId: roomAlpha });
    carolConn.emit("join_chat", { chatId: roomBeta });

    const bobAlphaReceived: string[] = [];
    const bobBetaReceived: string[] = [];
    const carolAlphaReceived: string[] = [];
    const carolBetaReceived: string[] = [];

    bobConn.on("new_message", (p: { chatId: string; content: string }) => {
      if (p.chatId === roomAlpha) bobAlphaReceived.push(p.content);
      if (p.chatId === roomBeta) bobBetaReceived.push(p.content);
    });

    carolConn.on("new_message", (p: { chatId: string; content: string }) => {
      if (p.chatId === roomAlpha) carolAlphaReceived.push(p.content);
      if (p.chatId === roomBeta) carolBetaReceived.push(p.content);
    });

    // 1. Alice sends to Alpha
    await new Promise<void>((resolve) => {
      aliceConn.emit(
        "send_message",
        { chatId: roomAlpha, content: "Hello Alpha", tempId: "a-01" },
        () => resolve()
      );
    });

    assert.equal(bobAlphaReceived.length, 1);
    assert.equal(bobBetaReceived.length, 0);
    assert.equal(carolAlphaReceived.length, 0, "Carol in Beta must NOT receive Alpha message");
    assert.equal(carolBetaReceived.length, 0);

    // 2. Alice sends to Beta
    await new Promise<void>((resolve) => {
      aliceConn.emit(
        "send_message",
        { chatId: roomBeta, content: "Hello Beta", tempId: "b-01" },
        () => resolve()
      );
    });

    assert.equal(bobAlphaReceived.length, 1);
    assert.equal(bobBetaReceived.length, 0, "Bob in Alpha must NOT receive Beta message");
    assert.equal(carolAlphaReceived.length, 0);
    assert.equal(carolBetaReceived.length, 1);

    // 3. Alice leaves Alpha but stays in Beta
    const bobSawAliceLeaveAlpha = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on Bob seeing Alice leave Alpha")), 1000);
      bobConn.on("user_left", (p: { userId: string; chatId: string }) => {
        if (p.userId === aliceId && p.chatId === roomAlpha) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    aliceConn.emit("leave_chat", { chatId: roomAlpha });
    await bobSawAliceLeaveAlpha;

    assert.equal(aliceConn.joinedRooms.has(roomAlpha), false, "Alice left Alpha");
    assert.equal(aliceConn.joinedRooms.has(roomBeta), true, "Alice still in Beta");

    // 4. Bob sends to Alpha; Alice should NOT receive it
    const aliceAlphaAfterLeave: string[] = [];
    const aliceBetaAfterLeave: string[] = [];
    aliceConn.on("new_message", (p: { chatId: string; content: string }) => {
      if (p.chatId === roomAlpha) aliceAlphaAfterLeave.push(p.content);
      if (p.chatId === roomBeta) aliceBetaAfterLeave.push(p.content);
    });

    bobConn.emit("send_message", {
      chatId: roomAlpha,
      content: "Alpha message after Alice left",
      tempId: "bob-post-leave",
    });

    assert.equal(aliceAlphaAfterLeave.length, 0, "Alice must not receive Alpha messages after leaving");

    // 5. Carol sends to Beta; Alice DOES receive it
    carolConn.emit("send_message", {
      chatId: roomBeta,
      content: "Beta message for Alice",
      tempId: "carol-active-beta",
    });

    assert.equal(aliceBetaAfterLeave.length, 1, "Alice should receive Beta messages");
    assert.equal(aliceBetaAfterLeave[0], "Beta message for Alice");

    aliceConn.disconnect();
    bobConn.disconnect();
    carolConn.disconnect();
  });
});
