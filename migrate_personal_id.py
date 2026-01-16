
from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv("nexus-rag/.env")

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
client = MongoClient(MONGO_URI)
db = client.nexus

# Update messages where group_id is 'personal' to 'personal_<user_id>'
# Since we can't easily reference another field in a simple update_many $set without pipeline,
# we will use an aggregation pipeline in update_many (MongoDB 4.2+)
result = db.messages.update_many(
    {"group_id": "personal"},
    [{"$set": {"group_id": {"$concat": ["personal_", "$user_id"]}}}]
)

print(f"Migrated {result.modified_count} messages to new Personal Group ID format.")
