from datetime import datetime, timedelta, timezone
from app.core.mongo import get_db
from app.auth.otp_utils import generate_otp, hash_otp, send_email, verify_otp_hash
from fastapi import HTTPException
import logging

logger = logging.getLogger(__name__)

OTP_COLLECTION = "otps"
OTP_EXPIRY_MINUTES = 10
MAX_ATTEMPTS = 3

def create_otp(email: str, purpose: str):
    """
    Generate, hash, and save an OTP for the given email and purpose.
    Sends the OTP via email.
    """
    db = get_db()
    
    email = email.lower().strip()
    
    # Check rate limit/existing valid OTP? 
    # For now, just overwrite or allow multiple? 
    # Better to delete existing for this email+purpose to avoid clutter
    db[OTP_COLLECTION].delete_many({"email": email, "purpose": purpose})
    
    otp = generate_otp()
    hashed = hash_otp(otp)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRY_MINUTES)
    
    otp_doc = {
        "email": email,
        "otp_hash": hashed,
        "purpose": purpose,
        "attempts": 0,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc)
    }
    
    db[OTP_COLLECTION].insert_one(otp_doc)
    
    # Send Email
    subject = f"Your Verification Code for {purpose.title()} - Nexus Chat"
    body = f"Your verification code is: {otp}\n\nIt expires in {OTP_EXPIRY_MINUTES} minutes.\n\nIf you did not request this, please ignore."
    
    try:
        send_email(email, subject, body)
    except Exception as e:
        # If email fails, delete the OTP so user can try again
        db[OTP_COLLECTION].delete_one({"email": email, "purpose": purpose})
        raise HTTPException(status_code=500, detail="Failed to send email. Please try again.")
    
    return True

def verify_otp(email: str, otp: str, purpose: str):
    """
    Verify the provided OTP.
    Returns True if valid, raises HTTPException otherwise.
    """
    db = get_db()
    email = email.lower().strip()
    record = db[OTP_COLLECTION].find_one({"email": email, "purpose": purpose})
    
    if not record:
        logger.warning(f"Verify OTP failed for {email}: No record found")
        raise HTTPException(status_code=400, detail="No OTP found or it has expired.")
        
    if record["attempts"] >= MAX_ATTEMPTS:
        logger.warning(f"Verify OTP failed for {email}: Max attempts reached")
        db[OTP_COLLECTION].delete_one({"_id": record["_id"]})
        raise HTTPException(status_code=400, detail="Too many failed attempts. Request a new OTP.")
        
    if datetime.now(timezone.utc) > record["expires_at"].replace(tzinfo=timezone.utc):
        logger.warning(f"Verify OTP failed for {email}: Expired")
        db[OTP_COLLECTION].delete_one({"_id": record["_id"]})
        raise HTTPException(status_code=400, detail="OTP has expired.")
        
    if not verify_otp_hash(otp.strip(), record["otp_hash"]):
        logger.warning(f"Verify OTP failed for {email}: Hash mismatch")
        # Increment attempts
        db[OTP_COLLECTION].update_one(
            {"_id": record["_id"]},
            {"$inc": {"attempts": 1}}
        )
        raise HTTPException(status_code=400, detail="Invalid OTP")
        
    # Success: Delete OTP
    db[OTP_COLLECTION].delete_one({"_id": record["_id"]})
    return True

def ensure_otp_indexes():
    """Create TTL index for automatic expiration."""
    db = get_db()
    # Expire documents automatically after 'expires_at'
    # Actually, TTL indexes usually work on a specific date field + seconds. 
    # If we want it to vanish exactly at expires_at, we can set expireAfterSeconds=0 on indexes on 'expires_at' field
    db[OTP_COLLECTION].create_index("expires_at", expireAfterSeconds=0)
    db[OTP_COLLECTION].create_index([("email", 1), ("purpose", 1)])
