import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";
import { assertHttpStatus } from "../harness/assertions.ts";

describe("Tier 3: Cross-Feature — Workspace Invite to Group Chat Onboarding Flow", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111"; // Alice
  const carolId = "33333333-3333-4333-8333-333333333333"; // Carol

  const aliceToken = createTestJwt({ user_id: aliceId, name: "Alice Smith" });
  const carolToken = createTestJwt({ user_id: carolId, name: "Carol Danvers" });
  const carolHeaders = { Authorization: `Bearer ${carolToken}` };

  it("3.4: Complete flow: Redeem Invite Code -> Join Group -> Join Socket Room -> Presence & Welcome Chat", async () => {
    // 1. Carol joins group with invite code
    const joinRes = backend.handleRestRequest(
      "POST",
      "/api/groups/join",
      { code: "NX7K-Q2R9" },
      carolHeaders
    );
    assertHttpStatus(joinRes.status, 200, "join group via code");
    const group = joinRes.data.group as { id: string; members: string[]; chats: { id: string; title: string }[] };
    assert.ok(group.members.includes(carolId), "Carol is in group members");
    assert.ok(group.chats.length > 0, "Group has default channels");

    const defaultChatId = group.chats[0].id;
    assert.equal(defaultChatId, "chat-general-001");

    // 2. Both connect to socket
    const aliceConn = backend.connectSocket(aliceToken);
    const carolConn = backend.connectSocket(carolToken);

    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => carolConn.on("connect", () => res())),
    ]);

    // Alice is already in default channel
    aliceConn.emit("join_chat", { chatId: defaultChatId });

    // 3. Carol joins default channel, Alice observes presence
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for Carol presence")), 1000);
      aliceConn.on("user_joined", (payload: { userId: string; chatId: string }) => {
        if (payload.userId === carolId && payload.chatId === defaultChatId) {
          clearTimeout(timer);
          resolve();
        }
      });
      carolConn.emit("join_chat", { chatId: defaultChatId });
    });

    // 4. Carol sends a greeting message
    let greetingMsgId = "";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for Carol message")), 1000);
      aliceConn.on("new_message", (payload: { id: string; content: string; userName: string }) => {
        if (payload.userName === "Carol Danvers") {
          clearTimeout(timer);
          assert.equal(payload.content, "Hello everyone! Glad to join the team.");
          greetingMsgId = payload.id;
          resolve();
        }
      });

      carolConn.emit(
        "send_message",
        {
          chatId: defaultChatId,
          content: "Hello everyone! Glad to join the team.",
          tempId: "carol-welcome-01",
        },
        (ack: { success: boolean }) => {
          assert.equal(ack.success, true);
        }
      );
    });

    // 5. Alice welcomes Carol with a 👋 reaction
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for reaction")), 1000);
      carolConn.on("message_reacted", (payload: { messageId: string; emoji: string }) => {
        if (payload.messageId === greetingMsgId && payload.emoji === "👋") {
          clearTimeout(timer);
          resolve();
        }
      });

      aliceConn.emit("react_message", {
        messageId: greetingMsgId,
        chatId: defaultChatId,
        emoji: "👋",
        action: "add",
      });
    });

    aliceConn.disconnect();
    carolConn.disconnect();
  });
});
