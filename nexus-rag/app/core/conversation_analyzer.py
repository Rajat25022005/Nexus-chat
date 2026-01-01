def analyze_conversation(messages: list[str]) -> dict:
    joined = " ".join(messages).lower()

    signals = {
        "confusion": any(w in joined for w in ["confused", "not sure", "why", "how"]),
        "disagreement": any(w in joined for w in ["but", "no", "however", "i disagree"]),
        "emotion": any(w in joined for w in ["frustrated", "angry", "stuck", "worried"]),
        "question_loop": joined.count("?") >= 3,
    }

    return signals
