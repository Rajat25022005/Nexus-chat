from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from app.auth.service import hash_password, verify_password, create_access_token
from app.core.mongo import get_db
from app.auth.dependencies import get_current_user
import random
import string

router = APIRouter(prefix="/auth", tags=["Auth"])


class SignupRequest(BaseModel):
    username: str | None = None
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    identifier: str
    password: str


@router.post("/signup")
def signup(data: SignupRequest):
    db = get_db()
    users = db.users

    if users.find_one({"email": data.email}):
        raise HTTPException(status_code=400, detail="User already exists")

    final_username = data.username

    if final_username:
        if users.find_one({"username": final_username}):
            raise HTTPException(status_code=400, detail="Username already exists")
    else:
        # Auto-generate username
        base_username = data.email.split("@")[0]
        final_username = base_username
        
        # Check for collision and append random suffix if needed
        while users.find_one({"username": final_username}):
            suffix = ''.join(random.choices(string.digits, k=4))
            final_username = f"{base_username}{suffix}"

    users.insert_one({
        "username": final_username,
        "email": data.email,
        "password_hash": hash_password(data.password),
    })

    token = create_access_token({"sub": data.email, "username": final_username})
    return {"access_token": token, "token_type": "bearer"}


@router.post("/login")
def login(data: LoginRequest):
    db = get_db()
    users = db.users

    # Find user by email OR username
    user = users.find_one({
        "$or": [
            {"email": data.identifier},
            {"username": data.identifier}
        ]
    })

    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    username = user.get("username", user["email"].split("@")[0])
    token = create_access_token({"sub": user["email"], "username": username})
    return {"access_token": token, "token_type": "bearer"}


class ProfileUpdateRequest(BaseModel):
    username: str | None = None
    email: EmailStr | None = None
    full_name: str | None = None
    bio: str | None = None


@router.put("/profile")
def update_profile(data: ProfileUpdateRequest, current_user: dict = Depends(get_current_user)):
    db = get_db()
    users = db.users
    
    update_fields = {}
    
    if data.email and data.email != current_user["email"]:
        if users.find_one({"email": data.email}):
            raise HTTPException(status_code=400, detail="Email already in use")
        update_fields["email"] = data.email
        
    if data.username and data.username != current_user.get("username"):
        if users.find_one({"username": data.username}):
            raise HTTPException(status_code=400, detail="Username already taken")
        update_fields["username"] = data.username

    if data.full_name is not None:
        update_fields["full_name"] = data.full_name

    if data.bio is not None:
        update_fields["bio"] = data.bio
        
    if not update_fields:
        return {"message": "No changes made"}
        
    users.update_one({"_id": current_user["_id"]}, {"$set": update_fields})
    
    # Generate new token with updated info
    new_email = update_fields.get("email", current_user["email"])
    new_username = update_fields.get("username", current_user.get("username"))
    new_full_name = update_fields.get("full_name", current_user.get("full_name"))
    new_bio = update_fields.get("bio", current_user.get("bio"))
    
    token = create_access_token({"sub": new_email, "username": new_username})
    
    return {
        "access_token": token, 
        "token_type": "bearer", 
        "user": {
            "email": new_email, 
            "username": new_username,
            "full_name": new_full_name,
            "bio": new_bio
        }
    }


@router.get("/me")
def get_me(current_user: dict = Depends(get_current_user)):
    return {
        "email": current_user["email"],
        "username": current_user.get("username"),
        "full_name": current_user.get("full_name"),
        "bio": current_user.get("bio")
    }
