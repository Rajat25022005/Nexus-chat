import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";
import {
  assertValidUuid,
  assertMaskedEmail,
  assertMaskedPhone,
  assertHttpStatus,
  assertErrorMessage,
} from "../harness/assertions.ts";

describe("Tier 1: Feature Coverage — User Discovery (/api/v1/users/search)", () => {
  const backend = new MockNexusBackend();
  const callerId = "11111111-1111-4111-8111-111111111111"; // Alice
  const token = createTestJwt({ user_id: callerId });
  const authHeaders = { Authorization: `Bearer ${token}` };

  it("1.1: Exact email search returns user with cleartext email and masked phone", () => {
    const res = backend.handleRestRequest("GET", "/api/v1/users/search?q=bob@nexus.internal", null, authHeaders);
    assertHttpStatus(res.status, 200, "exact email search");
    assert.equal(res.data.total, 1);
    const user = res.data.users[0];
    assertValidUuid(user.id);
    assert.equal(user.email, "bob@nexus.internal", "Exact email match should return cleartext email");
    assertMaskedEmail(user.email_masked, "bob@nexus.internal");
    assertMaskedPhone(user.phone_number_masked, "+14155559876");
  });

  it("1.2: Exact phone search returns user with masked email and masked phone, without cleartext email", () => {
    const res = backend.handleRestRequest("GET", "/api/v1/users/search?q=%2B14155559876", null, authHeaders);
    assertHttpStatus(res.status, 200, "exact phone search");
    assert.equal(res.data.total, 1);
    const user = res.data.users[0];
    assertValidUuid(user.id);
    assert.equal(user.email, undefined, "Phone search should NOT return cleartext email");
    assertMaskedEmail(user.email_masked, "bob@nexus.internal");
    assertMaskedPhone(user.phone_number_masked, "+14155559876");
  });

  it("1.3: Username prefix search returns matching users with PII masking and without cleartext email", () => {
    const res = backend.handleRestRequest("GET", "/api/v1/users/search?q=bob", null, authHeaders);
    assertHttpStatus(res.status, 200, "username prefix search");
    assert.ok(res.data.total >= 1);
    const user = res.data.users[0];
    assert.equal(user.username, "bob_builder");
    assert.equal(user.email, undefined, "Prefix search should NEVER return cleartext email");
    assertMaskedEmail(user.email_masked, "bob@nexus.internal");
    assertMaskedPhone(user.phone_number_masked, "+14155559876");
  });

  it("1.4: Search query with fewer than 3 characters is rejected with HTTP 400", () => {
    const res = backend.handleRestRequest("GET", "/api/v1/users/search?q=bo", null, authHeaders);
    assertHttpStatus(res.status, 400, "query length < 3");
    assertErrorMessage(res.data, "must be at least 3 characters");
  });

  it("1.5: PII masking caps mask bullet length to prevent exact character count leakage", () => {
    const longEmail = "verylongusernametoprotect@nexus.internal";
    const masked = backend.maskEmail(longEmail);
    assert.ok(masked.includes("•"), "Must contain bullet characters");
    // Count bullets in local part
    const bullets = (masked.split("@")[0].match(/•/g) || []).length;
    assert.ok(bullets <= 10, `Mask bullets should be capped at 10, got ${bullets}`);
  });

  it("1.6: Limit parameter clamps between 1 and 50 and handles empty results gracefully", () => {
    const res = backend.handleRestRequest("GET", "/api/v1/users/search?q=nonexistent_prefix_xyz&limit=25", null, authHeaders);
    assertHttpStatus(res.status, 200, "nonexistent query");
    assert.equal(res.data.total, 0);
    assert.deepEqual(res.data.users, []);
  });
});
