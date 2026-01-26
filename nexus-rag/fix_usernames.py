from pymongo import MongoClient
import certifi
import os
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")

if not MONGO_URI:
    print("MONGO_URI not found in environment")
    exit(1)

client = MongoClient(MONGO_URI, tlsCAFile=certifi.where())
db = client["nexus"]
users_col = db["users"]

print("Fixing missing usernames...")

users = users_col.find({"username": {"$exists": False}})
count = 0
for user in users:
    email = user["email"]
    username = email.split("@")[0]
    
    # Ensure generated username is unique
    base_username = username
    counter = 1
    while users_col.find_one({"username": username}):
        username = f"{base_username}{counter}"
        counter += 1
        
    users_col.update_one({"_id": user["_id"]}, {"$set": {"username": username}})
    print(f"Updated user {email} -> {username}")
    count += 1

users_null = users_col.find({"username": None})
for user in users_null:
    email = user["email"]
    username = email.split("@")[0]
    
    # Ensure generated username is unique
    base_username = username
    counter = 1
    while users_col.find_one({"username": username}):
        username = f"{base_username}{counter}"
        counter += 1
        
    users_col.update_one({"_id": user["_id"]}, {"$set": {"username": username}})
    print(f"Updated user {email} -> {username}")
    count += 1

print(f"Fixed {count} users.")
