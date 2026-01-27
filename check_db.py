from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv(".env")

uri = os.getenv("MONGO_URI")
client = MongoClient(uri)
db = client[os.getenv("MONGO_DB_NAME", "nexus")]
users = db.users

for user in users.find():
    print(f"User: {user.get('email')} (ID: {user.get('_id')})")
    print(f"Profile Image: {user.get('profile_image')}")
    print("-" * 20)
