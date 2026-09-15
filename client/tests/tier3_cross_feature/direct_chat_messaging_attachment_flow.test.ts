import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";
import { assertHttpStatus, assertValidUuid } from "../harness/assertions.ts";

describe("Tier 3: Cross-Feature — Direct Chat, S3 Attachments & Secure Downloads", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111"; // Alice
  const bobId = "22222222-2222-4222-8222-222222222222"; // Bob

  const aliceToken = createTestJwt({ user_id: aliceId, name: "Alice Smith" });
  const bobToken = createTestJwt({ user_id: bobId, name: "Bob Jones" });
  const aliceHeaders = { Authorization: `Bearer ${aliceToken}` };
  const bobHeaders = { Authorization: `Bearer ${bobToken}` };

  it("3.2: Complete workflow: Direct Chat -> Pre-signed S3 Upload -> Message Composition -> Secure Download Link Refresh", async () => {
    // 1. Direct Chat creation
    const chatRes = backend.handleRestRequest(
      "POST",
      "/api/v1/chats/direct",
      { recipient_id: bobId },
      aliceHeaders
    );
    assertHttpStatus(chatRes.status, 201);
    const chatId = chatRes.data.chat_id as string;

    // 2. Pre-signed upload for 3.5MB PDF attachment
    const fileSize = 3.5 * 1024 * 1024; // 3.5MB
    const presignRes = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "project_brief.pdf",
        content_type: "application/pdf",
        size_bytes: fileSize,
        purpose: "attachment",
        chat_id: chatId,
      },
      aliceHeaders
    );
    assertHttpStatus(presignRes.status, 201, "presign attachment upload");
    const fileId = presignRes.data.file_id as string;
    assertValidUuid(fileId);
    assert.ok((presignRes.data.upload_url as string).includes("nexus-attachments"));

    // 3. Alice confirms upload completion
    const confirmRes = backend.handleRestRequest(
      "POST",
      "/api/v1/files/confirm-upload",
      { file_id: fileId },
      aliceHeaders
    );
    assertHttpStatus(confirmRes.status, 200, "confirm upload");
    assert.equal(confirmRes.data.status, "active");
    assert.ok(confirmRes.data.etag, "ETag returned");

    // 4. Sockets connect and join room
    const aliceConn = backend.connectSocket(aliceToken);
    const bobConn = backend.connectSocket(bobToken);

    await Promise.all([
      new Promise<void>((res) => aliceConn.on("connect", () => res())),
      new Promise<void>((res) => bobConn.on("connect", () => res())),
    ]);

    aliceConn.emit("join_chat", { chatId });
    bobConn.emit("join_chat", { chatId });

    // 5. Alice sends message with markdown attachment link
    const markdownContent = `Here is the architectural specification: [project_brief.pdf](${confirmRes.data.download_url})`;
    let emittedMessageId = "";

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for Bob message")), 1000);
      bobConn.on("new_message", (payload: { id: string; content: string; userName: string }) => {
        if (payload.userName === "Alice Smith") {
          clearTimeout(timer);
          assert.equal(payload.content, markdownContent);
          emittedMessageId = payload.id;
          resolve();
        }
      });

      aliceConn.emit(
        "send_message",
        {
          chatId,
          content: markdownContent,
          tempId: "temp-attach-01",
        },
        (ack: { success: boolean; messageId: string }) => {
          assert.equal(ack.success, true);
        }
      );
    });

    // 6. Bob fetches pre-signed GET download URL for the attachment
    const bobDownloadRes = backend.handleRestRequest(
      "GET",
      `/api/v1/files/${fileId}/download`,
      null,
      bobHeaders
    );
    assertHttpStatus(bobDownloadRes.status, 200, "bob attachment download");
    assert.equal(bobDownloadRes.data.file_id, fileId);
    assert.ok((bobDownloadRes.data.download_url as string).includes("nexus-attachments"));
    assert.equal(bobDownloadRes.data.expires_in, 900);

    // 7. Bob acknowledges receipt by reacting with 👍
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for reaction")), 1000);
      aliceConn.on("message_reacted", (payload: { messageId: string; emoji: string }) => {
        if (payload.messageId === emittedMessageId && payload.emoji === "👍") {
          clearTimeout(timer);
          resolve();
        }
      });

      bobConn.emit("react_message", {
        messageId: emittedMessageId,
        chatId,
        emoji: "👍",
        action: "add",
      });
    });

    aliceConn.disconnect();
    bobConn.disconnect();
  });
});
