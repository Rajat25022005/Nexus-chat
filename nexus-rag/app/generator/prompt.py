from typing import List, Dict, Any, Optional
import re


def normalize_text(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"([!?]){2,}", r"\1", text)
    return text


def infer_intent(text: str) -> str:
    if not text:
        return "unknown"

    text_l = text.lower()

    if any(x in text_l for x in [
        "hi", "hello", "hey", "yo",
        "thanks", "thank you",
        "good boy", "good job", "nice", "well done"
    ]):
        return "small_talk"

    if text_l.endswith("?"):
        return "question"
    if any(text_l.startswith(x) for x in ["please", "can you", "could you"]):
        return "request"
    if any(x in text_l for x in ["error", "issue", "bug", "failed"]):
        return "problem"
    if any(x in text_l for x in ["agree", "yes", "looks good", "ok"]):
        return "agreement"
    if any(x in text_l for x in ["no", "disagree", "wrong"]):
        return "disagreement"

    return "statement"


def format_message(msg: Any) -> Optional[str]:
    if isinstance(msg, dict):
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        sender = msg.get("sender")
        meta = msg.get("meta", {})
    else:
        role = getattr(msg, "role", "unknown")
        content = getattr(msg, "content", "")
        sender = getattr(msg, "sender", None)
        meta = getattr(msg, "meta", {})

    content = normalize_text(content)
    if not content:
        return None

    intent = infer_intent(content)

    role_upper = role.upper()
    if role.lower() == "user" and sender:
        role_upper = f"USER ({sender})"

    meta_block = []
    if meta:
        if meta.get("reaction"):
            meta_block.append(f"reaction={meta['reaction']}")
        if meta.get("attachment"):
            meta_block.append("attachment=true")

    meta_str = f" [{' | '.join(meta_block)}]" if meta_block else ""

    return f"{role_upper}{meta_str} ({intent}): {content}"


def build_prompt(
    user_query: str,
    user_name: str,
    retrieved_docs: List[Dict[str, Any]],
    chat_history: List[Any],
    group_members: List[str] = None,
    reply_to_context: str = None
) -> str:

    group_members = group_members or []

    # ---- Context ----
    context_items = []
    for doc in retrieved_docs:
        content = normalize_text(doc.get("content", ""))
        source = doc.get("source")
        if content:
            context_items.append(
                f"- {content}" + (f" (source: {source})" if source else "")
            )

    context_block = (
        "\n".join(context_items)
        if context_items
        else "No relevant context available."
    )

    # ---- Members ----
    members_block = ", ".join(group_members) if group_members else "Unknown"

    # ---- History ----
    history_lines = []
    for msg in chat_history:
        line = format_message(msg)
        if line:
            history_lines.append(line)

    history_block = (
        "\n".join(history_lines)
        if history_lines
        else "No prior conversation available."
    )

    user_query = normalize_text(user_query)

    reply_context_block = ""
    if reply_to_context:
        reply_context_block = f"""
### REPLIED MESSAGE (User is replying to this)
{reply_to_context}

"""

    return f"""
You are **Nexus AI**, an intelligent assistant in a **Multi-User Group Chat**.

Your personality:
- Friendly, calm, and human.
- You may respond to greetings and appreciation.
- Keep small-talk replies to **one short sentence**.

---

### Group Members
{members_block}

---

### Context
{context_block}

---
{reply_context_block}
### Conversation History
{history_block}

---

### Interaction Rules
1. Consider messages from **all users**, not just the last one.
2. If the message is **small talk or appreciation directed at you**, reply warmly and briefly.
3. If the message is a **question, request, or problem**, reply helpfully.
4. If your response adds **no value**, do not speak.
5. Never explain that you are being silent.

---

### Output Rules (CRITICAL)
- If you decide to speak:  
  👉 Output **ONLY the message text**, nothing else.
- If you decide not to speak:  
  👉 Output exactly: `SILENT`

---

### Latest User Query (from {user_name})
{user_query}
""".strip()