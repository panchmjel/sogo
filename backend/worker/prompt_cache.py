"""Stable document prefix, reusable history, uncached live request context."""
import os
import json


def ttl():
    value = os.getenv('ANTHROPIC_PROMPT_CACHE_TTL', '1h').strip().lower()
    if value in ('off', 'false', '0'):
        return None
    return value if value in ('5m', '1h') else '1h'


def document_prefix(blocks, duration, slots=3):
    result = [dict(block) for block in blocks]
    if not duration or not result:
        return result
    # Anchor early checkpoints by block position, not document count. Large CAD
    # documents contain many image blocks. Leave one of the four slots for history.
    points = list(range(17, len(result)-1, 18))[:max(0, slots-1)]
    points.append(len(result)-1)
    for i in points:
        result[i]['cache_control'] = {'type': 'ephemeral', 'ttl': duration}
    return result


def stable_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), default=str)


def conversation_body(model, system, blocks, context_text, max_tokens=12000):
    duration = ttl()
    # Accept legacy callers, but only structured context can separate history.
    context = dict(context_text) if isinstance(context_text, dict) else None
    history = context.pop('history', []) if context is not None else []
    content = document_prefix(blocks, duration, slots=3 if history else 4)
    # One block per completed turn keeps prior history byte-identical. Live scope,
    # date, request IDs and current question must never precede this checkpoint.
    history_blocks = [{'type':'text', 'text':'Poprzednia tura rozmowy: '+stable_json(turn)} for turn in history]
    if duration and history_blocks:
        history_blocks[-1]['cache_control'] = {'type':'ephemeral', 'ttl':'5m'}
    content.extend(history_blocks)
    content.append({'type':'text', 'text':('Bieżący kontekst i pytanie: '+stable_json(context)) if context is not None else context_text})
    return {'model':model, 'max_tokens':max_tokens, 'system':system,
            'messages':[{'role':'user','content':content}]}
