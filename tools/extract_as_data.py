#!/usr/bin/env python3
"""Extract move / Pokemon / contest data from the Altair & Sirius ROMs into JSON for gyakubikiAS.

Usage:
  python -X utf8 tools/extract_as_data.py [--kakeru kakeru_contest.json] [--out DIR]
      [--rom-dir DIR] [--charmap charmap.tbl] [--vanilla-rom emerald.gba]

Reads the ROMs only (never writes to them).
Defaults: --rom-dir ../org (next to the gyakubikiAS folder), --out the gyakubikiAS folder,
--charmap ../../NeoDark-CFRU-main/charmap.tbl, --vanilla-rom the Emerald (J) ROM below.
"""
import os, re, sys, json, struct, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)          # gyakubikiAS/
AS_ROOT = os.path.dirname(ROOT)       # AS/
sys.path.insert(0, HERE)
from gba_text import Codec, DEFAULT_TBL
import kana

ROM_BASE = 0x08000000
ROM_FILES = {
    'altair': '18年1月30日完成版アルタイル.gba',
    'sirius': '18年1月30日完成版シリウス.gba',
}
ROMS = {}   # filled in by main() from --rom-dir
VANILLA = r'C:\Users\korok\Desktop\pokehack\ROM\Pokemon Emerald (J)\Pocket Monsters - Emerald (Japan).gba'

# ---- BPEJ table addresses (unchanged in the hack unless noted) ----
NAMES = 0x2EA31C; NAME_LEN = 6; SPECIES_MAX = 411
BASE_STATS = 0x2F0D54
MOVE_NAMES = 0x2EACC4; MOVE_NAME_LEN = 8; MOVE_MAX = 354
ATTACK = 0x2ED220
TYPE_NAMES = 0x2EBC88; TYPE_LEN = 5
ABILITY_NAMES = 0x2EBDC4; ABILITY_LEN = 8
LVLUP_PTRS = 0x2F9D04
TM_COMPAT = 0x2EF220
TM_LIST = 0x5E144C; TM_COUNT = 58
TUTOR_LIST = 0x5E08C4; TUTOR_COUNT = 30
TUTOR_COMPAT = 0x5E0900
EGG_MOVES = 0x2FB764
EVOLUTIONS = 0x2F5CA4
NAT_DEX = 0x2EE608
DEX_DATA = 0x54069C; DEX_LEN = 28
CON_WAZA = 0x565FCC          # ConWazaData2[355]: apno, con_type, combo1, combo2[4], pad
CON_KOUKA = 0x566AE4         # WazaKoukaData[48]: class, appeal, jam, pad
CON_SETUMEI = 0x560BB4       # const u8 *WazaSetumeiMsgTbl[48]
CON_EFFECT_COUNT = 48

CONTEST_TYPES = ['かっこよさ', 'うつくしさ', 'かわいさ', 'かしこさ', 'たくましさ']
CONTEST_TYPE_EN = ['cool', 'beauty', 'cute', 'smart', 'tough']
# WazaKoukaData.class (contest effect class), after pokeemerald's gContestEffects types
CONTEST_CLASS = {0: 'アピール', 1: 'アピール(リスクあり)', 2: '妨害(直前)', 3: '妨害(全体)',
                 4: '特殊', 5: 'アピール変動', 6: '順番操作'}
PHYSICAL_TYPES = {0, 1, 2, 3, 4, 5, 6, 7, 8}   # normal..steel are physical in Gen3
EXCLUDED_SPECIES = {410}                          # "？？？？？" dummy in both ROMs


def u8(b, o): return b[o]
def u16(b, o): return struct.unpack_from('<H', b, o)[0]
def u32(b, o): return struct.unpack_from('<I', b, o)[0]
def s8(b, o): return struct.unpack_from('<b', b, o)[0]


class RomData:
    def __init__(self, path, codec):
        self.rom = open(path, 'rb').read()
        self.codec = codec

    def text(self, off, limit=400):
        return self.codec.decode(self.rom[off:off + limit], limit)

    def fixed(self, off, n):
        return self.codec.decode(self.rom[off:off + n], n)

    def species_name(self, i): return self.fixed(NAMES + i * NAME_LEN, NAME_LEN)
    def move_name(self, i): return self.fixed(MOVE_NAMES + i * MOVE_NAME_LEN, MOVE_NAME_LEN)
    def type_name(self, i): return self.fixed(TYPE_NAMES + i * TYPE_LEN, TYPE_LEN)
    def ability_name(self, i): return self.fixed(ABILITY_NAMES + i * ABILITY_LEN, ABILITY_LEN)

    def attack(self, m):
        o = ATTACK + m * 12
        return dict(effect_id=u8(self.rom, o), power=u8(self.rom, o + 1), type_id=u8(self.rom, o + 2),
                    accuracy=u8(self.rom, o + 3), pp=u8(self.rom, o + 4), effect_chance=u8(self.rom, o + 5),
                    target=u8(self.rom, o + 6), priority=s8(self.rom, o + 7), flags=u8(self.rom, o + 8))

    def base(self, s):
        o = BASE_STATS + s * 28
        b = self.rom[o:o + 28]
        return dict(hp=b[0], atk=b[1], df=b[2], spe=b[3], spa=b[4], spd=b[5], type1=b[6], type2=b[7],
                    catch_rate=b[8], exp_yield=b[9], item1=u16(b, 12), item2=u16(b, 14), gender=b[16],
                    egg_cycles=b[17], friendship=b[18], growth=b[19], egg_group1=b[20], egg_group2=b[21],
                    ability1=b[22], ability2=b[23], safari=b[24], color=b[25] & 0x7F)

    def lvlup(self, s):
        p = u32(self.rom, LVLUP_PTRS + s * 4) - ROM_BASE
        out = []
        while True:
            v = u16(self.rom, p)
            if v == 0xFFFF or len(out) > 60: break
            out.append((v >> 9, v & 0x1FF)); p += 2
        return out

    def tm_list(self): return [u16(self.rom, TM_LIST + i * 2) for i in range(TM_COUNT)]
    def tutor_list(self): return [u16(self.rom, TUTOR_LIST + i * 2) for i in range(TUTOR_COUNT)]

    def tm_moves(self, s, tmlist):
        bits = self.rom[TM_COMPAT + s * 8:TM_COMPAT + s * 8 + 8]
        out = []
        for i in range(TM_COUNT):
            if bits[i // 8] >> (i % 8) & 1:
                label = f'わざマシン{i+1:02d}' if i < 50 else f'ひでんマシン{i-49:02d}'
                out.append((label, tmlist[i]))
        return out

    def tutor_moves(self, s, tutlist):
        bits = u32(self.rom, TUTOR_COMPAT + s * 4)
        return [tutlist[i] for i in range(TUTOR_COUNT) if bits >> i & 1]

    def egg_moves(self):
        p = EGG_MOVES; cur = None; out = {}
        while True:
            v = u16(self.rom, p); p += 2
            if v == 0xFFFF: break
            if v >= 20000:
                cur = v - 20000; out.setdefault(cur, [])
            elif cur is not None:
                out[cur].append(v)
            if p - EGG_MOVES > 0x4000: break
        return out

    def can_evolve(self, s):
        o = EVOLUTIONS + s * 40
        return any(u16(self.rom, o + k * 8) != 0 for k in range(5))

    def evolutions(self, s):
        o = EVOLUTIONS + s * 40
        out = []
        for k in range(5):
            method, param, target = u16(self.rom, o + k * 8), u16(self.rom, o + k * 8 + 2), u16(self.rom, o + k * 8 + 4)
            if method: out.append(dict(method=method, param=param, target=target))
        return out

    def natdex(self, s): return u16(self.rom, NAT_DEX + s * 2)

    def dex(self, n):
        o = DEX_DATA + n * DEX_LEN
        tp = u32(self.rom, o + 12)
        return dict(category=self.fixed(o, 6), height=u16(self.rom, o + 6), weight=u16(self.rom, o + 8),
                    text=self.text(tp - ROM_BASE) if ROM_BASE <= tp < ROM_BASE + 0x1000000 else '')

    def contest_move(self, m):
        o = CON_WAZA + m * 8
        b = self.rom[o:o + 8]
        return dict(effect_id=b[0], type_id=b[1] & 7, combo_starter_id=b[2], combo_prev_ids=[x for x in b[3:7] if x])

    def contest_effect(self, e):
        o = CON_KOUKA + e * 4
        p = u32(self.rom, CON_SETUMEI + e * 4) - ROM_BASE
        return dict(id=e, class_id=self.rom[o], appeal=self.rom[o + 1] // 10, jam=self.rom[o + 2] // 10,
                    description=self.text(p).replace('\\n', '\n'))

    def find_move_info(self):
        """Locate WazaInfo[][56] (battle move descriptions) by its first entry."""
        key = self.codec.encode('てや　しっぽなどを　つかい', terminate=False)
        i = self.rom.find(key)
        return i if i >= 0 else None


def clean(s):
    return s.replace('\\n', '\n').replace('\\l', '\n').replace('\\p', '\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kakeru', default=None)
    ap.add_argument('--out', default=ROOT)
    ap.add_argument('--rom-dir', default=os.path.join(AS_ROOT, 'org'),
                    help='folder containing the Altair / Sirius ROMs')
    ap.add_argument('--charmap', default=DEFAULT_TBL, help='charmap.tbl for text decoding')
    ap.add_argument('--vanilla-rom', default=VANILLA, help='original Emerald (J) ROM (optional)')
    args = ap.parse_args()
    ROMS.update({k: os.path.join(args.rom_dir, v) for k, v in ROM_FILES.items()})
    codec = Codec(args.charmap)
    A = RomData(ROMS['altair'], codec)
    S = RomData(ROMS['sirius'], codec)
    E = RomData(args.vanilla_rom, codec) if os.path.exists(args.vanilla_rom) else None
    kakeru = json.load(open(args.kakeru, encoding='utf-8')) if args.kakeru else None
    os.makedirs(args.out, exist_ok=True)

    types = [A.type_name(i) for i in range(18)]
    # ---------------- contest effects ----------------
    effects = [A.contest_effect(e) for e in range(CON_EFFECT_COUNT)]
    for e in effects:
        e['class'] = CONTEST_CLASS.get(e['class_id'], str(e['class_id']))

    # ---------------- moves ----------------
    info_base = A.find_move_info()
    moves = []
    starters = {}           # combo starter id -> move id
    for m in range(1, MOVE_MAX + 1):
        c = A.contest_move(m)
        if c['combo_starter_id']:
            starters[c['combo_starter_id']] = m
    for m in range(1, MOVE_MAX + 1):
        name = A.move_name(m)
        at = A.attack(m)
        c = A.contest_move(m)
        eff = effects[c['effect_id']]
        vanilla_name = E.move_name(m) if E else None
        entry = dict(
            id=m, name=name, hiragana=kana.to_hiragana(name), romaji=kana.to_romaji(name),
            type=types[at['type_id']], type_id=at['type_id'],
            power=at['power'], accuracy=at['accuracy'], pp=at['pp'],
            category='Physical' if at['type_id'] in PHYSICAL_TYPES else 'Special',
            class_='standard', target=at['target'], priority=at['priority'],
            effect_id=at['effect_id'], effect_chance=at['effect_chance'],
            contact=bool(at['flags'] & 1),
            description=eff['description'],
            battle_description=clean(A.fixed(info_base + (m - 1) * 56, 56)) if info_base else None,
            contest=dict(
                type=CONTEST_TYPES[c['type_id']], type_en=CONTEST_TYPE_EN[c['type_id']], type_id=c['type_id'],
                effect_id=c['effect_id'], appeal=eff['appeal'], jam=eff['jam'], effect_class=eff['class'],
                description=eff['description'],
                combo_starter_id=c['combo_starter_id'],
                combo_prev_ids=c['combo_prev_ids'],
            ),
            vanilla_name=vanilla_name if vanilla_name != name else None,
        )
        entry['class'] = entry.pop('class_')
        moves.append(entry)
    byid = {mv['id']: mv for mv in moves}
    # combo links (names)
    for mv in moves:
        prev = [starters[x] for x in mv['contest']['combo_prev_ids'] if x in starters]
        mv['contest']['combo_from'] = [byid[p]['name'] for p in prev]
        mv['contest']['combo_from_ids'] = prev
    for mv in moves:
        sid = mv['contest']['combo_starter_id']
        follow = [o for o in moves if sid and sid in o['contest']['combo_prev_ids']]
        mv['contest']['combo_to'] = [o['name'] for o in follow]
        mv['contest']['combo_to_ids'] = [o['id'] for o in follow]
    # kakeru annotations (matched by the vanilla name that occupies the slot)
    if kakeru:
        def norm(s): return s.translate(str.maketrans('０１２３４５６７８９', '0123456789'))
        km = {norm(k): v for k, v in kakeru['moves'].items()}; kc = kakeru['categories']
        kcombo = {norm(k): v for k, v in kakeru['combos'].items()}
        hit = 0
        for mv in moves:
            key = mv['vanilla_name'] or mv['name']
            k = km.get(key)
            if not k: continue
            hit += 1
            cat = kc.get(k['code'], {})
            mv['kakeru'] = dict(name=key, code=k['code'], type=k['type'], combo_starter=k['combo_starter'],
                                effect_text=cat.get('effect_text'), effect=cat.get('effect'),
                                commentary=cat.get('commentary'),
                                combos=[dict(c, move=norm(c['move'])) for c in kcombo.get(key, [])])
        print(f'kakeru matched {hit}/{len(moves)} moves')

    # ---------------- species ----------------
    tmlist = A.tm_list(); tutlist = A.tutor_list(); eggs = A.egg_moves()
    pokemon = []
    placeholder = re.compile(r'^(.)\1{0,4}$')
    for s in range(1, SPECIES_MAX + 1):
        name = A.species_name(s)
        if s in EXCLUDED_SPECIES or not name or placeholder.match(name) or name.startswith('？'):
            continue
        b = A.base(s); bS = S.base(s)
        nat = A.natdex(s); dx = A.dex(nat); dxS = S.dex(nat)
        def learn(R):
            lv = R.lvlup(s); tm = R.tm_moves(s, tmlist); tu = R.tutor_moves(s, tutlist); eg = eggs.get(s, [])
            ids = {m for _, m in lv} | {m for _, m in tm} | set(tu) | set(eg)
            return lv, tm, tu, eg, ids
        lvA, tmA, tuA, egA, idsA = learn(A)
        lvS, tmS, tuS, egS, idsS = learn(S)
        ids_union = sorted(idsA | idsS)
        def names(ids): return [byid[i]['name'] for i in ids if i in byid]
        entry = dict(
            id=s, dex=nat, name=name, hiragana=kana.to_hiragana(name), romaji=kana.to_romaji(name),
            basestats=[b['hp'], b['atk'], b['df'], b['spa'], b['spd'], b['spe']],
            type=[types[b['type1']]] + ([types[b['type2']]] if b['type2'] != b['type1'] else []),
            ability=[A.ability_name(b['ability1'])] + ([A.ability_name(b['ability2'])] if b['ability2'] else []),
            weight=dx['weight'] / 10, height=dx['height'] / 10, category=dx['category'].strip(),
            dex_text=clean(dx['text']),
            moves=names(ids_union), move_ids=ids_union,
            learn=dict(level=[dict(level=l, move=byid[m]['name'], id=m) for l, m in lvA if m in byid],
                       tm=[dict(machine=lab, move=byid[m]['name'], id=m) for lab, m in tmA if m in byid],
                       tutor=[dict(move=byid[m]['name'], id=m) for m in tuA if m in byid],
                       egg=[dict(move=byid[m]['name'], id=m) for m in egA if m in byid]),
            can_evolve=A.can_evolve(s), evolutions=A.evolutions(s),
            altair_only=names(sorted(idsA - idsS)), sirius_only=names(sorted(idsS - idsA)),
            altair_only_ids=sorted(idsA - idsS), sirius_only_ids=sorted(idsS - idsA),
        )
        entry['dex_text_sirius'] = clean(dxS['text'])
        if b != bS or lvA != lvS or dx['weight'] != dxS['weight'] or dx['height'] != dxS['height']:
            entry['version_differs'] = True
            entry['sirius'] = dict(
                basestats=[bS['hp'], bS['atk'], bS['df'], bS['spa'], bS['spd'], bS['spe']],
                type=[types[bS['type1']]] + ([types[bS['type2']]] if bS['type2'] != bS['type1'] else []),
                ability=[S.ability_name(bS['ability1'])] + ([S.ability_name(bS['ability2'])] if bS['ability2'] else []),
                weight=dxS['weight'] / 10, height=dxS['height'] / 10, category=dxS['category'].strip(),
                dex_text=clean(dxS['text']),
                learn=dict(level=[dict(level=l, move=byid[m]['name'], id=m) for l, m in lvS if m in byid]),
            )
        pokemon.append(entry)

    meta = dict(
        source_roms={k: os.path.basename(v) for k, v in ROMS.items()},
        counts=dict(moves=len(moves), pokemon=len(pokemon), contest_effects=len(effects)),
        renamed_moves=[dict(id=mv['id'], name=mv['name'], vanilla_name=mv['vanilla_name']) for mv in moves if mv['vanilla_name']],
        version_differs=[p['name'] for p in pokemon if p.get('version_differs')],
        contest_types=CONTEST_TYPES,
        notes=[
            'basestats の順は HP, こうげき, ぼうぎょ, とくこう, とくぼう, すばやさ',
            'description はコンテスト技説明（ROM内 WazaSetumeiMsgTbl）、battle_description はステータス画面の技説明',
            'contest.appeal / jam はハート数（ROM値を10で割った値）',
            'kakeru はスロットの原作技名（vanilla_name）で対応付けた、かけるのページの効果別分類。改名された30技のコンテストデータはROM上で原作技のまま',
            'dex_text はアルタイル版、dex_text_sirius はシリウス版の図鑑説明文（全種で版ごとに文が違う）',
            'moves はレベル技・わざマシン・技教え・タマゴ技の和集合。altair_only / sirius_only は片方の版だけの技',
        ],
    )
    def dump(name, obj):
        p = os.path.join(args.out, name)
        json.dump(obj, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('wrote', p, os.path.getsize(p), 'bytes')
    dump('pokemon_moves.json', moves)
    dump('all_pokemon_data.json', pokemon)
    dump('contest_effects.json', effects)
    dump('data_meta.json', meta)
    print('renamed moves:', len(meta['renamed_moves']), 'version differs:', meta['version_differs'])
    print('battle move info table at', hex(info_base) if info_base else None)
    print('sample move:', json.dumps(byid[1], ensure_ascii=False)[:600])
    print('sample pokemon:', json.dumps([p for p in pokemon if p['id'] == 150][0], ensure_ascii=False)[:900])


if __name__ == '__main__':
    main()
