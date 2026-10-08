"""Normalize explicit numeric fields, never OCR text or product descriptions."""
import re
from decimal import Decimal

def normalize_number(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise ValueError('Nieprawidłowy typ liczby')
    text = str(value).strip().replace('\u00a0', ' ').replace('\u202f', ' ').replace('\u2212', '-')
    if not text or len(text) > 64:
        raise ValueError('Nieprawidłowa długość liczby')
    sign = ''
    if text[0] in '+-':
        sign, text = ('-' if text[0] == '-' else ''), text[1:]
    if ' ' in text:
        if not re.fullmatch(r'[0-9]{1,3}(?: [0-9]{3})+(?:[.,][0-9]+)?', text):
            raise ValueError('Nieprawidłowe grupowanie cyfr')
        text = text.replace(' ', '')
    if ',' in text and '.' in text:
        decimal = ',' if text.rfind(',') > text.rfind('.') else '.'
        group = '.' if decimal == ',' else ','
        if not re.fullmatch(r'[0-9]{1,3}(?:' + re.escape(group) + r'[0-9]{3})+' + re.escape(decimal) + r'[0-9]+', text):
            raise ValueError('Nieprawidłowe separatory liczby')
        text = text.replace(group, '').replace(decimal, '.')
    else:
        text = text.replace(',', '.')
    if not re.fullmatch(r'[0-9]{1,12}(?:\.[0-9]{1,8})?', text):
        raise ValueError('Nieprawidłowy lub niejednoznaczny zapis liczby')
    return sign + text

def invoice_amount(value):
    number = normalize_number(value)
    if number is None:
        return None
    amount = Decimal(number)
    if amount != amount.quantize(Decimal('0.01')):
        raise ValueError('Kwota faktury zawiera części grosza')
    return format(amount, '.2f')
