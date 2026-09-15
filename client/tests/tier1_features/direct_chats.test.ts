import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockNexusBackend } from "../harness/mock_backend.ts";
import { createTestJwt } from "../harness/auth_helper.ts";
import {
  assertValidUuid,
  assertHttpStatus,
  assertErrorMessage,
} from "../harness/assertions.ts";

describe("Tier 1: Feature Coverage — Direct 1:1 Chats (/api/v1/chats/direct)", () => {
  const backend = new MockNexusBackend();
  const aliceId = "11111111-1111-4111-8111-111111111111";
  const bobId = "22222222-2222-4222-8222-222222222222";
  const carolId = "33333333-3333-4333-8333-333333333333";

  const aliceToken = createTestJwt({ user_id: aliceId });
  const aliceHeaders = { Authorization: `Bearer ${aliceToken}` };

  const bobToken = createTestJwt({ user_id: bobId });
  const bobHeaders = { Authorization: `Bearer ${bobToken}` };

  it("2.1: Initiating a new direct conversation returns HTTP 201 with is_new: true and recipient info", () => {
    const res = backend.handleRestRequest("POST", "/api/v1/chats/direct", { recipient_id: bobId }, aliceHeaders);
    assertHttpStatus(res.status, 201, "new direct chat");
    assert.equal(res.data.is_new, true);
    assertValidUuid(res.data.chat_id);
    assertValidUuid(res.data.direct_chat_id);
    assert.equal(res.data.recipient.id, bobId);
    assert.equal(res.data.recipient.display_name, "Bob Jones");
    assert.equal(res.data.recipient.username, "bob_builder");
  });

  it("2.2: Second initiation of the same direct conversation is idempotent (HTTP 200, is_new: false)", () => {
    // Bob calls with Alice as recipient
    const res = backend.handleRestRequest("POST", "/api/v1/chats/direct", { recipient_id: aliceId }, bobHeaders);
    assertHttpStatus(res.status, 200, "idempotent direct chat retrieval");
    assert.equal(res.data.is_new, false);
    assertValidUuid(res.data.chat_id);
    assert.equal(res.data.recipient.id, aliceId);
    assert.equal(res.data.recipient.display_name, "Alice Smith");
  });

  it("2.3: Canonical user ordering enforces user_a_id < user_b_id regardless of caller", () => {
    // Carol initiates with Alice
    const carolHeaders = { Authorization: `Bearer ${createTestJwt({ user_id: carolId })}` };
    const res = backend.handleRestRequest("POST", "/api/v1/chats/direct", { recipient_id: aliceId }, carolHeaders);
    assertHttpStatus(res.status, 201, "carol and alice chat");

    const record = Array.from(backend.directChats.values()).find(
      (dc) =>
        (dc.user_a_id === aliceId && dc.user_b_id === carolId) ||
        (dc.user_a_id === carolId && dc.user_b_id === aliceId)
    );
    assert.ok(record, "Direct chat record must exist");
    assert.ok(
      record.user_a_id < record.user_b_id,
      `Canonical constraint failed: ${record.user_a_id} should be < ${record.user_b_id}`
    );
  });

  it("2.4: Attempting to initiate a direct chat with oneself is rejected with HTTP 400", () => {
    const res = backend.handleRestRequest("POST", "/api/v1/chats/direct", { recipient_id: aliceId }, aliceHeaders);
    assertHttpStatus(res.status, 400, "self-chat attempt");
    assertErrorMessage(res.data, "cannot message yourself");
  });

  it("2.5: Blocked user cannot initiate conversation with the user who blocked them (HTTP 403)", () => {
    backend.blockedPairs.add(`${bobId}:${carolId}`);
    const res = backend.handleRestRequest("POST", "/api/v1/chats/direct", { recipient_id: bobId }, {
      Authorization: `Bearer ${createTestJwt({ user_id: carolId })}`,
    });
    assertHttpStatus(res.status, 403, "blocked user chat attempt");
    assertErrorMessage(res.data, "cannot initiate conversation with this user");
  });

  it("2.6: Non-existent recipient UUID returns HTTP 404", () => {
    const fakeId = "99999999-9999-4999-8999-999999999999";
    const res = backend.handleRestRequest("POST", "/api/v1/chats/direct", { recipient_id: fakeId }, aliceHeaders);
    assertHttpStatus(res.status, 404, "non-existent recipient");
    assertErrorMessage(res.data, "recipient not found");
  });
});
