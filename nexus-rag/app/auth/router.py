from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from app.auth.service import hash_password, verify_password, create_access_token
from app.core.mongo import get_db

router = APIRouter(prefix="/auth", tags=["Auth"])


class SignupRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/signup")
def signup(data: SignupRequest):
    db = get_db()
    users = db.users

    if users.find_one({"email": data.email}):
        raise HTTPException(status_code=400, detail="User already exists")

    users.insert_one({
        "email": data.email,
        "password_hash": hash_password(data.password),
    })

    token = create_access_token({"sub": data.email})
    return {"access_token": token, "token_type": "bearer"}


@router.post("/login")
def login(data: LoginRequest):
    db = get_db()
    users = db.users

    user = users.find_one({"email": data.email})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token({"sub": user["email"]})
    return {"access_token": token, "token_type": "bearer"}
