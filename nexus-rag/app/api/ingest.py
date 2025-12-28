from fastapi import APIRouter
from app.embeddings.embedder import embed_text
from app.vectorstore.store import vector_store

router = APIRouter()

@router.post("/ingest")
def ingest_text(room_id: str, text: str):
    # MOVED INSIDE: Calculate embedding for the specific text received in this request
    embedding = embed_text(text)

    existing_docs = vector_store.search(query_vector=embedding, limit=1)

    if existing_docs:
        top_match = existing_docs[0]
        print(f"DEBUG: Top match keys are: {top_match.keys()}")
        print(f"DEBUG: Top match data: {top_match}")

        if top_match['score'] > 0.95:
             found_text = top_match.get('text', top_match.get('content', 'UNKNOWN'))
             print(f"Duplicate detected: '{text}' is too similar to '{found_text}'")
             return {"status": "ignored", "reason": "Duplicate content exists"}

    doc = {
        "room_id": room_id,
        "text": text,
        "embedding": embedding,
    }
    
    vector_store.store_message(
        group_id=room_id, 
        chat_id="default", 
        content=text,
        role="user"
    )
    
    return {"status": "stored"}