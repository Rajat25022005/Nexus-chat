from typing import List, Dict
from app.embeddings.embedder import embed_text
from app.core.mongo import get_vector_collection


def retrieve_context(
    query: str,
    group_id: str,
    chat_id: str,
    top_k: int = 5,
) -> List[Dict]:
    """
    Retrieve relevant context for a query
    Scoped by group_id and chat_id (Nexus-safe)
    """

    collection = get_vector_collection()

    # 1️⃣ Embed query
    query_embedding = embed_text(query)

    # 2️⃣ Vector search with strict filtering
    pipeline = [
        {
            "$vectorSearch": {
                "index": "embedding_index",   # Mongo Atlas vector index name
                "path": "embedding",
                "queryVector": query_embedding,
                "numCandidates": 100,
                "limit": top_k,
                "filter": {
                    "group_id": group_id,
                    "chat_id": chat_id
                }
            }
        },
        {
            "$project": {
                "_id": 1,
                "content": 1,
                "score": { "$meta": "vectorSearchScore" }
            }
        }
    ]

    results = collection.aggregate(pipeline)

    # 3️⃣ Normalize output for generator & frontend
    documents = []
    for doc in results:
        documents.append({
            "id": str(doc["_id"]),
            "content": doc.get("content", ""),
            "score": float(doc.get("score", 0.0)),
        })

    return documents
