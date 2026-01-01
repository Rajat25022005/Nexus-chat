def should_ai_interject(signals: dict, recent_ai_messages: int) -> bool:
    if recent_ai_messages > 0:
        return False
    
    if signals["confusion"] and signals["question_loop"]:
        return True

    if signals["disagreement"] and signals["emotion"]:
        return True

    return False
