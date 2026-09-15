import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";
import { assertHttpStatus, assertErrorMessage } from "../harness/assertions.ts";

describe("Tier 2: Boundaries — Storage Limits and File Types", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111";
  const token = createTestJwt({ user_id: aliceId, name: "Alice" });
  const authHeaders = { Authorization: `Bearer ${token}` };
  const chatId = "chat-general-001";

  const EXACT_5MB = 5 * 1024 * 1024; // 5242880 bytes
  const EXACT_50MB = 50 * 1024 * 1024; // 52428800 bytes

  it("2.2.1: Avatar upload accepts exactly 5MB boundary (5,242,880 bytes)", () => {
    const res = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "avatar_max.jpg",
        content_type: "image/jpeg",
        size_bytes: EXACT_5MB,
        purpose: "avatar",
      },
      authHeaders
    );
    assertHttpStatus(res.status, 201, "exact 5MB avatar");
    assert.equal(res.data.bucket, "nexus-avatars");
  });

  it("2.2.2: Avatar upload rejects 5MB + 1 byte (5,242,881 bytes) with HTTP 400", () => {
    const res = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "avatar_oversize.jpg",
        content_type: "image/jpeg",
        size_bytes: EXACT_5MB + 1,
        purpose: "avatar",
      },
      authHeaders
    );
    assertHttpStatus(res.status, 400, "5MB + 1 avatar");
    assertErrorMessage(res.data, "exceeds maximum allowed for avatar");
  });

  it("2.2.3: Avatar upload rejects 0-byte file with HTTP 400", () => {
    const res = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "empty_avatar.png",
        content_type: "image/png",
        size_bytes: 0,
        purpose: "avatar",
      },
      authHeaders
    );
    assertHttpStatus(res.status, 400, "0-byte avatar");
    assertErrorMessage(res.data, "exceeds maximum allowed for avatar");
  });

  it("2.2.4: Attachment upload accepts exactly 50MB boundary (52,428,800 bytes)", () => {
    const res = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "dataset_max.zip",
        content_type: "application/zip",
        size_bytes: EXACT_50MB,
        purpose: "attachment",
        chat_id: chatId,
      },
      authHeaders
    );
    assertHttpStatus(res.status, 201, "exact 50MB attachment");
    assert.equal(res.data.bucket, "nexus-attachments");
  });

  it("2.2.5: Attachment upload rejects 50MB + 1 byte (52,428,801 bytes) with HTTP 400", () => {
    const res = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "dataset_oversize.zip",
        content_type: "application/zip",
        size_bytes: EXACT_50MB + 1,
        purpose: "attachment",
        chat_id: chatId,
      },
      authHeaders
    );
    assertHttpStatus(res.status, 400, "50MB + 1 attachment");
    assertErrorMessage(res.data, "exceeds maximum allowed for attachment");
  });

  it("2.2.6: Attachment upload rejects 0-byte file and negative size with HTTP 400", () => {
    const resZero = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "empty.pdf",
        content_type: "application/pdf",
        size_bytes: 0,
        purpose: "attachment",
        chat_id: chatId,
      },
      authHeaders
    );
    assertHttpStatus(resZero.status, 400, "0-byte attachment");

    const resNeg = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "negative.pdf",
        content_type: "application/pdf",
        size_bytes: -100,
        purpose: "attachment",
        chat_id: chatId,
      },
      authHeaders
    );
    assertHttpStatus(resNeg.status, 400, "negative size attachment");
  });

  it("2.2.7: Attachment upload rejects dangerous MIME types (executable shell scripts, SVG, HTML)", () => {
    const dangerousMimes = ["image/svg+xml", "text/html", "application/x-sh", "application/x-msdownload"];
    for (const mime of dangerousMimes) {
      const res = backend.handleRestRequest(
        "POST",
        "/api/v1/files/presign-upload",
        {
          file_name: "payload.bin",
          content_type: mime,
          size_bytes: 1024,
          purpose: "attachment",
          chat_id: chatId,
        },
        authHeaders
      );
      assertHttpStatus(res.status, 400, `dangerous mime: ${mime}`);
      assertErrorMessage(res.data, "unsupported attachment content_type");
    }
  });

  it("2.2.8: Confirm upload rejects non-existent file ID with HTTP 404", () => {
    const res = backend.handleRestRequest(
      "POST",
      "/api/v1/files/confirm-upload",
      { file_id: "00000000-0000-0000-0000-000000000000" },
      authHeaders
    );
    assertHttpStatus(res.status, 404, "non-existent file confirmation");
    assertErrorMessage(res.data, "file not found");
  });

  it("2.2.9: Download endpoint rejects pending (unconfirmed) file ID with HTTP 404", () => {
    // Create pending file
    const presignRes = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "pending_doc.pdf",
        content_type: "application/pdf",
        size_bytes: 2048,
        purpose: "attachment",
        chat_id: chatId,
      },
      authHeaders
    );
    const fileId = presignRes.data.file_id as string;

    // Attempt download without confirming
    const downloadRes = backend.handleRestRequest("GET", `/api/v1/files/${fileId}/download`, null, authHeaders);
    assertHttpStatus(downloadRes.status, 404, "unconfirmed download");
    assertErrorMessage(downloadRes.data, "not active");
  });

  it("2.2.10: Confirming a file owned by another user is rejected with HTTP 403", () => {
    // Alice uploads pending file
    const presignRes = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "alice_private.pdf",
        content_type: "application/pdf",
        size_bytes: 2048,
        purpose: "attachment",
        chat_id: chatId,
      },
      authHeaders
    );
    const fileId = presignRes.data.file_id as string;

    // Bob tries to confirm Alice's file
    const bobId = "22222222-2222-4222-8222-222222222222";
    const bobToken = createTestJwt({ user_id: bobId, name: "Bob" });
    const bobHeaders = { Authorization: `Bearer ${bobToken}` };

    const confirmRes = backend.handleRestRequest(
      "POST",
      "/api/v1/files/confirm-upload",
      { file_id: fileId },
      bobHeaders
    );
    assertHttpStatus(confirmRes.status, 403, "cross-user confirmation");
    assertErrorMessage(confirmRes.data, "forbidden");
  });
});
