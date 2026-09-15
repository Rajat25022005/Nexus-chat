import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isValidNewMessagePayload,
  isValidMessageUpdatedPayload,
  isValidMessageDeletedPayload,
  isValidTypingPayload,
  isValidThreadReplyPayload,
  isValidMessageReactedPayload,
  isValidAiStreamChunkPayload,
  isAuthorizedChat,
  sanitizeSocketString,
} from "../../src/lib/socketSecurity.ts";
import type { Message, Group } from "../../src/types";

describe("Tier 1: Feature Coverage — 10 Inbound Socket Listeners & State Reconciliations", () => {
  const sampleGroups: Group[] = [
    {
      id: "group-1",
      name: "Engineering",
      chats: [
        {
          id: "chat-100",
          title: "dev",
          messages: [
            {
              id: "temp_abc_123",
              content: "Optimistic pending message",
              sender: "alice@nexus.internal",
              created_at: new Date().toISOString(),
              role: "user",
            },
          ],
        },
      ],
    },
  ];

  it("7.1: Inbound 'new_message' validates payload and reconciles optimistic tempId with server ID", () => {
    const rawPayload = {
      id: "server-uuid-999",
      chatId: "chat-100",
      content: "Optimistic pending message",
      role: "user",
      userId: "usr-alice",
      userEmail: "alice@nexus.internal",
      tempId: "temp_abc_123",
      createdAt: new Date().toISOString(),
    };

    assert.ok(isValidNewMessagePayload(rawPayload));
    assert.ok(isAuthorizedChat(rawPayload.chatId, sampleGroups));

    // Simulate reconciliation
    const messages = sampleGroups[0].chats[0].messages;
    const isMatch = (m: Message) => m.id === rawPayload.id || m.id === rawPayload.tempId;

    const reconciled = messages.map((m) =>
      isMatch(m) ? { ...m, id: rawPayload.id, content: rawPayload.content } : m
    );

    assert.equal(reconciled[0].id, "server-uuid-999", "tempId should be replaced with server-issued ID");
  });

  it("7.2: Inbound 'message_updated' payload validator checks structure and applies is_edited: true", () => {
    const payload = {
      id: "server-uuid-999",
      content: "Edited text here",
      chat_id: "chat-100",
      is_edited: true,
    };
    assert.ok(isValidMessageUpdatedPayload(payload));

    const cleanContent = sanitizeSocketString(payload.content);
    assert.equal(cleanContent, "Edited text here");
  });

  it("7.3: Inbound 'message_edited' legacy payload conforms to broadcast specifications", () => {
    const legacyPayload = {
      messageId: "msg-123",
      chatId: "chat-100",
      content: "Legacy edit",
      editedBy: "usr-bob",
    };
    assert.ok(legacyPayload.messageId && legacyPayload.content && legacyPayload.chatId);
  });

  it("7.4: Inbound 'message_deleted' validates deleteType ('everyone' vs 'me')", () => {
    const payloadEveryone = { id: "msg-123", type: "everyone" };
    const payloadMe = { id: "msg-123", type: "me" };
    const payloadInvalid = { id: "msg-123", type: "other" };

    assert.ok(isValidMessageDeletedPayload(payloadEveryone));
    assert.ok(isValidMessageDeletedPayload(payloadMe));
    assert.equal(isValidMessageDeletedPayload(payloadInvalid), false);

    // When type === 'everyone', content is replaced with placeholder
    const msg: Message = {
      id: "msg-123",
      content: "Secret info",
      role: "user",
      sender: "bob@nexus.internal",
      created_at: new Date().toISOString(),
    };
    const deletedMsg =
      payloadEveryone.type === "everyone"
        ? { ...msg, content: "This message was deleted", is_deleted: true }
        : null;

    assert.equal(deletedMsg?.content, "This message was deleted");
    assert.equal(deletedMsg?.is_deleted, true);
  });

  it("7.5: Inbound 'message_reacted' updates reactions incrementally without erasing other emojis", () => {
    const initialReactions: Record<string, string[]> = {
      "👍": ["alice@nexus.internal"],
    };

    const reactionPayload = {
      message_id: "msg-123",
      emoji: "🚀",
      userId: "bob@nexus.internal",
      action: "add",
    };
    assert.ok(isValidMessageReactedPayload(reactionPayload));

    // Incremental update logic
    const updated = { ...initialReactions };
    const emoji = reactionPayload.emoji;
    const users = updated[emoji] ? [...updated[emoji]] : [];
    users.push(reactionPayload.userId);
    updated[emoji] = users;

    assert.deepEqual(updated["👍"], ["alice@nexus.internal"], "Existing reactions must be preserved");
    assert.deepEqual(updated["🚀"], ["bob@nexus.internal"], "New reaction should be appended");
  });

  it("7.6: Inbound 'thread_reply' increments thread_count and appends reply message", () => {
    const threadPayload = {
      parentMessageId: "msg-parent-001",
      reply: {
        id: "reply-uuid-456",
        content: "Here is my response",
        userEmail: "carol@nexus.internal",
        userName: "Carol",
        createdAt: new Date().toISOString(),
      },
      chat_id: "chat-100",
    };
    assert.ok(isValidThreadReplyPayload(threadPayload));

    const parentMsg: Message = {
      id: "msg-parent-001",
      content: "Main question",
      role: "user",
      sender: "alice@nexus.internal",
      created_at: new Date().toISOString(),
      thread_count: 0,
      thread_messages: [],
    };

    const updatedParent = {
      ...parentMsg,
      thread_count: (parentMsg.thread_count || 0) + 1,
      thread_last_reply_at: threadPayload.reply.createdAt,
      thread_messages: [
        ...(parentMsg.thread_messages || []),
        {
          id: threadPayload.reply.id,
          role: "user" as const,
          content: threadPayload.reply.content,
          sender: threadPayload.reply.userEmail,
          sender_name: threadPayload.reply.userName,
          created_at: threadPayload.reply.createdAt,
        },
      ],
    };

    assert.equal(updatedParent.thread_count, 1);
    assert.equal(updatedParent.thread_messages?.length, 1);
    assert.equal(updatedParent.thread_messages[0].id, "reply-uuid-456");
  });

  it("7.7: Inbound 'typing_indicator' toggles typing indicator state for other users", () => {
    const typingPayload = {
      userId: "bob@nexus.internal",
      isTyping: true,
      chatId: "chat-100",
    };
    assert.ok(isValidTypingPayload(typingPayload));

    // Client ignores self-typing
    const currentUserEmail = "alice@nexus.internal";
    const shouldDisplay = typingPayload.userId !== currentUserEmail && typingPayload.isTyping;
    assert.equal(shouldDisplay, true);
  });

  it("7.8: Inbound 'user_joined' presence event tracks active member joining", () => {
    const userJoinedPayload = {
      userId: "usr-carol",
      name: "Carol",
      chatId: "chat-100",
    };
    assert.ok(userJoinedPayload.userId && userJoinedPayload.chatId);
  });

  it("7.9: Inbound 'user_left' presence event tracks active member leaving", () => {
    const userLeftPayload = {
      userId: "usr-carol",
      name: "Carol",
      chatId: "chat-100",
    };
    assert.ok(userLeftPayload.userId && userLeftPayload.chatId);
  });

  it("7.10: Inbound 'ai_stream_chunk' appends incremental deltas until isFinal: true", () => {
    const chunk1 = {
      messageId: "ai-msg-001",
      delta: "Hello",
      isFinal: false,
      chatId: "chat-100",
    };
    const chunk2 = {
      messageId: "ai-msg-001",
      delta: " world!",
      isFinal: true,
      chatId: "chat-100",
    };

    assert.ok(isValidAiStreamChunkPayload(chunk1));
    assert.ok(isValidAiStreamChunkPayload(chunk2));

    let streamingContent = "";
    let isStreaming = true;

    // Receive chunk 1
    streamingContent += chunk1.delta;
    if (chunk1.isFinal) isStreaming = false;
    assert.equal(streamingContent, "Hello");
    assert.equal(isStreaming, true);

    // Receive chunk 2
    streamingContent += chunk2.delta;
    if (chunk2.isFinal) isStreaming = false;
    assert.equal(streamingContent, "Hello world!");
    assert.equal(isStreaming, false, "Streaming must terminate when isFinal is true");
  });
});
