from datetime import datetime
import logging
import asyncio

from app.core.mongo import get_message_collection
from app.rag.retriever import retrieve_context
from app.generator.prompt import build_prompt
from app.generator.service import generate_answer

logger = logging.getLogger(__name__)


async def process_chat_message(
    user_query: str,
    group_id: str,
    chat_id: str,
    user_email: str,
    history: list = []
):
    """
    Core RAG logic for processing chat messages.
    
    1. Retrieve relevant context from vector store
    2. Build prompt with context and history
    3. Generate AI response
    4. Store response in database
    
    Args:
        user_query: The user's input message
        group_id: Group identifier
        chat_id: Chat identifier
        user_email: User's email (from JWT)
        history: List of recent messages for context
    
    Returns:
        Tuple of (answer, retrieved_documents)
    """
    try:
        logger.debug(f"Processing chat message for user: {user_email}")
        
        # 1. Retrieve Context (Run in executor to avoid blocking)
        loop = asyncio.get_running_loop()
        
        documents = await loop.run_in_executor(
            None,
            lambda: retrieve_context(
                query=user_query,
                group_id=group_id,
                chat_id=chat_id,
                top_k=5,
            )
        )
        
        logger.debug(f"Retrieved {len(documents)} context documents")

        # 2. Build Prompt
        prompt = build_prompt(
            user_query=user_query,
            retrieved_docs=documents,
            chat_history=history,
        )

        # 3. Generate Answer
        answer = await generate_answer(prompt)

        # 4. Store Assistant Message
        try:
            messages_col = get_message_collection()
            messages_col.insert_one({
                "user_id": user_email,
                "group_id": group_id,
                "chat_id": chat_id,
                "role": "assistant",
                "content": answer,
                "created_at": datetime.utcnow(),
            })
            logger.debug("Assistant message stored successfully")
        except Exception as e:
            logger.error(f"Failed to store assistant message: {e}", exc_info=True)
            # Don't raise - we still want to return the answer

        return answer, documents
        
    except Exception as e:
        logger.error(f"Error in process_chat_message: {e}", exc_info=True)
        raise
