# Project: Nexus Chat Frontend Audit & Parity

## Architecture
- **Frontend**: React 19 SPA (Vite + Rolldown, TypeScript, Tailwind CSS, Lucide icons, glassmorphism theme) located at `client/`.
- **Backend REST API**: Go 1.25 Gin API (`services/nexus-api/`) handling authentication, user discovery (`/api/v1/users/search`), direct 1-on-1 chats (`/api/v1/chats/direct`), MinIO S3 object uploads/downloads (`/api/v1/files/`), workspaces, and groups (`/api/groups/join`).
- **Real-Time Gateway**: Elixir/Bandit Socket.IO v4 gateway (`services/nexus-socket/`) providing Engine.IO v4 / Socket.IO v4 transport, channel routing, Delta-CRDT presence (`Phoenix.Tracker`), and AI token streaming (`ai_stream_chunk`).
- **Data Flow**:
  1. Client sends JWT token from `localStorage` in Socket.IO v4 auth handshake `{ token }`.
  2. Direct 1-on-1 conversations initiated via `POST /api/v1/chats/direct` are rendered in collapsible sidebar with active presence.
  3. Real-time events (`send_message`, `edit_message`, `delete_message`, `react_message`, `typing_start`, `typing_stop`, `get_online_users`) flow bidirectionally with atomic ACKs and incremental delta reconciliations.
  4. File attachments up to 50MB follow two-phase S3 pre-signed upload (`presign-upload` -> PUT -> `confirm-upload`) with inline markdown rendering and secure download link refresh.

## Feature Inventory
Every feature from user requirements and the Phase 0 Survey:
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | User Discovery UI | Search users by username prefix, email, and phone with PII masking via modal and ⌘K Command Palette | M1 | ORIGINAL_REQUEST §R1 |
| 2 | Direct 1:1 Chats | Initiate, switch to, and render direct chats under collapsible "Direct Messages" in sidebar with presence | M1 | ORIGINAL_REQUEST §R1 |
| 3 | S3 Attachment Upload & Download | 50MB file upload with progress tracking, error states, inline markdown rendering, and download URL refresh | M1 | ORIGINAL_REQUEST §R1 |
| 4 | Workspace Invite Codes | Enter and validate Crockford base-32 invite codes cleanly in UI, align owner_id with backend | M1 | ORIGINAL_REQUEST §R1 |
| 5 | Socket.IO v4 Auth Handshake | Connect using JWT from localStorage with clean connection error handling | M1 | ORIGINAL_REQUEST §R2 |
| 6 | Outbound Socket Events | Emit 10 outbound events: join_chat, leave_chat, send_message, edit_message, delete_message, react_message, send_thread_reply, typing_start, typing_stop, get_online_users | M1 | ORIGINAL_REQUEST §R2 |
| 7 | Inbound Socket Listeners | Listen to 10 inbound events: new_message, message_updated, message_edited, message_deleted, message_reacted, thread_reply, typing_indicator, user_joined, user_left, ai_stream_chunk | M1 | ORIGINAL_REQUEST §R2 |
| 8 | Optimistic State & ACK Reconciliation | Reconcile optimistic `tempId` with server-issued `messageId` on ACK, handle delivery failures | M1 | ORIGINAL_REQUEST §R2 |
| 9 | Real-Time Typing Indicators | Debounced typing_start / typing_stop with contextual typing indicators in active chat | M1 | ORIGINAL_REQUEST §R2 |
| 10 | Presence Synchronization | Synchronize online/offline state via Phoenix.Tracker events (user_joined, user_left) | M1 | ORIGINAL_REQUEST §R2 |
| 11 | AI Stream Chunk Appending | Append incremental token deltas without overwriting message content | M1 | Survey Finding |
| 12 | Incremental Reaction Updating | Update reactions incrementally on add/remove action without erasing existing reactions | M1 | Survey Finding |
| 13 | Strict TypeScript Quality | Pass strict mode type-check (0 errors) fixing all implicit-any and type mismatches | M1 | ORIGINAL_REQUEST §R3 |
| 14 | Production Vite Build | Clean production build (`tsc -b && vite build`) with exit code 0 | M1 | ORIGINAL_REQUEST §R3 |
| 15 | ESLint Compliance | Clean ESLint run (`npm run lint`) with 0 warnings and 0 errors | M1 | ORIGINAL_REQUEST §R3 |
| 16 | Glassmorphism & Themes | Consistent glassmorphism CSS theme across dark/light modes with inline FOUC prevention | M1 | ORIGINAL_REQUEST §R3 |
| 17 | Keyboard Accessibility & ⌘K | Global Command Palette (⌘K) in App.tsx with Theme toggle, User Search, and full modal a11y | M1 | ORIGINAL_REQUEST §R3 |
| 18 | E2E Parity & Regression Suite | Complete opaque-box test suite (Tiers 1-4 + Tier 5 adversarial) verifying 100% pass rate | M2 | Project Architecture |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Frontend Parity & Quality Implementation | Features 1-17: REST API parity, Real-Time Socket parity & bugfixes, Strict TypeScript fixes, ⌘K global elevation, theme/a11y hardening | none | IN_PROGRESS |
| M2 | E2E Test Suite Pass & Adversarial Hardening | Feature 18: Pass 100% of E2E test suite (Tiers 1-4) published via TEST_READY.md and Tier 5 adversarial coverage | M1 | PLANNED |

## Interface Contracts

### 1. User Discovery
- Endpoint: `GET /api/v1/users/search?q={query}&limit={limit}`
- Request Headers: `Authorization: Bearer <jwt_token>`
- Response:
  ```json
  {
    "users": [
      {
        "id": "uuid",
        "username": "string | null",
        "display_name": "string",
        "avatar_url": "string",
        "email": "string (only on exact email search)",
        "email_masked": "s••••••••••r@nexus.internal",
        "phone_number_masked": "+1 ••• ••• 2671",
        "created_at": "ISO-8601"
      }
    ],
    "total": 1
  }
  ```

### 2. Direct 1-on-1 Chats
- Endpoint: `POST /api/v1/chats/direct`
- Request: `{ "recipient_id": "uuid" }`
- Response:
  ```json
  {
    "chat_id": "uuid",
    "direct_chat_id": "uuid",
    "recipient": {
      "id": "uuid",
      "display_name": "string",
      "username": "string | null",
      "avatar_url": "string"
    },
    "created_at": "ISO-8601",
    "is_new": true
  }
  ```

### 3. File Downloads
- Endpoint: `GET /api/v1/files/:id/download`
- Response: `{ "file_id": "uuid", "download_url": "https://...", "expires_in": 900 }`

### 4. Socket.IO Events
- **Auth**: `io(URL, { auth: { token } })`
- **send_message**: Client emits `{ chatId, groupId, content, role, tempId, replyTo }`. Server ACK: `{ success: true, messageId: "uuid", status: "ok" }`.
- **ai_stream_chunk**: Server broadcasts `{ chatId, messageId, delta, isFinal }`. Client appends `delta`.
- **react_message**: Client emits `{ messageId, emoji, action: "add" | "remove", groupId, chatId }`. Server broadcasts `{ messageId, emoji, userId, action }`. Client updates `reactions[emoji]` set.
- **typing_start / typing_stop**: Client emits `{ chatId, groupId }`. Server broadcasts `typing_indicator` `{ chatId, userId, userName, isTyping: true/false }`.
- **presence**: Server broadcasts `user_joined` `{ chatId, userId, userName }` and `user_left` `{ chatId, userId, userName }`. `get_online_users` returns `%{ "users" => [...] }`.

## Code Layout
- `client/src/api/`: REST API clients (`client.ts`, `discovery.ts`, `directChats.ts`, `files.ts`, `query.ts`, `auth.ts`, `config.ts`)
- `client/src/socket.ts`: Socket.IO client instance and authentication setup
- `client/src/hooks/`: React hooks (`useSocket.ts`, `useMessages.ts`, `useGroups.ts`, `useToast.ts`)
- `client/src/chat/`: Core chat UI components (`ChatLayout.tsx`, `Sidebar.tsx`, `ChatHeader.tsx`, `MessageList.tsx`, `MessageInput.tsx`, `MessageBubble.tsx`, `ThreadPanel.tsx`)
- `client/src/components/`: Modals and reusable UI (`CommandPalette.tsx`, `UserSearchModal.tsx`, `Modal.tsx`, `GroupDetailsModal.tsx`, `ui/`)
- `client/src/context/`: Context providers (`WorkspaceContext.tsx`)
- `client/src/stores/`: Zustand stores (`authStore.ts`, `themeStore.ts`)
- `client/tests/`: Opaque-box E2E test suite (Tiers 1-4 + Tier 5)
