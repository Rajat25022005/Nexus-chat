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
            "user_id": user["email"], 
            "group_id": group_id,
            "chat_id": chat_id,
        }
    ).sort("created_at", 1)

    messages = []
    for msg in cursor:
        messages.append({
            "role": msg["role"],
            "content": msg["content"],
            "created_at": msg["created_at"],
        })

    return messages
