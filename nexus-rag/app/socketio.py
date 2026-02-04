import socketio
import asyncio
import logging
from jose import jwt
from datetime import datetime
import random
import string

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
            
        print(f"DEBUG: Socket connected for user {user} (sid: {sid})")

        # Fetch full user details from DB to get name/username
        from app.core.mongo import get_users_collection
        users = get_users_collection()
        user_doc = users.find_one({"email": user})
        
        username = user_doc.get("username", user.split("@")[0]) if user_doc else user.split("@")[0]
        full_name = user_doc.get("full_name") if user_doc else None
        is_private = user_doc.get("is_private", False) if user_doc else False
        profile_image = user_doc.get("profile_image") if user_doc else None
        
        await sio.save_session(sid, {
            "user": user,
            "username": username,
            "full_name": full_name,
            "is_private": is_private,
            "profile_image": profile_image
        })
        logger.info(f"Socket connected: {user} ({username}) [Private: {is_private}] (sid: {sid})")
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
    # Fetch fresh user data to get updated profile image
    from app.core.mongo import get_users_collection
    users_col = get_users_collection()
    user_doc = users_col.find_one({"email": user})
    
    if user_doc:
        full_name = user_doc.get("full_name")
        username = user_doc.get("username", user.split("@")[0])
        is_private = user_doc.get("is_private", False)
        profile_image = user_doc.get("profile_image")
    else:
        # Fallback to session if DB fail? Rare.
        username = session.get("username")
        full_name = session.get("full_name")
        is_private = session.get("is_private", False)
        profile_image = session.get("profile_image")

    # Determine display name (for Chat Bubble)
    sender_name = full_name if full_name else username
    if not sender_name:
        sender_name = user # Default to email if nothing else
        
    if is_private:
        # Mask the name if account is private
        if "anon_id" not in session:
           suffix = ''.join(random.choices(string.digits, k=4))
           session["anon_id"] = f"User-{suffix}"
           await sio.save_session(sid, session)
        
        sender_name = session["anon_id"]
        # Hide avatar if private
        profile_image = None
    
    sender_image = profile_image

    # Determine identity for AI Context (User requested AI to access full name)
    ai_context_name = full_name if full_name else username
    if not ai_context_name:
        ai_context_name = user

    group_id = data["group_id"]
    chat_id = data["chat_id"]
    content = data["content"]

    room = f"{group_id}:{chat_id}"

    reply_to = data.get("replyTo")
    print(f"DEBUG: Received message with replyTo: {reply_to}")

    # store message
    messages = get_message_collection()
    message_doc = {
        "user_id": user,
        "group_id": group_id,
        "chat_id": chat_id,
        "role": "user",
        "content": content,
        "sender_name": sender_name,  # Store display name
        "created_at": datetime.utcnow(),
    }
    
    if reply_to:
        message_doc["replyTo"] = reply_to

    messages.insert_one(message_doc)

    # broadcast
    emit_data = {
        "role": "user",
        "content": content,
        "sender": user,  # Keep email for identity
        "sender_name": sender_name,  # Add display name
        "sender_image": sender_image, # Add display image
        "id": str(message_doc["_id"]) # CRITICAL: Return DB ID so client can delete/reference it
    }
    
    if reply_to:
        emit_data["replyTo"] = reply_to

    await sio.emit(
        "new_message",
        emit_data,
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

    # Trigger AI Response ONLY if explicitly requested
    if data.get("trigger_ai"):
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
            reply_to_context = None
            if reply_to:
                # reply_to is a dict {id, sender, content}
                reply_to_context = f"Replying to {reply_to.get('sender', 'Unknown')}: {reply_to.get('content', '')}"
                print(f"DEBUG: Generated reply_to_context: {reply_to_context}")

            answer, _ = await process_chat_message(
                user_query=content,
                group_id=group_id,
                chat_id=chat_id,
                user_email=user, # Keep email for unique ID
                user_name=ai_context_name, # Pass full name for AI context
                history=history_list,
                reply_to_context=reply_to_context
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
@sio.event
async def delete_message(sid, data):
    """Handle message deletion"""
    try:
        session = await sio.get_session(sid)
        user = session["user"]
        
        message_id = data.get("message_id")
        delete_type = data.get("delete_type") # "everyone" or "me"
        group_id = data.get("group_id")
        chat_id = data.get("chat_id")
        
        if not all([message_id, delete_type, group_id, chat_id]):
            return

        from app.core.mongo import get_message_collection
        from bson import ObjectId
        messages = get_message_collection()
        
        room = f"{group_id}:{chat_id}"
        
        if delete_type == "everyone":
            # Verify sender
            msg = messages.find_one({"_id": ObjectId(message_id)})
            if not msg:
                return
                
            if msg.get("user_id") != user:
                # Unauthorized
                return

            # Update DB
            messages.update_one(
                {"_id": ObjectId(message_id)},
                {
                    "$set": {
                        "content": "This message was deleted",
                        "is_deleted": True,
                        "replyTo": None # Remove reply reference if deleted
                    }
                }
            )
            
            # Broadcast to everyone
            await sio.emit("message_deleted", {
                "id": message_id,
                "type": "everyone",
                "chat_id": chat_id,
                "group_id": group_id
            }, room=room)
            
        elif delete_type == "me":
            # Add user to deleted_for array
            messages.update_one(
                {"_id": ObjectId(message_id)},
                {"$addToSet": {"deleted_for": user}}
            )
            
            # Emit only to sender (using sid directly)
            await sio.emit("message_deleted", {
                "id": message_id,
                "type": "me",
                "chat_id": chat_id,
                "group_id": group_id
            }, room=sid)

    except Exception as e:
        logger.error(f"Error in delete_message: {e}", exc_info=True)


@sio.event
async def edit_message(sid, data):
    """Handle message editing"""
    try:
        session = await sio.get_session(sid)
        user = session["user"]
        
        message_id = data.get("message_id")
        new_content = data.get("content")
        group_id = data.get("group_id")
        chat_id = data.get("chat_id")
        
        if not all([message_id, new_content, group_id, chat_id]):
            return

        from app.core.mongo import get_message_collection
        from bson import ObjectId
        messages = get_message_collection()
        
        room = f"{group_id}:{chat_id}"
        
        # Verify sender
        msg = messages.find_one({"_id": ObjectId(message_id)})
        if not msg:
            return
            
        if msg.get("user_id") != user:
            # Unauthorized
            return

        # Update DB
        messages.update_one(
            {"_id": ObjectId(message_id)},
            {
                "$set": {
                    "content": new_content,
                    "is_edited": True,
                    "updated_at": datetime.utcnow()
                }
            }
        )
        
        # Broadcast to everyone
        await sio.emit("message_updated", {
            "id": message_id,
            "content": new_content,
            "is_edited": True,
            "chat_id": chat_id,
            "group_id": group_id
        }, room=room)

    except Exception as e:
        logger.error(f"Error in edit_message: {e}", exc_info=True)
