import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";
import {
  assertValidUuid,
  assertHttpStatus,
  assertErrorMessage,
} from "../harness/assertions.ts";
import {
  MAX_AVATAR_SIZE_BYTES,
  MAX_ATTACHMENT_SIZE_BYTES,
  sanitizeFileName,
} from "../../src/lib/fileSecurity.ts";

describe("Tier 1: Feature Coverage — MinIO S3 Attachments & Downloads", () => {
  const backend = new MockNexusBackend();
  const callerId = "11111111-1111-4111-8111-111111111111";
  const authHeaders = { Authorization: `Bearer ${createTestJwt({ user_id: callerId })}` };
  const testChatId = "chat-general-001";

  it("3.1: Presigning an avatar upload up to 5MB returns HTTP 201 with S3 PUT URL and pending status", () => {
    const res = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "profile.png",
        content_type: "image/png",
        size_bytes: 2 * 1024 * 1024, // 2MB
        purpose: "avatar",
      },
      authHeaders
    );
    assertHttpStatus(res.status, 201, "presign avatar");
    assertValidUuid(res.data.file_id);
    assert.ok(res.data.upload_url.includes("nexus-avatars"));
    assert.equal(res.data.bucket, "nexus-avatars");
    assert.equal(res.data.expires_in, 900);
  });

  it("3.2: Presigning an attachment upload up to 50MB with chat_id returns HTTP 201 with S3 PUT URL", () => {
    const res = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "dataset.pdf",
        content_type: "application/pdf",
        size_bytes: 45 * 1024 * 1024, // 45MB
        purpose: "attachment",
        chat_id: testChatId,
      },
      authHeaders
    );
    assertHttpStatus(res.status, 201, "presign attachment");
    assertValidUuid(res.data.file_id);
    assert.ok(res.data.upload_url.includes("nexus-attachments"));
    assert.equal(res.data.bucket, "nexus-attachments");
    assert.equal(res.data.expires_in, 900);
  });

  it("3.3: Confirming upload flips status to active and returns download URL and etag", () => {
    // 1. Presign
    const presignRes = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "report.pdf",
        content_type: "application/pdf",
        size_bytes: 10 * 1024 * 1024,
        purpose: "attachment",
        chat_id: testChatId,
      },
      authHeaders
    );
    const fileId = presignRes.data.file_id;

    // 2. Confirm
    const confirmRes = backend.handleRestRequest(
      "POST",
      "/api/v1/files/confirm-upload",
      { file_id: fileId },
      authHeaders
    );
    assertHttpStatus(confirmRes.status, 200, "confirm upload");
    assert.equal(confirmRes.data.file_id, fileId);
    assert.equal(confirmRes.data.status, "active");
    assert.ok(confirmRes.data.download_url.includes("nexus-attachments"));
    assert.ok(confirmRes.data.etag);
  });

  it("3.4: File download endpoint returns time-limited pre-signed GET URL (900s)", () => {
    // Setup active file
    const presign = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "guide.txt",
        content_type: "text/plain",
        size_bytes: 1024,
        purpose: "attachment",
        chat_id: testChatId,
      },
      authHeaders
    );
    backend.handleRestRequest("POST", "/api/v1/files/confirm-upload", { file_id: presign.data.file_id }, authHeaders);

    const downloadRes = backend.handleRestRequest(
      "GET",
      `/api/v1/files/${presign.data.file_id}/download`,
      null,
      authHeaders
    );
    assertHttpStatus(downloadRes.status, 200, "download file");
    assert.equal(downloadRes.data.file_id, presign.data.file_id);
    assert.ok(downloadRes.data.download_url.includes("guide.txt"));
    assert.equal(downloadRes.data.expires_in, 900);
  });

  it("3.5: Reject disallowed MIME types such as shell scripts and SVGs in attachment upload", () => {
    const resScript = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "deploy.sh",
        content_type: "application/x-sh",
        size_bytes: 1024,
        purpose: "attachment",
        chat_id: testChatId,
      },
      authHeaders
    );
    assertHttpStatus(resScript.status, 400, "shell script upload");
    assertErrorMessage(resScript.data, "unsupported attachment content_type");

    const resSvg = backend.handleRestRequest(
      "POST",
      "/api/v1/files/presign-upload",
      {
        file_name: "logo.svg",
        content_type: "image/svg+xml",
        size_bytes: 1024,
        purpose: "attachment",
        chat_id: testChatId,
      },
      authHeaders
    );
    assertHttpStatus(resSvg.status, 400, "svg upload");
    assertErrorMessage(resSvg.data, "unsupported attachment content_type");
  });

  it("3.6: Client-side fileSecurity library enforces max size constants and sanitizes filenames", () => {
    assert.equal(MAX_AVATAR_SIZE_BYTES, 5 * 1024 * 1024, "Avatar size limit must be 5MB");
    assert.equal(MAX_ATTACHMENT_SIZE_BYTES, 50 * 1024 * 1024, "Attachment size limit must be 50MB");

    const sanitized = sanitizeFileName("../../../evil/dangerous file.pdf");
    assert.ok(!sanitized.includes(".."), "Filename must not contain path traversal");
    assert.ok(!sanitized.includes("/"), "Filename must not contain directory slashes");
  });
});
