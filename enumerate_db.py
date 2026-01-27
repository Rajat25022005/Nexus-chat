from pymongo import MongoClient
import os
from dotenv import load_dotenv
from bson import ObjectId

# Load env manually to check values
load_dotenv("nexus-rag/.env")
print(f"ENV MONGO_URI: {os.getenv('MONGO_URI')}")
print(f"ENV MONGO_DB_NAME: {os.getenv('MONGO_DB_NAME')}")

uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
client = MongoClient(uri)

print("\nDbs on server:")
print(client.list_database_names())

target_id = "69737b9362e4dc8374bad057"

for db_name in client.list_database_names():
    db = client[db_name]
    if "users" in db.list_collection_names():
        print(f"\nChecking DB: {db_name}")
        users = db.users
        print(f"User count: {users.count_documents({})}")
        
        found = users.find_one({"_id": ObjectId(target_id)})
        if found:
            print(f"!!! FOUND USER {target_id} IN DB: {db_name} !!!")
            print(f"Profile Image: {found.get('profile_image')}")
            
            # Let's verify other users too
            for u in users.find():
                 print(f" - {u.get('email')} ({u.get('_id')})")
        else:
            print(f"User {target_id} NOT found in {db_name}")
