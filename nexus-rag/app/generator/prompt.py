from typing import List, Dict, Any

def build_prompt(
    user_query: str,
    retrieved_docs: List[dict],
    chat_history: List[Any],
    group_members: List[str] = [],
) -> str:

    context_content = "\n".join(
        f"- {doc.get('content', '')}" 
        for doc in retrieved_docs 
        if doc.get("content")
    )
    context_block = context_content if context_content else "No relevant context available."

    members_block = ", ".join(group_members) if group_members else "Unknown"

    history_lines = []
    for msg in chat_history:
        # Handle dict vs Pydantic object
        if isinstance(msg, dict):
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            sender = msg.get("sender")
        else:
            role = getattr(msg, "role", "unknown")
            content = getattr(msg, "content", "")
            sender = getattr(msg, "sender", None)
            
        role_str = role.upper()
        if role.lower() == "user" and sender:
             role_str = f"USER ({sender})"
             
        history_lines.append(f"{role_str}: {content}")

    history_block = "\n".join(history_lines)

    return f"""
You are Nexus AI, an intelligent assistant operating within a **Multi-User Group Chat**.
Your goal is to assist the entire team, not just the user asking the question.

### Group Members (Users in this chat)
{members_block}

### Context
{context_block}

### Conversation History
{history_block if history_block else "No prior conversation available."}

### Operational Constraints
1. **Multi-User Awareness**: The history contains messages from different users (identified as `USER (email)`). You must consider the inputs of ALL users, not just the last speaker.
2. Use the 'Group Members' list to identify who is present.
3. **Context-Driven**: Responses must be based on the provided Context and History.
4. No external knowledge or assumptions.
5. If the answer is not in the context/history, say: "I don't have enough context."
6. Be concise and direct.

### User Query
{user_query}

### Response:
""".strip()