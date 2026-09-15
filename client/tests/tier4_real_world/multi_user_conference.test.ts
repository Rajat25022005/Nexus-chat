import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";

describe("Tier 4: Real-World — Multi-User Team Conference and Collaboration", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111"; // Alice
  const bobId = "22222222-2222-4222-8222-222222222222"; // Bob
  const carolId = "33333333-3333-4333-8333-333333333333"; // Carol
  const channelId = "chat-general-001";

  const aliceToken = createTestJwt({ user_id: aliceId, name: "Alice Smith" });
  const bobToken = createTestJwt({ user_id: bobId, name: "Bob Jones" });
  const carolToken = createTestJwt({ user_id: carolId, name: "Carol Danvers" });

  it("4.1: Multi-user presence, presentation typing, thread discussion, and selective departure", async () => {
    const aliceConn = backend.connectSocket(aliceToken);
    const bobConn = backend.connectSocket(bobToken);
    const carolConn = backend.connectSocket(carolToken);

    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => bobConn.on("connect", () => res())),
      new Promise<void>((res) => carolConn.on("connect", () => res())),
    ]);

    // 1. Staggered joins
    aliceConn.emit("join_chat", { chatId: channelId });
    bobConn.emit("join_chat", { chatId: channelId });

    // Carol joins; Alice and Bob should both receive Carol's presence
    const carolJoinAlice = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on Alice seeing Carol join")), 1000);
      aliceConn.on("user_joined", (payload: { userId: string; chatId: string }) => {
        if (payload.userId === carolId && payload.chatId === channelId) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const carolJoinBob = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on Bob seeing Carol join")), 1000);
      bobConn.on("user_joined", (payload: { userId: string; chatId: string }) => {
        if (payload.userId === carolId && payload.chatId === channelId) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    carolConn.emit("join_chat", { chatId: channelId });
    await Promise.all([carolJoinAlice, carolJoinBob]);

    // 2. Online users count should be 3
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on get_online_users")), 1000);
      aliceConn.emit("get_online_users", { chatId: channelId }, (data: { users: { id: string }[] }) => {
        clearTimeout(timer);
        assert.equal(data.users.length, 3, "Expected 3 users in online tracker");
        resolve();
      });
    });

    // 3. Alice presents: typing indicator -> send agenda message
    let agendaMessageId = "";
    const bobGotAgenda = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on Bob seeing agenda")), 1000);
      bobConn.on("new_message", (payload: { id: string; content: string }) => {
        if (payload.content === "Q3 Architecture Review Agenda") {
          clearTimeout(timer);
          agendaMessageId = payload.id;
          resolve();
        }
      });
    });

    const carolGotAgenda = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on Carol seeing agenda")), 1000);
      carolConn.on("new_message", (payload: { content: string }) => {
        if (payload.content === "Q3 Architecture Review Agenda") {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    aliceConn.emit("typing_start", { chatId: channelId });
    aliceConn.emit("typing_stop", { chatId: channelId });
    aliceConn.emit("send_message", {
      chatId: channelId,
      content: "Q3 Architecture Review Agenda",
      tempId: "agenda-01",
    });

    await Promise.all([bobGotAgenda, carolGotAgenda]);

    // 4. Carol questions in thread
    const aliceGotThreadReply = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on Alice seeing thread reply")), 1000);
      aliceConn.on("thread_reply", (payload: { parentMessageId: string; reply: { content: string } }) => {
        if (payload.parentMessageId === agendaMessageId) {
          clearTimeout(timer);
          assert.equal(payload.reply.content, "Is Phoenix Channels in scope?");
          resolve();
        }
      });
    });

    carolConn.emit("send_thread_reply", {
      parentMessageId: agendaMessageId,
      chatId: channelId,
      content: "Is Phoenix Channels in scope?",
      tempId: "carol-thread-01",
    });

    await aliceGotThreadReply;

    // 5. Carol leaves the conference
    const aliceSawCarolLeave = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on Alice seeing Carol leave")), 1000);
      aliceConn.on("user_left", (payload: { userId: string; chatId: string }) => {
        if (payload.userId === carolId && payload.chatId === channelId) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    carolConn.emit("leave_chat", { chatId: channelId });
    await aliceSawCarolLeave;

    // 6. Online users now 2
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout on get_online_users")), 1000);
      aliceConn.emit("get_online_users", { chatId: channelId }, (data: { users: { id: string }[] }) => {
        clearTimeout(timer);
        assert.equal(data.users.length, 2, "Expected 2 users in online tracker after Carol left");
        assert.ok(!data.users.some((u) => u.id === carolId), "Carol should not be in online list");
        resolve();
      });
    });

    aliceConn.disconnect();
    bobConn.disconnect();
    carolConn.disconnect();
  });
});
