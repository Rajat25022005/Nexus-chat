import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";
import {
  assertHttpStatus,
  assertErrorMessage,
  assertCrockfordBase32,
} from "../harness/assertions.ts";

describe("Tier 1: Feature Coverage — Workspace Invites (/api/groups/join)", () => {
  const backend = new MockNexusBackend();
  const newUserId = "33333333-3333-4333-8333-333333333333"; // Carol
  const authHeaders = { Authorization: `Bearer ${createTestJwt({ user_id: newUserId })}` };
  const validCode = "NX7K-Q2R9";

  it("4.1: Join workspace group with valid Crockford Base-32 code succeeds (HTTP 200)", () => {
    assertCrockfordBase32(validCode);
    const res = backend.handleRestRequest("POST", "/api/groups/join", { code: validCode }, authHeaders);
    assertHttpStatus(res.status, 200, "join group with valid code");
    assert.equal(res.data.group.name, "General Workspace");
    assert.ok(Array.isArray(res.data.group.members));
    assert.ok(Array.isArray(res.data.group.chats));
  });

  it("4.2: Code normalization handles lowercase and whitespace without error", () => {
    const res = backend.handleRestRequest("POST", "/api/groups/join", { code: "  nx7k-q2r9  " }, authHeaders);
    assertHttpStatus(res.status, 200, "lowercase code normalization");
    assert.equal(res.data.group.name, "General Workspace");
  });

  it("4.3: Caller user_id is appended to group.members list upon successful join", () => {
    const group = backend.groups.get("group-general-uuid");
    assert.ok(group?.members.includes(newUserId), "User should be in group members roster");
  });

  it("4.4: Non-existent or expired invite code is rejected with HTTP 404", () => {
    const res = backend.handleRestRequest("POST", "/api/groups/join", { code: "INVALID-CODE" }, authHeaders);
    assertHttpStatus(res.status, 404, "invalid code");
    assertErrorMessage(res.data, "invalid or expired invite code");
  });

  it("4.5: Empty invite code payload is rejected with HTTP 400", () => {
    const res = backend.handleRestRequest("POST", "/api/groups/join", { code: "" }, authHeaders);
    assertHttpStatus(res.status, 400, "empty code");
    assertErrorMessage(res.data, "invite code is required");
  });
});
