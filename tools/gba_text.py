r"""Gen3 Japanese text codec (charmap.tbl based).

Control codes used by the game text:
  0xFE newline(\n)  0xFB paragraph(\p)  0xFA scroll line(\l)  0xFF end
  0xFD xx : buffer (shown as [BUFxx])
"""
import re, os

DEFAULT_TBL = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'NeoDark-CFRU-main', 'charmap.tbl')

def load_charmap(path=DEFAULT_TBL):
    cm = {}
    for line in open(path, encoding='utf-8', errors='replace'):
        m = re.match(r'^([0-9A-Fa-f]{2})=(.*)$', line.rstrip('\n'))
        if m:
            cm.setdefault(int(m.group(1), 16), m.group(2))
    return cm

class Codec:
    def __init__(self, path=DEFAULT_TBL):
        self.cm = load_charmap(path)
        self.rev = {}
        for line in open(path, encoding='utf-8', errors='replace'):
            m = re.match(r'^([0-9A-Fa-f]{2})=(.)$', line.rstrip('\r\n'))
            if m and m.group(2) not in self.rev:
                self.rev[m.group(2)] = int(m.group(1), 16)
        self.rev[' '] = 0x00
        self.rev['　'] = 0x00

    def encode(self, s, terminate=True):
        out = bytearray()
        i = 0
        while i < len(s):
            c = s[i]
            if c == '\\' and i + 1 < len(s):
                n = s[i + 1]
                if n == 'n': out.append(0xFE); i += 2; continue
                if n == 'p': out.append(0xFB); i += 2; continue
                if n == 'l': out.append(0xFA); i += 2; continue
            if c == '\n':
                out.append(0xFE); i += 1; continue
            if c not in self.rev:
                raise KeyError(f'char not in charmap: {c!r}')
            out.append(self.rev[c]); i += 1
        if terminate:
            out.append(0xFF)
        return bytes(out)

    def decode(self, b, limit=400):
        out = ''
        i = 0
        while i < min(len(b), limit):
            x = b[i]
            if x == 0xFF: break
            if x == 0xFE: out += '\\n'
            elif x == 0xFB: out += '\\p'
            elif x == 0xFA: out += '\\l'
            elif x == 0xFD: out += '[BUF%02X]' % b[i + 1]; i += 1
            elif x == 0xFC: out += '[CTRL%02X]' % b[i + 1]; i += 1
            else: out += self.cm.get(x, '[%02X]' % x)
            i += 1
        return out
