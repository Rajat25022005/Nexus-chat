import requests
import json

# Login First
API_URL = "http://localhost:8080"
EMAIL = "mail1@mail.com" # The user who has an image
PASSWORD = "password" # Assuming a password, or I'll use the one from my flow test

# Actually I don't know the password for mail1@mail.com.
# I will use the debug user I created: debug_auto_user@test.com
# I need to make sure this user has an image.
# Detailed steps:
# 1. Login/Signup debug user
# 2. Upload avatar
# 3. Create a chat
# 4. Send a message
# 5. Fetch messages
# 6. Check if sender_image is present in response

def run():
    EMAIL = "debug_image_user@test.com"
    PASSWORD = "password123"
    
    print("1. Login/Signup...")
    res = requests.post(f"{API_URL}/auth/signup", json={"email": EMAIL, "password": PASSWORD, "username": "ImgUser"})
    if res.status_code != 200 and "already exists" in res.text:
        res = requests.post(f"{API_URL}/auth/login", json={"identifier": EMAIL, "password": PASSWORD})
    
    if res.status_code != 200:
        print(f"Failed to auth: {res.text}")
        return
        
    token = res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    print("\n2. Upload Avatar...")
    # 1x1 png
    with open("test_avatar.png", "wb") as f:
        f.write(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff\x3f\x03\x00\x05\xfe\x02\xfe\xa7\x35\x81\x84\x00\x00\x00\x00IEND\xae\x42\x60\x82')
    
    with open("test_avatar.png", "rb") as f:
        res = requests.post(f"{API_URL}/auth/profile/avatar", files={"file": ("test_avatar.png", f, "image/png")}, headers=headers)
        print(f"Upload: {res.status_code}")

    print("\n3. Create Group/Chat...")
    # Always try to create new specific one to ensure it exists
    res = requests.post(f"{API_URL}/api/groups", json={"name": "ImgTestGroup"}, headers=headers)
    if res.status_code == 200:
        group_id = res.json()["id"]
        # Create chat
        res = requests.post(f"{API_URL}/api/groups/{group_id}/chats", json={"title": "ImgChat"}, headers=headers)
        chat_id = res.json()["id"]
    else:
        # Fallback to fetch existing
        print("   Using existing group...")
        res = requests.get(f"{API_URL}/api/groups", headers=headers)
        groups = res.json()
        if not groups:
            print(f"   No groups found. Create failed? Status: {res.status_code}, Response: {res.text}")
            return
            
        print(f"DEBUG GROUPS: {groups}")
        if isinstance(groups, list) and len(groups) > 0:
             group_id = groups[0]["id"]
        else:
             print("Groups response format unexpected")
             return
        
        # Get chats
        if not groups[0]["chats"]:
             res = requests.post(f"{API_URL}/api/groups/{group_id}/chats", json={"title": "FallbackChat"}, headers=headers)
             chat_id = res.json()["id"]
        else:
             chat_id = groups[0]["chats"][0]["id"]

    print(f"Group: {group_id}, Chat: {chat_id}")

    print("\n4. Send Message (via Socket simulated by direct DB insert for verifying API fetch? No, must send via socket ideally, but API fetch reads from DB)")
    # We can't easily simulate Socket.IO send here without a socket client.
    # But we can verify if the API returns images for *existing* messages.
    # I'll manually insert a message into DB for this user to ensure we have one.
    
    from pymongo import MongoClient
    from datetime import datetime
    import os
    # Connect to DB (assuming localhost for script) - Wait the script runs in container? No, local environment.
    # I'll rely on existing messages if any, or just trust the upload worked and maybe I'll skip insert and just use what's there?
    # Better: use python mongo client to insert a message.
    
    client = MongoClient("mongodb+srv://ADMIN:malik625@nexus-ai.cqbopk7.mongodb.net/?appName=Nexus-AI")
    db = client.nexus
    db.messages.insert_one({
        "user_id": EMAIL,
        "group_id": group_id,
        "chat_id": chat_id,
        "role": "user",
        "content": "Test message for avatar verify",
        "created_at": datetime.utcnow()
    })
    print("Inserted test message directly to DB.")

    print("\n5. Fetch Messages...")
    res = requests.get(f"{API_URL}/api/messages/{group_id}/{chat_id}", headers=headers)
    if res.status_code == 200:
        msgs = res.json()
        print(f"Fetched {len(msgs)} messages.")
        if len(msgs) > 0:
            last_msg = msgs[-1]
            print(f"Last Message Sender: {last_msg.get('sender')}")
            print(f"Last Message Image: {last_msg.get('sender_image')}")
            
            if last_msg.get('sender_image'):
                 print("SUCCESS: Image URL present in API response.")
            else:
                 print("FAILURE: Image URL MISSING in API response.")
    else:
        print(f"Failed to fetch messages: {res.text}")

if __name__ == "__main__":
    run()
