import socketio
import asyncio
import logging
from jose import jwt
from datetime import datetime

from app.core.config import JWT_SECRET, JWT_ALGORITHM, ALLOWED_ORIGINS
from app.core.mongo import get_message_collection

logger = logging.getLogger(__name__)

# Create Socket.IO server with proper CORS configuration
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=ALLOWED_ORIGINS,
    logger=False,  # Use our own logger
    engineio_logger=False
)

socket_app = socketio.ASGIApp(sio, socketio_path="")


def decode_token(token: str):
    """Decode and validate JWT token"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload.get("sub")
    except Exception as e:
        logger.error(f"Token decode error: {e}")
        return None


@sio.event
async def connect(sid, environ, auth):
    """Handle client connection"""
    try:
        token = auth.get("token") if auth else None
        user = decode_token(token)

        if not user:
            logger.warning(f"Connection rejected - invalid token from {sid}")
            return False

        await sio.save_session(sid, {"user": user})
        logger.info(f"Socket connected: {user} (sid: {sid})")
        return True
        
    except Exception as e:
        logger.error(f"Error in connect handler: {e}", exc_info=True)
        return False


@sio.event
async def disconnect(sid):
    """Handle client disconnection"""
    try:
        session = await sio.get_session(sid)
        user = session.get("user", "unknown")
        logger.info(f"Socket disconnected: {user} (sid: {sid})")
    except Exception as e:
        logger.error(f"Error in disconnect handler: {e}", exc_info=True)


@sio.event
async def join_room(sid, data):
    """Handle room join requests"""
    try:
        if not data or "group_id" not in data or "chat_id" not in data:
            logger.warning(f"Invalid join_room data from {sid}: {data}")
            return
        
        room = f"{data['group_id']}:{data['chat_id']}"
        await sio.enter_room(sid, room)
        logger.debug(f"Client {sid} joined room: {room}")
        
    except Exception as e:
        logger.error(f"Error in join_room handler: {e}", exc_info=True)


@sio.event
async def leave_room(sid, data):
    """Handle room leave requests"""
    try:
        if not data or "group_id" not in data or "chat_id" not in data:
            logger.warning(f"Invalid leave_room data from {sid}: {data}")
            return
        
        room = f"{data['group_id']}:{data['chat_id']}"
        await sio.leave_room(sid, room)
        logger.debug(f"Client {sid} left room: {room}")
        
    except Exception as e:
        logger.error(f"Error in leave_room handler: {e}", exc_info=True)


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
            "sender": user,  # Add sender identity
        },
        room=room,
    )

    # Background: Embed and Store in Vector DB
    # We run this in background so we don't block the ACK to the client
    import asyncio
    async def ingest_message(txt, grp, cht, usr):
        try:
            from app.embeddings.embedder import embed_text
            from app.core.mongo import get_vector_collection
            
            # Format content with sender info for better retrieval context
            vector_content = f"User ({usr}): {txt}"
            embedding = embed_text(vector_content)
            
            vec_col = get_vector_collection()
            vec_col.insert_one({
                "group_id": grp,
                "chat_id": cht,
                "content": vector_content,
                "embedding": embedding,
                "created_at": datetime.utcnow(),
                "metadata": {"user_id": usr, "type": "chat_message"}
            })
            print(f"Message vectorized for {usr}")
        except Exception as e:
            print(f"Vector Ingest Error: {e}")

    # Fire and forget (or safer: explicit task ref)
    asyncio.create_task(ingest_message(content, group_id, chat_id, user))

    # Trigger AI Response ALWAYS unless disabled
    # (Previously it required "nexus" keyword)
    # Trigger AI Response ONLY if "nexus" keyword is present
    if not data.get("disable_ai") and "nexus" in content.lower():
        await sio.emit("typing", {}, room=room)
        
        from app.services.chat_service import process_chat_message
        
        # We need to fetch history if we want context-aware chat.
        # For now, let's pass an empty history or you could fetch it using get_message_collection.
        # To be efficient, we can fetch last 5 messages.
        messages_col = get_message_collection()
        cursor = messages_col.find(
            {
                "group_id": group_id,
                "chat_id": chat_id,
            },
            {"_id": 0, "role": 1, "content": 1, "user_id": 1}
        ).sort("created_at", -1).limit(30)
        
        history_list = []
        # Cursor is latest first, so reverse it
        for msg in cursor:
            # Pass user_id as sender if role is user
            sender = msg.get("user_id") if msg.get("role") == "user" else "Nexus AI"
            history_list.append({"role": msg["role"], "content": msg["content"], "sender": sender})
        history_list.reverse()
        print(f"DEBUG HISTORY: {history_list}")
        with open("debug_nexus_history.txt", "a") as f:
            f.write(f"\n--- {datetime.utcnow()} ---\n")
            f.write(str(history_list))
        
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
            with open("debug_nexus_error.txt", "a") as f:
                f.write(f"\n--- ERROR {datetime.utcnow()} ---\n")
                f.write(traceback.format_exc())
            
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
    """Handle typing indicators"""
    try:
        if not data or "group_id" not in data or "chat_id" not in data:
            return
        
        room = f"{data['group_id']}:{data['chat_id']}"
        await sio.emit("typing", {}, room=room, skip_sid=sid)
        
    except Exception as e:
        logger.error(f"Error in typing handler: {e}", exc_info=True)
