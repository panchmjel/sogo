"""Explicit reusable document-prefix caching; never cache the changing request tail."""
import os


def ttl():
    value = os.getenv('ANTHROPIC_PROMPT_CACHE_TTL', '1h').strip().lower()
    if value in ('off', 'false', '0'):
        return None
    # A bad setting must not make every request fail at the provider.
    return value if value in ('5m', '1h') else '1h'


def document_prefix(blocks, duration):
    # Keep deterministic checkpoints after documents 6/12/18 and the last one.
    # Unchanged prefixes can then survive additions or edits to later documents.
    # Four is the provider limit; system text is included in each cached prefix.
    result = [dict(block) for block in blocks]
    if not duration or not result:
        return result
    starts = [i for i, block in enumerate(result)
              if block.get('type') == 'text' and block.get('text', '').startswith('Dokument źródłowy: ')]
    if not starts:
        return result
    ends = [i - 1 for i in starts[1:]] + [len(result) - 1]
    checkpoints = {ends[i - 1] for i in (6, 12, 18) if i <= len(ends)}
    checkpoints.add(ends[-1])
    for i in checkpoints:
        result[i]['cache_control'] = {'type': 'ephemeral', 'ttl': duration}
    return result


def conversation_body(model, system, blocks, context_text, max_tokens=12000):
    prefix = document_prefix(blocks, ttl())
    # There is deliberately no top-level automatic cache: the entire context
    # object changes each turn and would create a write surcharge with no reuse.
    return {'model': model, 'max_tokens': max_tokens, 'system': system,
            'messages': [{'role': 'user', 'content': prefix + [{'type': 'text', 'text': context_text}]}]}
