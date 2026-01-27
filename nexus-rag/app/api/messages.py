from fastapi import APIRouter, Depends
from typing import List
from app.auth.dependencies import get_current_user
from app.core.mongo import get_message_collection
from datetime import datetime

router = APIRouter(prefix="/api/messages", tags=["Messages"])

@router.get("/{group_id}/{chat_id}")
def get_chat_messages(
    group_id: str,
    chat_id: str,
    user=Depends(get_current_user)
):
    messages_col = get_message_collection()

    cursor = messages_col.find(
        {
            "group_id": group_id,
            "chat_id": chat_id,
        }
    ).sort("created_at", 1)

    # Collect unique user IDs
    user_ids = list(set(msg["user_id"] for msg in cursor if msg.get("user_id")))
    
    # Fetch user details
    from app.core.mongo import get_db
    db = get_db()
    users_col = db.users
    users_cursor = users_col.find({"email": {"$in": user_ids}})
    
    user_map = {}
    image_map = {}
    for u in users_cursor:
        email = u.get("email")
        if email:
            is_private = u.get("is_private", False)
            if is_private:
                # Mask logic
                if email == user["email"]:
                    # Is Me: Show full details even if private
                    user_map[email] = u.get("full_name") or u.get("username") or email.split("@")[0]
                    image_map[email] = u.get("profile_image")
                else:
                    # Is Other Private User: Mask
                    uid_suffix = str(u["_id"])[-4:]
                    user_map[email] = f"User-{uid_suffix}"
                    image_map[email] = None 
            else:
                user_map[email] = u.get("full_name") or u.get("username") or email.split("@")[0]
                image_map[email] = u.get("profile_image")

    # Reset cursor or re-iterate if list consumed (cursor was consumed by set comprehension?)
    # Wait, 'cursor' in pymongo is iterable once. accessing it for set consumed it?
    # Actually, calling list(cursor) or iterating consumes it. 
    # The list comprehension `msg["user_id"] for msg in cursor` CONSUMED the cursor. 
    # I need to rewind or fetch again. Or simpler: fetch to list first.
    
    # Rewind implementation:
    cursor.rewind()
    
    messages = []
    for msg in cursor:
        sender_email = msg.get("user_id")
        
        # Determine display name
        display_name = user_map.get(sender_email)
        sender_image = image_map.get(sender_email)
            
        messages.append({
            "role": msg["role"],
            "content": msg["content"],
            "created_at": msg["created_at"],
            "sender": sender_email, 
            "sender_name": display_name, # Now populated from DB
            "sender_image": sender_image
        })

    return messages
