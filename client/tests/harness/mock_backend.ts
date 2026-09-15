import crypto from "node:crypto";
import { verifyTestJwt } from "./auth_helper.ts";

export interface UserRecord {
  id: string;
  username?: string;
  display_name: string;
  email: string;
  phone_number?: string;
  avatar_url?: string;
  created_at: string;
}

export interface DirectChatRecord {
  id: string;
  chat_id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
}

export interface FileMetadataRecord {
  id: string;
  uploader_id: string;
  chat_id?: string;
  bucket: string;
  object_key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  status: "pending" | "active" | "deleted";
  etag?: string;
  created_at: string;
  expires_in?: number;
}

export interface GroupRecord {
  id: string;
  name: string;
  invite_code: string;
  tenant_id: string;
  workspace_id: string;
  members: string[]; // user IDs
  chats: { id: string; title: string }[];
}

export type SocketEventHandler = (...args: unknown[]) => void;

export class MockNexusBackend {
  public users: Map<string, UserRecord> = new Map();
  public directChats: Map<string, DirectChatRecord> = new Map();
  public files: Map<string, FileMetadataRecord> = new Map();
  public groups: Map<string, GroupRecord> = new Map();
  public blockedPairs: Set<string> = new Set(); // "userA:userB"
  public activeRooms: Map<string, Set<string>> = new Map(); // "chatId" -> Set of socketIds
  public socketSessions: Map<string, MockSocketConnection> = new Map(); // socketId -> Connection

  constructor() {
    this.seedDefaultData();
  }

  public reset(): void {
    this.users.clear();
    this.directChats.clear();
    this.files.clear();
    this.groups.clear();
    this.blockedPairs.clear();
    this.activeRooms.clear();
    this.socketSessions.clear();
    this.seedDefaultData();
  }

  private seedDefaultData(): void {
    // Seed users
    const alice: UserRecord = {
      id: "11111111-1111-4111-8111-111111111111",
      username: "alice_crypto",
      display_name: "Alice Smith",
      email: "alice@nexus.internal",
      phone_number: "+14155552671",
      avatar_url: "/avatars/alice.png",
      created_at: new Date().toISOString(),
    };

    const bob: UserRecord = {
      id: "22222222-2222-4222-8222-222222222222",
      username: "bob_builder",
      display_name: "Bob Jones",
      email: "bob@nexus.internal",
      phone_number: "+14155559876",
      avatar_url: "/avatars/bob.png",
      created_at: new Date().toISOString(),
    };

    const carol: UserRecord = {
      id: "33333333-3333-4333-8333-333333333333",
      username: "carol_dev",
      display_name: "Carol Danvers",
      email: "carol@nexus.internal",
      phone_number: "+14155551234",
      created_at: new Date().toISOString(),
    };

    this.users.set(alice.id, alice);
    this.users.set(bob.id, bob);
    this.users.set(carol.id, carol);

    // Seed group with Crockford Base-32 code
    const group: GroupRecord = {
      id: "group-general-uuid",
      name: "General Workspace",
      invite_code: "NX7K-Q2R9",
      tenant_id: "tenant-001",
      workspace_id: "ws-001",
      members: [alice.id, bob.id],
      chats: [{ id: "chat-general-001", title: "general" }],
    };
    this.groups.set(group.id, group);
  }

  // --- REST API Simulator ---

  public handleRestRequest(
    method: string,
    url: string,
    body: Record<string, unknown> | null = null,
    headers: Record<string, string> = {}
  ): { status: number; data: Record<string, unknown> } {
    const authHeader = headers["Authorization"] || headers["authorization"] || "";
    let caller: UserRecord | null = null;

    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      const decoded = verifyTestJwt(token);
      if (decoded && decoded.payload && decoded.payload.user_id) {
        // Expiration check
        const now = Math.floor(Date.now() / 1000);
        if (decoded.payload.exp && decoded.payload.exp < now) {
          return { status: 401, data: { error: "token expired" } };
        }
        caller = this.users.get(decoded.payload.user_id) || {
          id: decoded.payload.user_id,
          display_name: decoded.payload.name || "Caller",
          email: decoded.payload.email || "caller@nexus.internal",
          created_at: new Date().toISOString(),
        };
      }
    }

    const [pathname, search] = url.split("?");
    const searchParams = new URLSearchParams(search || "");

    // 1. GET /api/v1/users/search
    if (method === "GET" && pathname === "/api/v1/users/search") {
      if (!caller) return { status: 401, data: { error: "unauthorized" } };

      const query = (searchParams.get("q") || "").trim();
      if (query.length < 3) {
        return { status: 400, data: { error: "search query must be at least 3 characters" } };
      }

      const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10", 10), 1), 50);

      // A. Exact Email (contains @)
      if (query.includes("@")) {
        const found = Array.from(this.users.values()).find(
          (u) => u.email.toLowerCase() === query.toLowerCase() && u.id !== caller?.id
        );
        if (!found) return { status: 200, data: { users: [], total: 0 } };

        return {
          status: 200,
          data: {
            users: [
              {
                id: found.id,
                username: found.username || null,
                display_name: found.display_name,
                avatar_url: found.avatar_url || "",
                email: found.email, // Cleartext included ONLY for exact email
                email_masked: this.maskEmail(found.email),
                phone_number_masked: found.phone_number ? this.maskPhone(found.phone_number) : undefined,
                created_at: found.created_at,
              },
            ],
            total: 1,
          },
        };
      }

      // B. Exact Phone (starts with +)
      if (query.startsWith("+")) {
        const found = Array.from(this.users.values()).find(
          (u) => u.phone_number === query && u.id !== caller?.id
        );
        if (!found) return { status: 200, data: { users: [], total: 0 } };

        return {
          status: 200,
          data: {
            users: [
              {
                id: found.id,
                username: found.username || null,
                display_name: found.display_name,
                avatar_url: found.avatar_url || "",
                email_masked: this.maskEmail(found.email),
                phone_number_masked: found.phone_number ? this.maskPhone(found.phone_number) : undefined,
                created_at: found.created_at,
              },
            ],
            total: 1,
          },
        };
      }

      // C. Username Prefix
      const validPrefixRegex = /^[a-zA-Z0-9_-]{3,30}$/;
      if (!validPrefixRegex.test(query)) {
        return {
          status: 400,
          data: {
            error:
              "invalid username search query: must contain only alphanumeric characters, underscores, or hyphens (3-30 characters)",
          },
        };
      }

      const matches = Array.from(this.users.values())
        .filter(
          (u) =>
            u.id !== caller?.id &&
            u.username &&
            u.username.toLowerCase().startsWith(query.toLowerCase())
        )
        .slice(0, limit)
        .map((u) => ({
          id: u.id,
          username: u.username || null,
          display_name: u.display_name,
          avatar_url: u.avatar_url || "",
          email_masked: this.maskEmail(u.email),
          phone_number_masked: u.phone_number ? this.maskPhone(u.phone_number) : undefined,
          created_at: u.created_at,
        }));

      return {
        status: 200,
        data: {
          users: matches,
          total: matches.length,
        },
      };
    }

    // 2. POST /api/v1/chats/direct
    if (method === "POST" && pathname === "/api/v1/chats/direct") {
      if (!caller) return { status: 401, data: { error: "unauthorized" } };

      const recipientId = body?.recipient_id as string | undefined;
      if (!recipientId) return { status: 400, data: { error: "recipient_id is required" } };

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(recipientId)) {
        return { status: 400, data: { error: "invalid recipient_id format" } };
      }

      if (recipientId === caller.id) {
        return { status: 400, data: { error: "cannot message yourself" } };
      }

      const recipient = this.users.get(recipientId);
      if (!recipient) {
        return { status: 404, data: { error: "recipient not found" } };
      }

      const blockKey1 = `${caller.id}:${recipientId}`;
      const blockKey2 = `${recipientId}:${caller.id}`;
      if (this.blockedPairs.has(blockKey1) || this.blockedPairs.has(blockKey2)) {
        return { status: 403, data: { error: "cannot initiate conversation with this user" } };
      }

      // Canonical pair: userA < userB
      const [userA, userB] = caller.id < recipientId ? [caller.id, recipientId] : [recipientId, caller.id];

      const existing = Array.from(this.directChats.values()).find(
        (dc) => dc.user_a_id === userA && dc.user_b_id === userB
      );

      if (existing) {
        return {
          status: 200,
          data: {
            chat_id: existing.chat_id,
            direct_chat_id: existing.id,
            recipient: {
              id: recipient.id,
              display_name: recipient.display_name,
              username: recipient.username || null,
              avatar_url: recipient.avatar_url || "",
            },
            created_at: existing.created_at,
            is_new: false,
          },
        };
      }

      const newDirectChat: DirectChatRecord = {
        id: crypto.randomUUID(),
        chat_id: crypto.randomUUID(),
        user_a_id: userA,
        user_b_id: userB,
        created_at: new Date().toISOString(),
      };
      this.directChats.set(newDirectChat.id, newDirectChat);

      return {
        status: 201,
        data: {
          chat_id: newDirectChat.chat_id,
          direct_chat_id: newDirectChat.id,
          recipient: {
            id: recipient.id,
            display_name: recipient.display_name,
            username: recipient.username || null,
            avatar_url: recipient.avatar_url || "",
          },
          created_at: newDirectChat.created_at,
          is_new: true,
        },
      };
    }

    // 3. POST /api/v1/files/presign-upload
    if (method === "POST" && pathname === "/api/v1/files/presign-upload") {
      if (!caller) return { status: 401, data: { error: "unauthorized" } };

      const fileName = body?.file_name as string | undefined;
      const contentType = body?.content_type as string | undefined;
      const sizeBytes = body?.size_bytes as number | undefined;
      const purpose = body?.purpose as string | undefined;
      const chatId = body?.chat_id as string | undefined;

      if (!fileName || !contentType || sizeBytes === undefined || !purpose) {
        return { status: 400, data: { error: "missing required upload parameters" } };
      }

      const MAX_AVATAR = 5 * 1024 * 1024; // 5 MB
      const MAX_ATTACHMENT = 50 * 1024 * 1024; // 50 MB

      if (purpose === "avatar") {
        const allowedAvatars = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        if (!allowedAvatars.includes(contentType.toLowerCase())) {
          return { status: 400, data: { error: "invalid content_type for avatar" } };
        }
        if (sizeBytes <= 0 || sizeBytes > MAX_AVATAR) {
          return { status: 400, data: { error: "file size exceeds maximum allowed for avatar (5MB)" } };
        }

        const fileId = crypto.randomUUID();
        const objectKey = `avatars/${caller.id}/${fileId}_${fileName}`;
        const record: FileMetadataRecord = {
          id: fileId,
          uploader_id: caller.id,
          bucket: "nexus-avatars",
          object_key: objectKey,
          file_name: fileName,
          content_type: contentType,
          size_bytes: sizeBytes,
          status: "pending",
          created_at: new Date().toISOString(),
        };
        this.files.set(fileId, record);

        return {
          status: 201,
          data: {
            file_id: fileId,
            upload_url: `https://storage.nexus.internal/nexus-avatars/${objectKey}?sig=test`,
            object_key: objectKey,
            bucket: "nexus-avatars",
            expires_in: 900,
          },
        };
      } else if (purpose === "attachment") {
        if (!chatId) {
          return { status: 400, data: { error: "chat_id is required for attachments" } };
        }
        // Reject executables and SVGs/HTML
        const disallowed = ["image/svg+xml", "text/html", "application/x-sh", "application/x-msdownload"];
        if (disallowed.includes(contentType.toLowerCase())) {
          return { status: 400, data: { error: `unsupported attachment content_type '${contentType}'` } };
        }
        if (sizeBytes <= 0 || sizeBytes > MAX_ATTACHMENT) {
          return { status: 400, data: { error: "file size exceeds maximum allowed for attachment (50MB)" } };
        }

        const fileId = crypto.randomUUID();
        const objectKey = `attachments/${chatId}/${fileId}_${fileName}`;
        const record: FileMetadataRecord = {
          id: fileId,
          uploader_id: caller.id,
          chat_id: chatId,
          bucket: "nexus-attachments",
          object_key: objectKey,
          file_name: fileName,
          content_type: contentType,
          size_bytes: sizeBytes,
          status: "pending",
          created_at: new Date().toISOString(),
        };
        this.files.set(fileId, record);

        return {
          status: 201,
          data: {
            file_id: fileId,
            upload_url: `https://storage.nexus.internal/nexus-attachments/${objectKey}?sig=test`,
            object_key: objectKey,
            bucket: "nexus-attachments",
            expires_in: 900,
          },
        };
      }

      return { status: 400, data: { error: "purpose must be either 'avatar' or 'attachment'" } };
    }

    // 4. POST /api/v1/files/confirm-upload
    if (method === "POST" && pathname === "/api/v1/files/confirm-upload") {
      if (!caller) return { status: 401, data: { error: "unauthorized" } };

      const fileId = body?.file_id as string | undefined;
      if (!fileId) return { status: 400, data: { error: "file_id is required" } };

      const file = this.files.get(fileId);
      if (!file) return { status: 404, data: { error: "file not found" } };
      if (file.uploader_id !== caller.id) return { status: 403, data: { error: "forbidden" } };

      file.status = "active";
      file.etag = `"mock-etag-${Date.now()}"`;

      const downloadUrl = `https://storage.nexus.internal/${file.bucket}/${file.object_key}?download=1`;

      return {
        status: 200,
        data: {
          file_id: file.id,
          status: "active",
          file_name: file.file_name,
          content_type: file.content_type,
          size_bytes: file.size_bytes,
          etag: file.etag,
          download_url: downloadUrl,
          expires_in: 900,
        },
      };
    }

    // 5. GET /api/v1/files/:id/download
    if (method === "GET" && pathname.startsWith("/api/v1/files/") && pathname.endsWith("/download")) {
      if (!caller) return { status: 401, data: { error: "unauthorized" } };

      const parts = pathname.split("/");
      const fileId = parts[parts.length - 2];
      const file = this.files.get(fileId);
      if (!file || file.status !== "active") {
        return { status: 404, data: { error: "file not found or not active" } };
      }

      const downloadUrl = `https://storage.nexus.internal/${file.bucket}/${file.object_key}?token=valid`;
      return {
        status: 200,
        data: {
          file_id: file.id,
          file_name: file.file_name,
          download_url: downloadUrl,
          expires_in: 900,
        },
      };
    }

    // 6. POST /api/groups/join
    if (method === "POST" && pathname === "/api/groups/join") {
      if (!caller) return { status: 401, data: { error: "unauthorized" } };

      const rawCode = (body?.code as string | undefined) || "";
      const code = rawCode.toUpperCase().trim();
      if (!code) return { status: 400, data: { error: "invite code is required" } };

      const group = Array.from(this.groups.values()).find(
        (g) => g.invite_code.toUpperCase().replace(/-/g, "") === code.replace(/-/g, "")
      );

      if (!group) {
        return { status: 404, data: { error: "invalid or expired invite code" } };
      }

      if (!group.members.includes(caller.id)) {
        group.members.push(caller.id);
      }

      return {
        status: 200,
        data: {
          group: {
            id: group.id,
            name: group.name,
            members: group.members,
            chats: group.chats,
          },
        },
      };
    }

    return { status: 404, data: { error: `route not found: ${method} ${pathname}` } };
  }

  // --- Helpers for PII masking ---
  public maskEmail(email: string): string {
    const parts = email.split("@");
    if (parts.length !== 2 || !parts[0]) return "•••••";
    const [local, domain] = parts;
    if (local.length <= 2) return local[0] + "•••@" + domain;
    const maskLen = Math.min(local.length - 2, 10);
    return `${local[0]}${"•".repeat(maskLen)}${local[local.length - 1]}@${domain}`;
  }

  public maskPhone(phone: string): string {
    const clean = phone.trim();
    if (clean.length < 7) return "••• ••• ••••";
    const cc = clean.slice(0, 2);
    const last4 = clean.slice(-4);
    return `${cc} ••• ••• ${last4}`;
  }

  // --- Socket.IO Gateway Simulator ---

  public connectSocket(token: string | null): MockSocketConnection {
    const socketId = "sock_" + crypto.randomUUID();
    const conn = new MockSocketConnection(socketId, this, token);
    this.socketSessions.set(socketId, conn);
    return conn;
  }

  public broadcastToRoom(chatId: string, event: string, payload: Record<string, unknown>): void {
    const roomSockets = this.activeRooms.get(chatId) || new Set();
    for (const sockId of roomSockets) {
      const conn = this.socketSessions.get(sockId);
      if (conn && conn.connected) {
        conn.triggerInboundEvent(event, payload);
      }
    }
  }
}

/**
 * In-memory client connection simulator that replicates Engine.IO + Socket.IO v4 semantics.
 */
export class MockSocketConnection {
  public id: string;
  public backend: MockNexusBackend;
  public token: string | null;
  public connected: boolean = false;
  public user: UserRecord | null = null;
  public joinedRooms: Set<string> = new Set();
  private listeners: Map<string, Set<SocketEventHandler>> = new Map();

  constructor(id: string, backend: MockNexusBackend, token: string | null) {
    this.id = id;
    this.backend = backend;
    this.token = token;
    this.performHandshake();
  }

  private performHandshake(): void {
    if (!this.token) {
      this.connected = false;
      setTimeout(() => this.triggerInboundEvent("connect_error", new Error("Authentication token required")), 5);
      return;
    }

    const decoded = verifyTestJwt(this.token);
    if (!decoded || !decoded.payload || !decoded.payload.user_id) {
      this.connected = false;
      setTimeout(() => this.triggerInboundEvent("connect_error", new Error("Invalid or malformed token")), 5);
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    if (decoded.payload.exp && decoded.payload.exp < now) {
      this.connected = false;
      setTimeout(() => this.triggerInboundEvent("connect_error", new Error("Token expired")), 5);
      return;
    }

    this.user = this.backend.users.get(decoded.payload.user_id) || {
      id: decoded.payload.user_id,
      display_name: decoded.payload.name || "Test Socket User",
      email: decoded.payload.email || "socket@nexus.internal",
      created_at: new Date().toISOString(),
    };

    this.connected = true;
    setTimeout(() => this.triggerInboundEvent("connect", { sid: this.id }), 5);
  }

  public on(event: string, fn: SocketEventHandler): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn);
    return this;
  }

  public off(event: string, fn?: SocketEventHandler): this {
    if (!fn) {
      this.listeners.delete(event);
    } else {
      this.listeners.get(event)?.delete(fn);
    }
    return this;
  }

  public triggerInboundEvent(event: string, payload: unknown): void {
    const fns = this.listeners.get(event);
    if (fns) {
      for (const fn of fns) {
        try {
          fn(payload);
        } catch (e) {
          console.error(`Error in event listener for ${event}:`, e);
        }
      }
    }
  }

  /**
   * Client emits outbound Socket.IO event.
   */
  public emit(event: string, payload: Record<string, unknown> | null = null, ackCb?: SocketEventHandler): void {
    if (!this.connected) {
      if (ackCb) ackCb({ error: "socket not connected" });
      return;
    }

    const user = this.user!;

    switch (event) {
      case "join_chat": {
        const chatId = payload?.chatId as string | undefined;
        if (chatId) {
          this.joinedRooms.add(chatId);
          if (!this.backend.activeRooms.has(chatId)) {
            this.backend.activeRooms.set(chatId, new Set());
          }
          this.backend.activeRooms.get(chatId)!.add(this.id);

          this.backend.broadcastToRoom(chatId, "user_joined", {
            userId: user.id,
            name: user.display_name,
            chatId,
          });
        }
        break;
      }

      case "leave_chat": {
        const chatId = payload?.chatId as string | undefined;
        if (chatId) {
          this.joinedRooms.delete(chatId);
          this.backend.activeRooms.get(chatId)?.delete(this.id);

          this.backend.broadcastToRoom(chatId, "user_left", {
            userId: user.id,
            name: user.display_name,
            chatId,
          });
        }
        break;
      }

      case "send_message": {
        const chatId = payload?.chatId as string | undefined;
        const content = payload?.content as string | undefined;
        const tempId = payload?.tempId as string | undefined;
        const triggerAI = payload?.triggerAI as boolean | undefined;
        const replyTo = payload?.replyTo;

        if (!chatId || typeof content !== "string" || !content.trim()) {
          if (ackCb) ackCb({ success: false, error: "chatId and non-empty content are required" });
          return;
        }

        const messageId = crypto.randomUUID();
        const nowIso = new Date().toISOString();

        const msgPayload: Record<string, unknown> = {
          id: messageId,
          chatId,
          content,
          role: "user",
          userId: user.id,
          userEmail: user.email,
          userName: user.display_name,
          createdAt: nowIso,
          tempId,
          replyTo,
        };

        this.backend.broadcastToRoom(chatId, "new_message", msgPayload);

        if (triggerAI) {
          this.backend.broadcastToRoom(chatId, "typing_indicator", {
            userId: "ai-assistant",
            name: "Nexus AI",
            chatId,
            isTyping: true,
          });
        }

        if (ackCb) {
          ackCb({
            success: true,
            messageId,
            status: "ok",
          });
        }
        break;
      }

      case "edit_message": {
        const messageId = payload?.messageId as string | undefined;
        const chatId = payload?.chatId as string | undefined;
        const content = payload?.content as string | undefined;

        if (!messageId || !chatId || typeof content !== "string" || !content.trim()) {
          if (ackCb) ackCb({ success: false, error: "messageId, chatId, and non-empty content required" });
          return;
        }

        this.backend.broadcastToRoom(chatId, "message_updated", {
          id: messageId,
          content,
          chat_id: chatId,
          is_edited: true,
        });

        this.backend.broadcastToRoom(chatId, "message_edited", {
          messageId,
          chatId,
          content,
          editedBy: user.id,
        });

        if (ackCb) ackCb({ success: true });
        break;
      }

      case "delete_message": {
        const messageId = payload?.messageId as string | undefined;
        const chatId = payload?.chatId as string | undefined;
        const deleteType = (payload?.deleteType as string | undefined) || "everyone";

        if (!messageId || !chatId) {
          if (ackCb) ackCb({ success: false, error: "messageId and chatId required" });
          return;
        }

        this.backend.broadcastToRoom(chatId, "message_deleted", {
          id: messageId,
          messageId,
          type: deleteType,
          chatId,
          deletedBy: user.id,
        });

        if (ackCb) ackCb({ success: true });
        break;
      }

      case "react_message": {
        const messageId = payload?.messageId as string | undefined;
        const chatId = payload?.chatId as string | undefined;
        const emoji = payload?.emoji as string | undefined;
        const action = (payload?.action as string | undefined) || "add";

        if (!messageId || !chatId || !emoji) {
          if (ackCb) ackCb({ success: false, error: "messageId, chatId, and emoji required" });
          return;
        }

        this.backend.broadcastToRoom(chatId, "message_reacted", {
          messageId,
          emoji,
          userId: user.email,
          action,
        });

        if (ackCb) ackCb({ success: true, action });
        break;
      }

      case "send_thread_reply": {
        const parentMessageId = payload?.parentMessageId as string | undefined;
        const chatId = payload?.chatId as string | undefined;
        const content = payload?.content as string | undefined;
        const tempId = payload?.tempId as string | undefined;

        if (!parentMessageId || !chatId || typeof content !== "string" || !content.trim()) {
          if (ackCb) ackCb({ success: false, error: "parentMessageId, chatId, and content required" });
          return;
        }

        const replyId = crypto.randomUUID();
        const replyData: Record<string, unknown> = {
          id: replyId,
          tempId,
          content,
          userId: user.id,
          userEmail: user.email,
          userName: user.display_name,
          createdAt: new Date().toISOString(),
        };

        this.backend.broadcastToRoom(chatId, "thread_reply", {
          parentMessageId,
          reply: replyData,
        });

        if (ackCb) ackCb({ success: true, replyId });
        break;
      }

      case "typing_start": {
        const chatId = payload?.chatId as string | undefined;
        if (chatId) {
          this.backend.broadcastToRoom(chatId, "typing_indicator", {
            isTyping: true,
            userId: user.id,
            name: user.display_name,
            chatId,
          });
        }
        break;
      }

      case "typing_stop": {
        const chatId = payload?.chatId as string | undefined;
        if (chatId) {
          this.backend.broadcastToRoom(chatId, "typing_indicator", {
            isTyping: false,
            userId: user.id,
            name: user.display_name,
            chatId,
          });
        }
        break;
      }

      case "get_online_users": {
        const chatId = payload?.chatId as string | undefined;
        const roomSockets = chatId ? this.backend.activeRooms.get(chatId) || new Set() : new Set();
        const onlineUsers = Array.from(roomSockets)
          .map((sId) => this.backend.socketSessions.get(sId)?.user)
          .filter(Boolean)
          .map((u) => ({ id: u!.id, name: u!.display_name, email: u!.email }));

        if (ackCb) ackCb({ users: onlineUsers });
        break;
      }

      default:
        // Gracefully ignore unknown events
        break;
    }
  }

  public disconnect(): void {
    this.connected = false;
    for (const chatId of this.joinedRooms) {
      this.backend.activeRooms.get(chatId)?.delete(this.id);
      this.backend.broadcastToRoom(chatId, "user_left", {
        userId: this.user?.id,
        name: this.user?.display_name,
        chatId,
      });
    }
    this.joinedRooms.clear();
    this.backend.socketSessions.delete(this.id);
    this.triggerInboundEvent("disconnect", "io client disconnect");
  }
}
