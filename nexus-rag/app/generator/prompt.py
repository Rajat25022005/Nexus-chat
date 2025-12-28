from typing import List, Dict


def build_prompt(
    *,
    user_query: str,
    retrieved_docs: List[Dict],
    chat_history: List[Dict],
) -> str:
    """
    Build a grounded RAG prompt for Nexus.
    """

    system_prompt = (
        "You are Nexus AI, a collaborative workspace assistant.\n"
        "Answer the user's question using ONLY the provided context.\n"
        "If the answer is not in the context, say you do not know.\n"
        "Be concise, clear, and accurate.\n"
    )

    # Format retrieved context
    context_block = "\n".join(
        f"[Source {i+1}]\n{doc['content']}"
        for i, doc in enumerate(retrieved_docs)
    ) or "No relevant context found."

    # Format recent chat history
    history_block = "\n".join(
        f"{msg['role'].upper()}: {msg['content']}"
        for msg in chat_history[-6:]  # last N messages
    ) or "No prior conversation."

    prompt = f"""
{system_prompt}

### Retrieved Context
{context_block}

### Conversation History
{history_block}

### User Question
{user_query}

### Answer
""".strip()

    return prompt
