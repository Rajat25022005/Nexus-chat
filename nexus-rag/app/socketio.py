import socketio
from jose import jwt
from app.core.config import JWT_SECRET, JWT_ALGORITHM
from datetime import datetime
from app.core.mongo import get_message_collection

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=[
        "https://nexus-backend-453285339762.europe-west1.run.app",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174"
    ],
)

socket_app = socketio.ASGIApp(sio, socketio_path="socket.io")


def decode_token(token: str):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload.get("sub")
    except Exception:
        return None


@sio.event
async def connect(sid, environ, auth):
    token = auth.get("token") if auth else None
    user = decode_token(token)

    if not user:
        return False

    await sio.save_session(sid, {"user": user})
    print(f"Socket connected: {user}")


@sio.event
async def disconnect(sid):
    print(f"Socket disconnected: {sid}")


@sio.event
async def join_room(sid, data):
    room = f"{data['group_id']}:{data['chat_id']}"
    await sio.enter_room(sid, room)


@sio.event
async def leave_room(sid, data):
    room = f"{data['group_id']}:{data['chat_id']}"
    await sio.leave_room(sid, room)


@sio.event
async def send_message(sid, data):
    session = await sio.get_session(sid)
    user = session["user"]

    group_id = data["group_id"]
    chat_id = data["chat_id"]
    content = data["content"]

    room = f"{group_id}:{chat_id}"

    # store message
    messages = get_message_collection()
    messages.insert_one({
        "user_id": user,
        "group_id": group_id,
        "chat_id": chat_id,
        "role": "user",
        "content": content,
        "created_at": datetime.utcnow(),
    })

    # broadcast
    await sio.emit(
        "new_message",
        {
            "role": "user",
            "content": content,
        },
        room=room,
    )

    # Trigger AI Response ONLY if not disabled
    if not data.get("disable_ai"):
        await sio.emit("typing", {}, room=room)
        
        from app.services.chat_service import process_chat_message
        
        # We need to fetch history if we want context-aware chat.
        # For now, let's pass an empty history or you could fetch it using get_message_collection.
        # To be efficient, we can fetch last 5 messages.
        messages_col = get_message_collection()
        cursor = messages_col.find(
            {
                "user_id": user,
                "group_id": group_id,
                "chat_id": chat_id,
            },
            {"_id": 0, "role": 1, "content": 1}
        ).sort("created_at", -1).limit(5)
        
        history_list = []
        # Cursor is latest first, so reverse it
        for msg in cursor:
            history_list.append({"role": msg["role"], "content": msg["content"]})
        history_list.reverse()
        
        try:
            answer, _ = await process_chat_message(
                user_query=content,
                group_id=group_id,
                chat_id=chat_id,
                user_email=user, # user is 'sub' (email) from token
                history=history_list,
            )

            await sio.emit(
                "new_message",
                {
                    "role": "assistant",
                    "content": answer,
                },
                room=room,
            )
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"AI Generation failed: {e}")
            await sio.emit(
                "new_message",
                {
                    "role": "assistant",
                    "content": "Sorry, I encountered an error processing your request.",
                },
                room=room,
            )


@sio.event
async def typing(sid, data):
    room = f"{data['group_id']}:{data['chat_id']}"
    await sio.emit("typing", {}, room=room, skip_sid=sid)
