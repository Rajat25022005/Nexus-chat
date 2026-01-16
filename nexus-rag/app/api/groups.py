from fastapi import APIRouter, Depends, HTTPException, Body
from typing import List
from pydantic import BaseModel, Field
from app.auth.dependencies import get_current_user
from app.core.mongo import get_db

router = APIRouter(prefix="/api/groups", tags=["Groups"])

class Chat(BaseModel):
    id: str
    title: str

class Group(BaseModel):
    id: str
    name: str
    user_id: str  # Owner
    members: List[str] = []
    chats: List[Chat] = []

class CreateGroupRequest(BaseModel):
    name: str

class CreateChatRequest(BaseModel):
    title: str

@router.get("", response_model=List[Group])
def get_user_groups(user=Depends(get_current_user)):
    db = get_db()
    
    # Fetch groups where user is the owner OR a member
    # Backward compatibility: user_id field for owner
    # New model: members list containing email
    groups_cursor = db.groups.find({
        "$or": [
            {"user_id": user["email"]},
            {"members": user["email"]}
        ]
    })
    
    groups = []
    for g in groups_cursor:
        chats = g.get("chats", [])
        groups.append(Group(
            id=str(g["_id"]),
            name=g["name"],
            user_id=g.get("user_id", ""),
            members=g.get("members", []),
            chats=[Chat(id=c["id"], title=c["title"]) for c in chats]
        ))
    
    # Synthesize "Personal" group from message history
    personal_group_id = f"personal_{user['email']}"
    messages_col = db.messages
    personal_chats = messages_col.aggregate([
        {"$match": {"user_id": user["email"], "group_id": personal_group_id}},
        {"$group": {"_id": "$chat_id"}},
    ])
    
    p_chats = []
    # If no chats found, default to 'general' so it matches frontend default
    found_chats = list(personal_chats)
    if not found_chats:
         p_chats.append(Chat(id="general", title="General"))
    else:
         for c in found_chats:
             cid = c["_id"]
             title = "General" if cid == "general" else f"Chat {cid[:4]}"
             p_chats.append(Chat(id=cid, title=title))
             
    # Add Personal group at the beginning
    groups.insert(0, Group(
        id=personal_group_id,
        name="Personal",
        user_id=user["email"], # Personal group owned by user
        members=[user["email"]],
        chats=p_chats
    ))

    return groups

@router.post("", response_model=Group)
def create_group(
    request: CreateGroupRequest,
    user=Depends(get_current_user)
):
    db = get_db()
    
    new_group = {
        "user_id": user["email"],
        "name": request.name,
        "members": [user["email"]], # Initialize members
        "chats": []
    }
    
    result = db.groups.insert_one(new_group)
    
    # Add a default chat?
    default_chat_id = "general"
    default_chat = {"id": default_chat_id, "title": "General"}
    
    db.groups.update_one(
        {"_id": result.inserted_id},
        {"$push": {"chats": default_chat}}
    )
    
    return Group(
        id=str(result.inserted_id),
        name=request.name,
        user_id=user["email"],
        members=[user["email"]],
        chats=[Chat(**default_chat)]
    )

@router.delete("/{group_id}")
def delete_group(
    group_id: str,
    user=Depends(get_current_user)
):
    import bson
    from bson.errors import InvalidId
    db = get_db()

    # Cannot delete Personal Group Root (it's virtual/persistent)
    if group_id.startswith("personal_"):
        raise HTTPException(status_code=400, detail="Cannot delete Personal space")

    try:
        oid = bson.ObjectId(group_id)
        # Check ownership
        group = db.groups.find_one({"_id": oid})
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        if group.get("user_id") != user["email"]:
             raise HTTPException(status_code=403, detail="Only the owner can delete this group")

        # Delete Group
        db.groups.delete_one({"_id": oid})
        
        # Delete associated messages
        db.messages.delete_many({"group_id": group_id})
        
        return {"status": "deleted", "group_id": group_id}

    except InvalidId:
        raise HTTPException(status_code=400, detail="Invalid Group ID")

@router.post("/{group_id}/chats", response_model=Chat)
def create_chat(
    group_id: str,
    request: CreateChatRequest,
    user=Depends(get_current_user)
):
    import bson
    from bson.errors import InvalidId
    db = get_db()
    
    # Logic for Personal Group
    personal_group_id = f"personal_{user['email']}"
    if group_id == personal_group_id:
        personal_group = db.groups.find_one({"user_id": user["email"], "is_personal": True})
        
        if not personal_group:
            new_group = {
                "user_id": user["email"],
                "name": "Personal",
                "is_personal": True,
                "chats": [],
                "members": [user["email"]]
            }
            result = db.groups.insert_one(new_group)
            oid = result.inserted_id
        else:
            oid = personal_group["_id"]
            
    # Logic for Regular Group
    else:
        try:
            oid = bson.ObjectId(group_id)
        except InvalidId:
            raise HTTPException(status_code=400, detail="Invalid Group ID")
            
        group = db.groups.find_one({
            "_id": oid, 
            "$or": [
                {"user_id": user["email"]},
                {"members": user["email"]}
            ]
        })
        if not group:
             raise HTTPException(status_code=404, detail="Group not found or access denied")

    # Common: Create and Push Chat
    new_chat_id = str(bson.ObjectId())
    new_chat = {
        "id": new_chat_id,
        "title": request.title
    }
    
    db.groups.update_one(
        {"_id": oid},
        {"$push": {"chats": new_chat}}
    )
    
    return Chat(id=new_chat_id, title=request.title)

@router.delete("/{group_id}/chats/{chat_id}")
def delete_chat(
    group_id: str,
    chat_id: str,
    user=Depends(get_current_user)
):
    import bson
    from bson.errors import InvalidId
    db = get_db()
    
    personal_group_id = f"personal_{user['email']}"
    
    if group_id == personal_group_id:
        # For Personal, we just delete messages. 
        # (We don't really have a 'chat' object unless it was implicitly created in 'chats' list of the personal group doc?
        # Actually logic for personal is synthetic usually, BUT create_chat ADDS it to the persistent doc if is_personal=True.
        # So we should remove it from there too if it exists.)
        
        # 1. Delete messages
        db.messages.delete_many({"group_id": group_id, "chat_id": chat_id})
        
        # 2. Try to pull from Personal Group doc if it exists
        personal_group = db.groups.find_one({"user_id": user["email"], "is_personal": True})
        if personal_group:
             db.groups.update_one(
                {"_id": personal_group["_id"]},
                {"$pull": {"chats": {"id": chat_id}}}
            )
        
        return {"status": "deleted", "chat_id": chat_id}

    else:
        # Regular Group
        try:
            oid = bson.ObjectId(group_id)
            group = db.groups.find_one({"_id": oid})
            if not group:
                raise HTTPException(status_code=404, detail="Group not found")
            
            # Allow owner to delete any chat. 
            # (Optionally: allow chat creator to delete their chat? But we track user_id on Group, not explicitly on Chat object in list)
            # Sticking to Group Owner requirement for now.
            if group.get("user_id") != user["email"]:
                 raise HTTPException(status_code=403, detail="Only the group owner can delete chats")

            # 1. Pull from chats array
            db.groups.update_one(
                {"_id": oid},
                {"$pull": {"chats": {"id": chat_id}}}
            )
            
            # 2. Delete messages
            db.messages.delete_many({"group_id": group_id, "chat_id": chat_id})

            return {"status": "deleted", "chat_id": chat_id}

        except InvalidId:
            raise HTTPException(status_code=400, detail="Invalid Group ID")


@router.post("/join")
def join_group(
    group_id: str = Body(..., embed=True),
    user=Depends(get_current_user)
):
    import bson
    from bson.errors import InvalidId
    db = get_db()
    
    try:
        oid = bson.ObjectId(group_id)
        group = db.groups.find_one({"_id": oid})
        
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
            
        # Add user to members if not already present
        if user["email"] not in group.get("members", []):
            db.groups.update_one(
                {"_id": oid},
                {"$addToSet": {"members": user["email"]}}
            )
            
        return {"status": "joined", "group_id": group_id, "name": group["name"]}

    except InvalidId:
        raise HTTPException(status_code=400, detail="Invalid Group ID")
