import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";
import {
  assertValidUuid,
  assertMaskedEmail,
  assertMaskedPhone,
  assertHttpStatus,
} from "../harness/assertions.ts";

describe("Tier 3: Cross-Feature — Search to Direct 1:1 Chat Initiation Flow", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111"; // Alice
  const carolId = "33333333-3333-4333-8333-333333333333"; // Carol

  const aliceToken = createTestJwt({ user_id: aliceId, name: "Alice Smith" });
  const carolToken = createTestJwt({ user_id: carolId, name: "Carol Danvers" });
  const aliceHeaders = { Authorization: `Bearer ${aliceToken}` };

  it("3.1: Full lifecycle: Search user -> Discover -> Initiate 1:1 Chat -> Connect & Join Presence", async () => {
    // Step 1: Alice searches for Carol by username prefix
    const searchRes = backend.handleRestRequest("GET", "/api/v1/users/search?q=carol", null, aliceHeaders);
    assertHttpStatus(searchRes.status, 200, "user search");
    assert.equal(searchRes.data.total, 1);

    const targetUser = (searchRes.data.users as { id: string; username: string; email_masked: string; phone_number_masked?: string }[])[0];
    assert.equal(targetUser.id, carolId);
    assert.equal(targetUser.username, "carol_dev");
    assertMaskedEmail(targetUser.email_masked, "carol@nexus.internal");
    if (targetUser.phone_number_masked) {
      assertMaskedPhone(targetUser.phone_number_masked, "+14155551234");
    }

    // Step 2: Alice initiates a direct chat with Carol
    const directRes = backend.handleRestRequest(
      "POST",
      "/api/v1/chats/direct",
      { recipient_id: targetUser.id },
      aliceHeaders
    );
    assertHttpStatus(directRes.status, 201, "direct chat creation");
    assert.equal(directRes.data.is_new, true);
    assertValidUuid(directRes.data.chat_id);
    assertValidUuid(directRes.data.direct_chat_id);

    const directChatId = directRes.data.chat_id as string;
    const recipientInfo = directRes.data.recipient as { id: string; display_name: string };
    assert.equal(recipientInfo.id, carolId);
    assert.equal(recipientInfo.display_name, "Carol Danvers");

    // Step 3: Verify idempotency - subsequent call returns existing chat
    const secondDirectRes = backend.handleRestRequest(
      "POST",
      "/api/v1/chats/direct",
      { recipient_id: targetUser.id },
      aliceHeaders
    );
    assertHttpStatus(secondDirectRes.status, 200, "idempotent direct chat");
    assert.equal(secondDirectRes.data.is_new, false);
    assert.equal(secondDirectRes.data.chat_id, directChatId);

    // Step 4: Both connect to Socket.IO and join the direct chat room
    const aliceConn = backend.connectSocket(aliceToken);
    const carolConn = backend.connectSocket(carolToken);

    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => carolConn.on("connect", () => res())),
    ]);

    // Alice joins first
    aliceConn.emit("join_chat", { chatId: directChatId });

    // Carol joins; Alice should receive user_joined event for Carol
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for Carol presence")), 1000);
      aliceConn.on("user_joined", (payload: { userId: string; chatId: string }) => {
        if (payload.userId === carolId && payload.chatId === directChatId) {
          clearTimeout(timer);
          resolve();
        }
      });
      carolConn.emit("join_chat", { chatId: directChatId });
    });

    // Step 5: Verify online users in the direct chat
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for get_online_users")), 1000);
      aliceConn.emit("get_online_users", { chatId: directChatId }, (data: { users: { id: string }[] }) => {
        clearTimeout(timer);
        const ids = data.users.map((u) => u.id);
        assert.ok(ids.includes(aliceId), "Alice in online list");
        assert.ok(ids.includes(carolId), "Carol in online list");
        resolve();
      });
    });

    aliceConn.disconnect();
    carolConn.disconnect();
  });
});
