from fastapi import APIRouter, Depends
from app.auth.dependencies import get_current_user
from app.core.mongo import get_message_collection

router = APIRouter(prefix="/api", tags=["History"])

@router.get("/history")
def get_chat_history(
    group_id: str,
    chat_id: str,
    user=Depends(get_current_user),
):
    messages_col = get_message_collection()

    cursor = messages_col.find(
        {
            "user_id": user["email"],
            "group_id": group_id,
            "chat_id": chat_id,
        },
        {"_id": 0, "role": 1, "content": 1, "created_at": 1},
    ).sort("created_at", 1)

    return list(cursor)
