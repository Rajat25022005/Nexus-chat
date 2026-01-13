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

socket_app = socketio.ASGIApp(sio, socketio_path="socket.io")


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
    """Handle incoming messages from clients"""
    try:
        # Validate session
        session = await sio.get_session(sid)
        user = session.get("user")
        
        if not user:
            logger.warning(f"Message from unauthenticated user: {sid}")
            await sio.emit("error", {"message": "Not authenticated"}, room=sid)
            return

        # Validate message data
        if not data or "group_id" not in data or "chat_id" not in data or "content" not in data:
            logger.warning(f"Invalid message data from {sid}: {data}")
            await sio.emit("error", {"message": "Invalid message format"}, room=sid)
            return

        group_id = data["group_id"]
        chat_id = data["chat_id"]
        content = data["content"].strip()
        
        if not content:
            logger.warning(f"Empty message from {sid}")
            return

        room = f"{group_id}:{chat_id}"

        # Store user message
        try:
            messages = get_message_collection()
            messages.insert_one({
                "user_id": user,
                "group_id": group_id,
                "chat_id": chat_id,
                "role": "user",
                "content": content,
                "created_at": datetime.utcnow(),
            })
            logger.debug(f"Stored message from {user} in {room}")
        except Exception as e:
            logger.error(f"Failed to store message: {e}", exc_info=True)
            await sio.emit("error", {"message": "Failed to save message"}, room=sid)
            return

        # Broadcast user message to room
        await sio.emit(
            "new_message",
            {
                "role": "user",
                "content": content,
            },
            room=room,
        )

        # Trigger AI response in background
        asyncio.create_task(_generate_ai_response(user, group_id, chat_id, content, room))

    except Exception as e:
        logger.error(f"Error in send_message handler: {e}", exc_info=True)
        await sio.emit("error", {"message": "Failed to process message"}, room=sid)


async def _generate_ai_response(user: str, group_id: str, chat_id: str, content: str, room: str):
    """Generate AI response in background to avoid blocking"""
    try:
        # Emit typing indicator
        await sio.emit("typing", {}, room=room)
        
        # Import here to avoid circular imports
        from app.services.chat_service import process_chat_message
        
        # Fetch recent message history
        messages_col = get_message_collection()
        cursor = messages_col.find(
            {
                "user_id": user,
                "group_id": group_id,
                "chat_id": chat_id,
            },
            {"_id": 0, "role": 1, "content": 1}
        ).sort("created_at", -1).limit(10)
        
        history_list = []
        for msg in cursor:
            history_list.append({"role": msg["role"], "content": msg["content"]})
        history_list.reverse()  # Oldest first
        
        # Generate AI response
        answer, _ = await process_chat_message(
            user_query=content,
            group_id=group_id,
            chat_id=chat_id,
            user_email=user,
            history=history_list,
        )

        # Broadcast AI response
        await sio.emit(
            "new_message",
            {
                "role": "assistant",
                "content": answer,
            },
            room=room,
        )
        
        logger.debug(f"AI response sent to room: {room}")

    except Exception as e:
        logger.error(f"AI generation failed: {e}", exc_info=True)
        await sio.emit(
            "new_message",
            {
                "role": "assistant",
                "content": "Sorry, I encountered an error processing your request. Please try again.",
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
