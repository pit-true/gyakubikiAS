"""Katakana/hiragana helpers: hiragana conversion and a simple Hepburn-like romaji
that matches the style used by gyakubikiPD (e.g. からてチョップ -> karatechoppu,
バジール -> baji-ru, おうふくビンタ -> oufukubinta)."""

def to_hiragana(s):
    out = []
    for c in s:
        o = ord(c)
        if 0x30A1 <= o <= 0x30F6:   # ァ..ヶ -> ぁ..ゖ
            out.append(chr(o - 0x60))
        else:
            out.append(c)
    return ''.join(out)

_BASE = {
    'あ':'a','い':'i','う':'u','え':'e','お':'o',
    'か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
    'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so',
    'た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
    'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
    'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
    'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
    'や':'ya','ゆ':'yu','よ':'yo',
    'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro',
    'わ':'wa','を':'wo','ん':'n',
    'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go',
    'ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo',
    'だ':'da','ぢ':'ji','づ':'zu','で':'de','ど':'do',
    'ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
    'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po',
    'ゔ':'vu',
    'ぁ':'a','ぃ':'i','ぅ':'u','ぇ':'e','ぉ':'o',
    'ゃ':'ya','ゅ':'yu','ょ':'yo','ゎ':'wa',
    'ー':'-',
}
_SMALL = {'ゃ':'ya','ゅ':'yu','ょ':'yo','ぁ':'a','ぃ':'i','ぅ':'u','ぇ':'e','ぉ':'o'}

def to_romaji(s):
    h = to_hiragana(s)
    out = []
    i = 0
    sokuon = False
    while i < len(h):
        c = h[i]
        nxt = h[i + 1] if i + 1 < len(h) else ''
        if c == 'っ':
            sokuon = True; i += 1; continue
        if c in _BASE:
            r = _BASE[c]
            if nxt in _SMALL and c not in 'あいうえおんー' and c not in _SMALL:
                small = _SMALL[nxt]
                base = r
                if base.endswith('i') and len(base) >= 2:
                    stem = base[:-1]
                    if stem in ('sh', 'ch', 'j'):
                        r = stem + small[-1] if small[0] == 'y' else stem + small
                    else:
                        r = stem + small
                else:
                    r = base[:-1] + small
                i += 1
            if sokuon:
                r = (r[0] if r[0] != 'c' else 't') + r
                sokuon = False
            out.append(r)
        elif c.isdigit() or c.isascii():
            out.append(c.lower())
        else:
            out.append(c)
        i += 1
    return ''.join(out)

if __name__ == '__main__':
    for w in ['はたく', 'からてチョップ', 'おうふくビンタ', 'バジール', 'げきりん', 'エナジーボール', 'アスフィア', 'ソウルブレイク', 'きゅうばん']:
        print(w, to_hiragana(w), to_romaji(w))
