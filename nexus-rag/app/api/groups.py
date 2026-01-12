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
    chats: List[Chat] = []

class CreateGroupRequest(BaseModel):
    name: str

class CreateChatRequest(BaseModel):
    title: str

@router.get("", response_model=List[Group])
def get_user_groups(user=Depends(get_current_user)):
    db = get_db()
    
    # In a real app with proper schema, we would fetch from a 'groups' collection.
    # Since we are hacking this together or if the schema is implicit:
    # Let's assume there is a 'groups' collection. 
    # If not, we can simulate one or use the messages collection to infer.
    # But strictly, the frontend expects a list of groups.
    # Let's verify if there is a groups collection. 
    # Assuming standard behavior, let's look for "groups".
    
    # Update: Based on the issue that "cannot create group", it implies the backend doesn't support it.
    # So we should create the collection logic here.
    
    # Fetch explicit groups
    groups_cursor = db.groups.find({"user_id": user["email"]})
    
    groups = []
    for g in groups_cursor:
        chats = g.get("chats", [])
        groups.append(Group(
            id=str(g["_id"]),
            name=g["name"],
            chats=[Chat(id=c["id"], title=c["title"]) for c in chats]
        ))
    
    # Synthesize "Personal" group from message history
    messages_col = db.messages
    personal_chats = messages_col.aggregate([
        {"$match": {"user_id": user["email"], "group_id": "personal"}},
        {"$group": {"_id": "$chat_id"}},
    ])
    
    p_chats = []
    # If no chats found, default to 'general' so it matches frontend default
    found_chats = list(personal_chats)
    if not found_chats:
         p_chats.append(Chat(id="general", title="General"))
    else:
         for c in found_chats:
             # We don't store chat title for implicit personal chats, defaults to Chat ID or "General" if id is general
             cid = c["_id"]
             title = "General" if cid == "general" else f"Chat {cid[:4]}"
             p_chats.append(Chat(id=cid, title=title))
             
    # Add Personal group at the beginning
    groups.insert(0, Group(
        id="personal",
        name="Personal",
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
        "chats": [] # Start with no chats? Or a default one?
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
        chats=[Chat(**default_chat)]
    )

@router.post("/{group_id}/chats", response_model=Chat)
def create_chat(
    group_id: str,
    request: CreateChatRequest,
    user=Depends(get_current_user)
):
    import bson
    from bson.errors import InvalidId
    db = get_db()
    
    try:
        oid = bson.ObjectId(group_id)
        # Verify group ownership
        group = db.groups.find_one({"_id": oid, "user_id": user["email"]})
        if not group:
             raise HTTPException(status_code=404, detail="Group not found")

        new_chat_id = str(bson.ObjectId()) # Generate a new unique ID
        new_chat = {
            "id": new_chat_id,
            "title": request.title,
            "messages": [] # Initialize messages array
        }
        
        db.groups.update_one(
            {"_id": oid},
            {"$push": {"chats": new_chat}}
        )
        
        return Chat(**new_chat)

    except InvalidId:
        if group_id == "personal":
             # "Personal" is a virtual group on frontend. 
             # We should probably persist it if the user wants to add chats to it.
             # Or just reject it.
             # Let's reject for now and ask user to create a real group, 
             # OR map it to a "Personal" group in DB.
             
             # BETTER APPROACH: Find or Create a group named "Personal" for this user.
             personal_group = db.groups.find_one({"user_id": user["email"], "is_personal": True})
             
             if not personal_group:
                  # Create it
                  new_group = {
                    "user_id": user["email"],
                    "name": "Personal",
                    "is_personal": True,
                    "chats": []
                  }
                  result = db.groups.insert_one(new_group)
                  oid = result.inserted_id
             else:
                  oid = personal_group["_id"]
             
             # Now proceed to add chat
             new_chat_id = str(bson.ObjectId())
             new_chat = {
                "id": new_chat_id,
                "title": request.title,
                "messages": []
             }
            
             db.groups.update_one(
                {"_id": oid},
                {"$push": {"chats": new_chat}}
             )
             return Chat(**new_chat)
        
        raise HTTPException(status_code=400, detail="Invalid Group ID")
