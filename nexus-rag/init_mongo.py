# debug_retrieval.py
from pymongo import MongoClient
import certifi
from app.core.config import MONGO_URI
from app.embeddings.embedder import Embedder

# 1. Connect
client = MongoClient(MONGO_URI, tlsCAFile=certifi.where())
db = client["nexus"]
collection = db["memory_vectors"]

# 2. Get a real embedding
print("Generatng embedding for query 'age of rajat'...")
embedder = Embedder()
query_embedding = embedder.embed("age of rajat")
print(f"✅ Embedding generated. Dimensions: {len(query_embedding)}")

# 3. Define the pipeline (Exact same as your app)
pipeline = [
    {
        "$vectorSearch": {
            "index": "vector_index",  # <--- CHECK THIS NAME
            "path": "embedding",
            "queryVector": query_embedding,
            "numCandidates": 100,
            "limit": 3,
            "filter": {
                "room_id": "auth"
            }
        }
    },
    {
        "$project": {
            "_id": 0,
            "text": 1,
            "score": {"$meta": "vectorSearchScore"}
        }
    }
]

# 4. Run Search
print("\nRunning Vector Search...")
try:
    results = list(collection.aggregate(pipeline))
    if results:
        print("✅ SUCCESS! Found documents:")
        for r in results:
            print(f"- {r['text']} (Score: {r.get('score')})")
    else:
        print("❌ FAILED. Zero results found.")
        print("Possible causes:")
        print(f"1. Index name 'vector_index' is wrong in Atlas.")
        print(f"2. Atlas Index dimensions do NOT match {len(query_embedding)}.")
        print(f"3. Index is still building.")

except Exception as e:
    print(f"❌ CRASHED: {e}")