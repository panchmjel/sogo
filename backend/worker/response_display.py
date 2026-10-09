"""Lossless display fallback. Never interpret damaged output as executable changes."""
import json,re

def answer(response):
    raw='\n\n'.join(b.get('text','') for b in response.get('content',[]) if b.get('type')=='text' and isinstance(b.get('text'),str)).strip()
    if not raw: return None
    text=raw
    # Recover the display field only. Unknown/damaged structured data is never applied.
    match=re.search(r'"text"\s*:\s*"(.*)"\s*,\s*"(?:changes|facts|findings|purchaseRules|offers|rows)"\s*:',raw,re.S)
    if match:
        candidate=match.group(1)
        try: text=json.loads('"'+candidate+'"')
        except (ValueError,TypeError):
            text=re.sub(r'\\(["\\/bfnrt])',lambda m:{'n':'\n','r':'\r','t':'\t','b':'\b','f':'\f'}.get(m[1],m[1]),candidate)
    note='Nie zapisano zmian materiałów ani porównania. Poniżej treść odpowiedzi Claude; sprawdź ją przed wykorzystaniem.'
    if response.get('stop_reason')!='end_turn': note='Odpowiedź została przerwana i może być niepełna. '+note
    return {'type':'ANSWER','text':note+'\n\n'+text,'changes':[],'findings':[], 'requiresReview':True,'reviewStatus':'DISPLAY_ONLY','rawResponseText':raw,'usage':response.get('usage',{})}
