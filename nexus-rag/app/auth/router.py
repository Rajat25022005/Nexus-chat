from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request
from pydantic import BaseModel, EmailStr
from app.auth.service import hash_password, verify_password, create_access_token
from app.core.mongo import get_db
from app.auth.dependencies import get_current_user
from app.auth.oauth import oauth
from app.core.config import ALLOWED_ORIGINS
import random
import string
import shutil
import os
import logging
from pathlib import Path

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
    is_private: bool | None = None


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

    if data.is_private is not None:
        update_fields["is_private"] = data.is_private
        
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
        "bio": current_user.get("bio"),
        "is_private": current_user.get("is_private", False),
        "profile_image": current_user.get("profile_image")
    }


@router.post("/profile/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    # Validation
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    # Create valid filename
    file_ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    filename = f"user_{current_user['_id']}_avatar.{file_ext}"
    
    # Ensure directory exists (redundant with main.py but safe)
    upload_dir = Path("app/static/avatars")
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    file_path = upload_dir / filename
    
    logger = logging.getLogger(__name__)
    logger.info(f"Upload request from user: {current_user.get('email')} ({current_user.get('_id')})")
    
    # Save file
    try:
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        logger.info(f"File saved to: {file_path}")
    except Exception as e:
        logger.error(f"File save error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save image: {e}")
        
    # URL to access
    avatar_url = f"/static/avatars/{filename}"
    
    # Update DB
    db = get_db()
    result = db.users.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"profile_image": avatar_url}}
    )
    logger.info(f"DB Update Result - Matched: {result.matched_count}, Modified: {result.modified_count} for URL: {avatar_url}")
    
    return {"message": "Avatar uploaded successfully", "profile_image": avatar_url}


@router.get("/login/{provider}")
async def oauth_login(provider: str, request: Request):
    # Calculate callback URL using the request headers or hardcoded path
    # In production, ensure this matches Google Console configuration
    redirect_uri = request.url_for('oauth_callback', provider=provider)
    return await oauth.create_client(provider).authorize_redirect(request, redirect_uri)


@router.get("/callback/{provider}")
async def oauth_callback(provider: str, request: Request):
    try:
        token = await oauth.create_client(provider).authorize_access_token(request)
    except Exception as e:
        # If something fails (e.g. user cancels), redirect to login with error
        return JSONResponse({"error": str(e)}, status_code=400)
        
    user_info = token.get('userinfo')
    if not user_info:
        # Provide fallback if userinfo not in token (depends on scope)
        client = oauth.create_client(provider)
        resp = await client.get('https://www.googleapis.com/oauth2/v3/userinfo', token=token)
        user_info = resp.json()
    
    email = user_info.get('email')
    name = user_info.get('name')
    picture = user_info.get('picture')
    
    if not email:
         raise HTTPException(status_code=400, detail="Email not provided by provider")
         
    db = get_db()
    users = db.users
    
    user = users.find_one({"email": email})
    
    if not user:
        # Create new user
        # Generate a random base username from email
        base_username = email.split("@")[0]
        final_username = base_username
        
        # Handle collision
        while users.find_one({"username": final_username}):
            suffix = ''.join(random.choices(string.digits, k=4))
            final_username = f"{base_username}{suffix}"
            
        # Create user with random password (they can't login with password unless they reset it)
        # We assume email is verified since it comes from Google
        new_user = {
            "username": final_username,
            "email": email,
            "full_name": name,
            "profile_image": picture,
            "password_hash": hash_password(''.join(random.choices(string.ascii_letters + string.digits, k=32))),
            "auth_provider": provider
        }
        users.insert_one(new_user)
        user = new_user
    else:
        # Update profile picture if not set locally
        if picture and not user.get("profile_image"):
             users.update_one({"_id": user["_id"]}, {"$set": {"profile_image": picture}})
        # Update provider info
        users.update_one({"_id": user["_id"]}, {"$set": {"auth_provider": provider}})

    # Generate JWT
    username = user.get("username", user["email"].split("@")[0])
    access_token = create_access_token({"sub": user["email"], "username": username})
    
    # Redirect to frontend
    # We need to decide where to redirect. Ideally, to the frontend app.
    # For now, we'll try to determine the frontend URL or default to localhost:5173
    # A cleaner way is to pass a 'next' param or similar, but for now we hardcode the most likely dev port
    # or use the first allowed origin.
    
    frontend_url = "http://localhost:5173"
    # Attempt to pick a matching origin from ALLOWED_ORIGINS if possible, but it's tricky without a Referer
    if ALLOWED_ORIGINS:
         frontend_url = ALLOWED_ORIGINS[0] # Default to first one
    
    # Check if header referer is in allowed origins
    referer = request.headers.get("referer")
    if referer:
        for origin in ALLOWED_ORIGINS:
            if origin in referer:
                frontend_url = origin
                break
                
    response = JSONResponse({"status": "ok"})
    response.status_code = 302
    response.headers["Location"] = f"{frontend_url}/auth/callback?token={access_token}"
    return response
