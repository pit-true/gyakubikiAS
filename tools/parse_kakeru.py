import re, html, json, sys, os, glob

SRC = "https://www2u.biglobe.ne.jp/~kakeru/pokemon_a/contest/"
TYPES = ["かっこよさ", "うつくしさ", "かわいさ", "かしこさ", "たくましさ"]
SHORT = {"格": "かっこよさ", "美": "うつくしさ", "愛": "かわいさ", "賢": "かしこさ", "逞": "たくましさ"}


def read(p):
    with open(p, "rb") as f:
        return f.read().decode("cp932", errors="replace")


def norm(s):
    return re.sub(r"\s+", " ", html.unescape(s).replace("\u3000", " ")).strip()


def strip_tags(s):
    return re.sub(r"<[^>]*>", "", s)


def lines_of(s):
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</h\d>", "\n", s)
    s = html.unescape(strip_tags(s)).replace("\u3000", " ")
    return [re.sub(r"[ \t\r]+", " ", l).strip() for l in s.split("\n") if l.strip()]


def parse_index(path):
    d = read(path)
    cats, moves = {}, {}
    rows = re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", d)
    for r in rows:
        cells = re.findall(r"(?is)<td[^>]*>(.*?)</td>", r)
        if len(cells) < 7:
            continue
        code = norm(strip_tags(cells[0]))
        if not re.fullmatch(r"\d+-[A-Z]", code):
            continue
        c2 = norm(strip_tags(cells[1]))
        appeal, jam = c2.count("◎"), c2.count("●")
        text = norm(c2.replace("◎", "").replace("●", ""))
        cats[code] = {"appeal": appeal, "jam": jam, "effect_text": text}
        for i in range(5):
            c = cells[2 + i]
            c = re.sub(r'(?is)<a\s[^>]*href="([^"]*)"[^>]*>(.*?)</a>',
                       lambda m: "\x01%s\x02%s\x03" % (m.group(1), m.group(2)), c)
            c = re.sub(r"(?i)<br\s*/?>", "\n", c)
            c = html.unescape(strip_tags(c))
            for seg in c.split("\n"):
                href = None
                m = re.search(r"\x01([^\x02]*)\x02", seg)
                if m:
                    href = m.group(1)
                name = norm(seg.replace("\x01" + (href or "") + "\x02", "").replace("\x03", "")) if m else norm(seg)
                if not name or name == "-":
                    continue
                if name in moves:
                    print("WARNING: duplicate move %s (%s/%s vs %s/%s)" % (
                        name, code, TYPES[i], moves[name]["code"], moves[name]["type"]), file=sys.stderr)
                    continue
                moves[name] = {"code": code, "type": TYPES[i],
                               "combo_starter": href is not None, "combo_page": href}
    return cats, moves


def parse_reference(path):
    d = read(path)
    parts = re.split(r"(?is)<h3[^>]*>(.*?)</h3>", d)
    out = {}
    for k in range(1, len(parts), 2):
        code = norm(strip_tags(parts[k]))
        if not re.fullmatch(r"\d+-[A-Z]", code):
            continue
        body = parts[k + 1]
        ls = lines_of(body)
        eff, com, mode = [], [], None
        for l in ls:
            if l.startswith("効果："):
                mode = eff
                l = l[3:].strip()
            elif l.startswith("解説："):
                mode = com
                l = l[3:].strip()
            if mode is not None and l:
                mode.append(l)
        out[code] = {"effect": "\n".join(eff), "commentary": "\n".join(com)}
    return out


# かけるのページ側の誤記。ROM のコンボデータと照らして直す（こらえる→いたみわけ）
TYPO_FIX = {"いわみわけ": "いたみわけ"}


def parse_combos(folder):
    combos = {}
    for p in sorted(glob.glob(os.path.join(folder, "lzh", "contest", "*.htm"))):
        if os.path.basename(p).lower() == "index.htm":
            continue
        d = read(p)
        m = re.search(r"(?is)<title>(.*?)</title>", d)
        title = norm(strip_tags(m.group(1))) if m else os.path.basename(p)
        body = d.split("</title>", 1)[-1]
        hm = re.search(r"「(.+?)」からのコンボ", norm(strip_tags(body)))
        if hm:
            if hm.group(1) != title:
                print("NOTE: %s: title %r differs from heading %r; using heading" % (os.path.basename(p), title, hm.group(1)), file=sys.stderr)
            title = hm.group(1)
        lst = []
        for l in lines_of(body):
            l = norm(l)
            m = re.fullmatch(r"([格美愛賢逞]) (\d+-[A-Z]) (.+)", l)
            if m:
                lst.append({"type": SHORT[m.group(1)], "code": m.group(2), "move": TYPO_FIX.get(m.group(3), m.group(3))})
        if title in combos:
            print("WARNING: duplicate starter title %s (%s)" % (title, p), file=sys.stderr)
        combos[title] = lst
        combos[title + "\0file"] = os.path.basename(p)
    return combos


def main():
    import argparse
    ap = argparse.ArgumentParser(description="かけるのページのHTML一式(index.htm等)を kakeru_contest.json にまとめる")
    ap.add_argument("folder", help="保存済みHTMLのフォルダ")
    ap.add_argument("out", help="出力JSON")
    a = ap.parse_args()
    folder, outp = a.folder, a.out
    cats, moves = parse_index(os.path.join(folder, "index.htm"))
    ref = parse_reference(os.path.join(folder, "reference.htm"))
    raw = parse_combos(folder)
    combos = {k: v for k, v in raw.items() if "\0" not in k}
    for code, c in cats.items():
        c.update(ref.get(code, {"effect": "", "commentary": ""}))
    out = {"source": SRC, "categories": cats, "moves": moves, "combos": combos}
    with open(outp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    starters = [m for m, v in moves.items() if v["combo_starter"]]
    print("categories:", len(cats), "moves:", len(moves), "starters:", len(starters),
          "combo pages:", len(combos))
    print("in index, missing in reference:", sorted(set(cats) - set(ref)))
    print("in reference, missing in index:", sorted(set(ref) - set(cats)))
    print("starters without combos entry:", [m for m in starters if m not in combos])
    print("combo pages not matching a starter:", [m for m in combos if m not in starters])
    pg = {v["combo_page"] for v in moves.values() if v["combo_page"]}
    files = {raw[k] for k in raw if "\0file" in k}
    print("combo_page hrefs without file:", sorted(pg - files), "files without href:", sorted(files - pg))
    print("empty combo lists:", [k for k, v in combos.items() if not v])
    for n in list(moves)[:5]:
        print(n, json.dumps(moves[n], ensure_ascii=False))
    print("combo total follow-ups:", sum(len(v) for v in combos.values()))
    bad = [(m, v["combo_page"]) for m, v in moves.items() if v["combo_page"] and raw.get(m + "\0file") != v["combo_page"]]
    print("starter name/page mismatches:", bad)


main()
