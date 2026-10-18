// アルタイル・シリウス 技逆引き
// all_pokemon_data.json / pokemon_moves.json は両ROMから抽出したデータ。
// pokemon_links.json は無くても動く（あればポケモン名をリンクにする）。

let pokemonData = [];
let moveList = [];
let moveById = new Map();
let pokemonLinks = {};
let learnersCache = new Map();

// 表示対象のバージョン。both は「アルタイル版・シリウス版のどちらかで覚える」。
// 版ごとに習得技が違うポケモンがいるため、版をまたいだ技の組み合わせは出さない。
const VERSIONS = ["altair", "sirius"];
const VERSION_LABEL = { altair: "アルタイル", sirius: "シリウス" };
let versionMode = "both";

const CATEGORY_LABEL = { Physical: "物理", Special: "特殊", Status: "変化" };

const CONTEST_TYPES = ["かっこよさ", "うつくしさ", "かわいさ", "かしこさ", "たくましさ"];
const CONTEST_COLOR = {
  かっこよさ: "#e0452f", うつくしさ: "#3b82d6", かわいさ: "#e8629f",
  かしこさ: "#2f9e57", たくましさ: "#c98a08",
};

const TYPE_COLOR = {
  ノーマル: "#9099a1", ほのお: "#ff9d55", みず: "#4d90d5", でんき: "#f4d23c",
  くさ: "#63bc5a", こおり: "#73cec0", かくとう: "#ce4069", どく: "#ab6ac8",
  じめん: "#d97845", ひこう: "#8fa9de", エスパー: "#fa7179", むし: "#90c12c",
  いわ: "#c7b78b", ゴースト: "#5269ac", ドラゴン: "#0b6dc3", あく: "#5a5465",
  はがね: "#5a8ea1", フェアリー: "#ec8fe6", "???": "#68a090",
};

const VANILLA_TIP =
  "この技は原作（エメラルド）の技を差し替えたものです。ROM内のコンテスト用データ" +
  "（タイプ・アピール・コンボ・説明文）は、元の技のままです。";

// ==============================
// 検索用の文字列正規化
// ==============================
function toHiragana(s) {
  return s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function norm(s) {
  return toHiragana(String(s || "").trim().toLowerCase());
}

// ==============================
// データ読み込み
// ==============================
function loadOptionalLinks() {
  return fetch("pokemon_links.json")
    .then(r => (r && r.ok !== false ? r.json() : {}))
    .then(j => (j && typeof j === "object" ? j : {}))
    .catch(() => ({}));
}

Promise.all([
  fetch("all_pokemon_data.json").then(r => r.json()),
  fetch("pokemon_moves.json").then(r => r.json()),
  loadOptionalLinks(),
])
  .then(([pData, mData, links]) => {
    pokemonData = pData;
    moveList = mData;
    pokemonLinks = links;
    moveById = new Map(moveList.map(m => [m.id, m]));
    pokemonData.forEach(p => {
      p._n = norm(p.name);
      p._h = norm(p.hiragana);
      p._r = norm(p.romaji);
      const moves = Array.isArray(p.move_ids) ? p.move_ids : [];
      const altairOnly = new Set(p.altair_only_ids || []);
      const siriusOnly = new Set(p.sirius_only_ids || []);
      p._moves = {
        both: moves,
        altair: moves.filter(id => !siriusOnly.has(id)),
        sirius: moves.filter(id => !altairOnly.has(id)),
      };
      p._moveSets = {
        both: new Set(p._moves.both),
        altair: new Set(p._moves.altair),
        sirius: new Set(p._moves.sirius),
      };
      // その技を片方の版でしか覚えないなら、その版名を持たせる
      p._exclusive = new Map();
      altairOnly.forEach(id => p._exclusive.set(id, "altair"));
      siriusOnly.forEach(id => p._exclusive.set(id, "sirius"));
    });
    moveList.forEach(m => {
      m._n = norm(m.name);
      m._r = norm(m.romaji);
      m._v = norm(m.vanilla_name);
    });
    renderContestTypeBox();
    console.log(`Loaded ${pokemonData.length} Pokemon / ${moveList.length} moves / ${Object.keys(pokemonLinks).length} links`);
  })
  .catch(err => {
    console.error("Failed to load data:", err);
    ["moveResult", "andResult", "pokemonResult", "contestTypeResult"].forEach(id => {
      document.getElementById(id).innerHTML = "<li>データ読み込みエラー（ローカルHTTPサーバーから開いてください）</li>";
    });
  });

// ==============================
// 検索ロジック
// ==============================
function findMoves(word) {
  const w = norm(word);
  if (w.length < 2) return [];
  const exact = [];
  const prefix = [];
  const partial = [];
  moveList.forEach(m => {
    if (m._n === w || m._r === w) exact.push(m);
    else if (m._n.startsWith(w) || m._r.startsWith(w)) prefix.push(m);
    else if (m._n.includes(w) || m._r.includes(w) || (m._v && m._v.includes(w))) partial.push(m);
  });
  return [...exact, ...prefix, ...partial];
}

function findPokemon(word) {
  const w = norm(word);
  if (w.length < 2) return [];
  const exact = [];
  const prefix = [];
  const partial = [];
  pokemonData.forEach(p => {
    if (p._n === w || p._h === w || p._r === w) exact.push(p);
    else if (p._n.startsWith(w) || p._h.startsWith(w) || p._r.startsWith(w)) prefix.push(p);
    else if (p._n.includes(w) || p._h.includes(w) || p._r.includes(w)) partial.push(p);
  });
  return [...exact, ...prefix, ...partial];
}

// 指定の技をすべて「同じ版で」覚える版の一覧。
function versionsKnowingAll(p, moveIds) {
  return VERSIONS.filter(v => moveIds.every(id => p._moveSets[v].has(id)));
}

function learnersOf(moveIds) {
  const key = [versionMode, ...moveIds].join("|");
  if (learnersCache.has(key)) return learnersCache.get(key);
  const hit = [];
  pokemonData.forEach(p => {
    const versions = versionsKnowingAll(p, moveIds);
    if (versionMode === "both") {
      if (versions.length) hit.push({ pokemon: p, versions });
    } else if (versions.includes(versionMode)) {
      hit.push({ pokemon: p, versions: [versionMode] });
    }
  });
  learnersCache.set(key, hit);
  return hit;
}

function learners(moveId) {
  return learnersOf([moveId]);
}

// そのポケモンが技を覚える方法（レベル・わざマシン・教え技・タマゴ）
function learnSources(p, moveId) {
  const out = [];
  const learn = p.learn || {};
  let levels = learn.level || [];
  if (versionMode === "sirius" && p.version_differs && p.sirius && p.sirius.learn && p.sirius.learn.level) {
    levels = p.sirius.learn.level;
  }
  levels.filter(e => e.id === moveId).forEach(e => out.push("Lv." + e.level));
  if ((learn.tm || []).some(e => e.id === moveId)) out.push("わざマシン");
  if ((learn.tutor || []).some(e => e.id === moveId)) out.push("教え技");
  if ((learn.egg || []).some(e => e.id === moveId)) out.push("タマゴ");
  return out;
}

// ==============================
// 描画パーツ
// ==============================
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function versionBadge(version) {
  return el("span", "ver-badge ver-" + version, VERSION_LABEL[version] + "のみ");
}

function typeBadge(type) {
  const span = el("span", "type-badge", type);
  span.style.background = TYPE_COLOR[type] || "#888";
  return span;
}

function contestBadge(type) {
  const span = el("span", "contest-badge", type);
  span.style.background = CONTEST_COLOR[type] || "#888";
  return span;
}

// ◎ × アピール（赤）、● × ジャム（黒）
function heartsEl(move, withLabels) {
  const c = move.contest || {};
  const wrap = el("span", "hearts");
  const ap = el("span", "hearts-appeal", c.appeal > 0 ? "◎".repeat(c.appeal) : "");
  ap.title = `アピール ${c.appeal}`;
  const jam = el("span", "hearts-jam", c.jam > 0 ? "●".repeat(c.jam) : "");
  jam.title = `ジャム ${c.jam}`;
  if (withLabels) {
    wrap.appendChild(el("span", "stat-key", "アピール"));
    wrap.appendChild(ap);
    wrap.appendChild(el("span", "hearts-num", `(${c.appeal})`));
    wrap.appendChild(el("span", "stat-key hearts-gap", "ジャム"));
    wrap.appendChild(jam);
    wrap.appendChild(el("span", "hearts-num", `(${c.jam})`));
  } else {
    wrap.appendChild(ap);
    wrap.appendChild(jam);
  }
  return wrap;
}

function categoryOf(move) {
  // 威力のない技は、データ上の物理/特殊に関わらず「変化」として表示する
  if (!(move.power > 0)) return "Status";
  return move.category;
}

function powerText(move) {
  return move.power > 0 ? String(move.power) : "—";
}

function accuracyText(move) {
  return move.accuracy > 0 ? String(move.accuracy) : "必中";
}

function moveCandidateLabel(move) {
  return move.name;
}

function appendStat(parent, k, v) {
  const cell = el("div", "stat");
  cell.appendChild(el("span", "stat-key", k));
  cell.appendChild(el("span", "stat-val", v));
  parent.appendChild(cell);
}

// 他の技へ移動するボタン（コンボの技名など）
function moveLinkButton(id, label) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "combo-link";
  b.textContent = label;
  b.addEventListener("click", ev => {
    ev.stopPropagation();
    const m = moveById.get(id);
    if (m) jumpToMove(m);
  });
  return b;
}

function comboRow(label, names, ids) {
  const row = el("div", "combo-row");
  row.appendChild(el("span", "stat-key", label));
  if (!names || names.length === 0) {
    row.appendChild(el("span", "combo-none", "なし"));
    return row;
  }
  names.forEach((n, i) => {
    const id = ids && ids[i];
    if (id && moveById.has(id)) row.appendChild(moveLinkButton(id, n));
    else row.appendChild(el("span", "combo-plain", n));
  });
  return row;
}

function kakeruBlock(k) {
  const box = el("div", "kakeru");
  const head = el("div", "kakeru-head");
  head.appendChild(el("span", "kakeru-title", "かけるのページ"));
  head.appendChild(el("span", "kakeru-code", "分類コード " + k.code));
  if (k.combo_starter) head.appendChild(el("span", "kakeru-starter", "コンボの起点になれる"));
  box.appendChild(head);
  if (k.effect_text) {
    const row = el("div", "kakeru-line");
    row.appendChild(el("span", "stat-key", "効果"));
    row.appendChild(el("span", "kakeru-effect", k.effect_text));
    box.appendChild(row);
  }
  if (k.effect) box.appendChild(el("div", "kakeru-detail", k.effect));
  if (k.commentary) {
    const d = document.createElement("details");
    d.className = "kakeru-comment";
    d.appendChild(el("summary", "", "解説"));
    d.appendChild(el("div", "kakeru-comment-body", k.commentary));
    box.appendChild(d);
  }
  if (k.combos && k.combos.length) {
    const wrap = el("div", "kakeru-combos");
    wrap.appendChild(el("span", "stat-key", "コンボ先一覧"));
    k.combos.forEach(c => {
      const item = el("span", "kakeru-combo");
      const t = el("span", "kakeru-combo-code", c.code);
      t.style.background = CONTEST_COLOR[c.type] || "#888";
      t.title = c.type;
      item.appendChild(t);
      const target = moveList.find(m => m.name === c.move);
      if (target) item.appendChild(moveLinkButton(target.id, c.move));
      else item.appendChild(el("span", "combo-plain", c.move));
      wrap.appendChild(item);
    });
    box.appendChild(wrap);
  }
  return box;
}

// 技情報カード（コンテスト情報を主、バトル情報を従で表示）
function moveInfoCard(move, opts = {}) {
  const card = el("div", "move-card");
  const c = move.contest || null;
  if (c) card.style.borderLeftColor = CONTEST_COLOR[c.type] || "#4a90e2";

  const head = el("div", "move-card-head");
  head.appendChild(el("span", "move-card-name", move.name));
  if (c) head.appendChild(contestBadge(c.type));
  if (opts.learnerCount !== undefined) {
    head.appendChild(el("span", "learner-count", `${opts.learnerCount}体が習得`));
  }
  card.appendChild(head);

  if (move.vanilla_name) {
    const v = el("div", "vanilla-note");
    const tag = el("span", "vanilla-tag", "原作名: " + move.vanilla_name);
    tag.title = VANILLA_TIP;
    v.appendChild(tag);
    v.appendChild(el("span", "vanilla-text", "コンテストの数値・説明はこの原作の技のまま"));
    v.title = VANILLA_TIP;
    card.appendChild(v);
  }

  // ---- コンテスト ----
  if (c) {
    const cs = el("div", "contest-section");
    cs.appendChild(el("div", "section-title", "コンテスト"));
    const line = el("div", "contest-line");
    line.appendChild(heartsEl(move, true));
    line.appendChild(el("span", "effect-class", c.effect_class));
    cs.appendChild(line);
    if (c.description) cs.appendChild(el("div", "move-desc contest-desc", c.description));
    cs.appendChild(comboRow("この技から繋がる技", c.combo_to, c.combo_to_ids));
    cs.appendChild(comboRow("この技に繋がる元の技", c.combo_from, c.combo_from_ids));
    if (move.kakeru) cs.appendChild(kakeruBlock(move.kakeru));
    card.appendChild(cs);
  }

  // ---- バトル（副） ----
  const bs = el("div", "battle-section");
  bs.appendChild(el("div", "section-title", "バトル"));
  const stats = el("div", "move-stats");
  const typeCell = el("div", "stat");
  typeCell.appendChild(el("span", "stat-key", "タイプ"));
  typeCell.appendChild(typeBadge(move.type));
  stats.appendChild(typeCell);
  const cat = categoryOf(move);
  const catCell = el("div", "stat");
  catCell.appendChild(el("span", "stat-key", "分類"));
  catCell.appendChild(el("span", "cat-badge cat-" + cat.toLowerCase(), CATEGORY_LABEL[cat] || cat));
  stats.appendChild(catCell);
  appendStat(stats, "威力", powerText(move));
  appendStat(stats, "命中", accuracyText(move));
  appendStat(stats, "PP", String(move.pp));
  appendStat(stats, "接触", move.contact ? "する" : "しない");
  bs.appendChild(stats);
  if (move.battle_description) bs.appendChild(el("div", "move-desc battle-desc", move.battle_description));
  card.appendChild(bs);

  return card;
}

// 技1行のまとめ（ポケモン → 技 の一覧用）
function moveSummaryText(move) {
  const cat = categoryOf(move);
  return [CATEGORY_LABEL[cat] || cat, "威力" + powerText(move), "命中" + accuracyText(move)].join(" / ");
}

function pokemonNameEl(p, className) {
  const url = pokemonLinks[p.name];
  if (url) {
    const a = el("a", "pokemon-link " + (className || ""), p.name);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }
  return el("span", "pokemon-nolink " + (className || ""), p.name);
}

function pokemonListItem(p, versions, moveId) {
  const li = document.createElement("li");
  li.appendChild(pokemonNameEl(p));
  const types = el("span", "inline-types");
  (p.type || []).forEach(t => types.appendChild(typeBadge(t)));
  li.appendChild(types);
  if (versionMode === "both" && Array.isArray(versions) && versions.length === 1) {
    li.appendChild(versionBadge(versions[0]));
  }
  if (moveId !== undefined) {
    const src = learnSources(p, moveId);
    if (src.length) {
      const tags = el("span", "learn-tags");
      src.forEach(s => tags.appendChild(el("span", "learn-tag", s)));
      li.appendChild(tags);
    }
  }
  return li;
}

function renderCandidates(container, items, current, labelOf, onPick) {
  container.innerHTML = "";
  if (items.length <= 1) return;
  const shown = items.slice(0, 30);
  shown.forEach(item => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (item === current ? " active" : "");
    chip.textContent = labelOf(item);
    chip.addEventListener("click", () => onPick(item));
    container.appendChild(chip);
  });
  if (items.length > shown.length) {
    container.appendChild(el("span", "chip-more", `他${items.length - shown.length}件`));
  }
}

function setMessage(target, text) {
  target.innerHTML = "";
  if (text) target.appendChild(el("li", "message", text));
}

function debounce(fn, ms) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

function dataReady(resultEl) {
  if (pokemonData.length === 0) {
    setMessage(resultEl, "データ読み込み中...");
    return false;
  }
  return true;
}

// ==============================
// 技名 → 覚えるポケモン
// ==============================
const moveInput = document.getElementById("moveInput");
const moveCandidates = document.getElementById("moveCandidates");
const moveInfo = document.getElementById("moveInfo");
const moveCount = document.getElementById("moveCount");
const moveResult = document.getElementById("moveResult");
let moveMatches = [];
let currentMove = null;

function showMove(move) {
  currentMove = move;
  moveInfo.innerHTML = "";
  moveResult.innerHTML = "";
  moveCount.textContent = "";
  renderCandidates(moveCandidates, moveMatches, move, moveCandidateLabel, showMove);

  const hit = learners(move.id);
  moveInfo.appendChild(moveInfoCard(move, { learnerCount: hit.length }));

  if (hit.length === 0) {
    setMessage(moveResult, "この技を覚えるポケモンはいません");
    return;
  }
  moveCount.textContent = `覚えるポケモン ${hit.length}体`;
  hit.forEach(h => moveResult.appendChild(pokemonListItem(h.pokemon, h.versions, move.id)));
}

// コンボ先などから、技名検索ボックスへ切り替える
function jumpToMove(move) {
  moveInput.value = move.name;
  moveMatches = findMoves(move.name);
  if (!moveMatches.includes(move)) moveMatches = [move];
  showMove(move);
  if (moveInput.scrollIntoView) {
    try { moveInput.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { /* 無視 */ }
  }
}

const runMoveSearch = debounce(function (word) {
  moveCandidates.innerHTML = "";
  moveInfo.innerHTML = "";
  moveCount.textContent = "";
  moveResult.innerHTML = "";
  currentMove = null;
  if (norm(word).length < 2) return;
  if (!dataReady(moveResult)) return;

  moveMatches = findMoves(word);
  if (moveMatches.length === 0) {
    setMessage(moveResult, `候補なし（${moveList.length}技中0件）`);
    return;
  }
  showMove(moveMatches[0]);
}, 300);

moveInput.addEventListener("input", function () {
  runMoveSearch(this.value);
});

// ==============================
// 技AND検索
// ==============================
const andMove1 = document.getElementById("andMove1");
const andMove2 = document.getElementById("andMove2");
const andCandidates1 = document.getElementById("andCandidates1");
const andCandidates2 = document.getElementById("andCandidates2");
const andInfo = document.getElementById("andInfo");
const andCount = document.getElementById("andCount");
const andResult = document.getElementById("andResult");
let andMatches = [[], []];
let andPicked = [null, null];

function renderAnd() {
  andInfo.innerHTML = "";
  andCount.textContent = "";
  andResult.innerHTML = "";
  renderCandidates(andCandidates1, andMatches[0], andPicked[0], moveCandidateLabel, m => {
    andPicked[0] = m;
    renderAnd();
  });
  renderCandidates(andCandidates2, andMatches[1], andPicked[1], moveCandidateLabel, m => {
    andPicked[1] = m;
    renderAnd();
  });

  const [m1, m2] = andPicked;
  if (m1) andInfo.appendChild(moveInfoCard(m1, { learnerCount: learners(m1.id).length }));
  if (m2) andInfo.appendChild(moveInfoCard(m2, { learnerCount: learners(m2.id).length }));
  if (!m1 || !m2) return;

  const hit = learnersOf([m1.id, m2.id]);
  if (hit.length === 0) {
    setMessage(andResult, "両方を覚えるポケモンはいません");
    return;
  }
  andCount.textContent = `両方覚えるポケモン ${hit.length}体`;
  hit.forEach(h => andResult.appendChild(pokemonListItem(h.pokemon, h.versions)));
}

const runAndSearch = debounce(function () {
  const words = [andMove1.value, andMove2.value];
  if (!dataReady(andResult)) return;
  andMatches = words.map(w => (norm(w).length >= 2 ? findMoves(w) : []));
  andPicked = andMatches.map(list => list[0] || null);
  andCandidates1.innerHTML = "";
  andCandidates2.innerHTML = "";
  andInfo.innerHTML = "";
  andCount.textContent = "";
  andResult.innerHTML = "";
  if (andMatches.some((list, i) => norm(words[i]).length >= 2 && list.length === 0)) {
    setMessage(andResult, "候補なし（存在しない技名があります）");
    return;
  }
  renderAnd();
}, 300);

andMove1.addEventListener("input", runAndSearch);
andMove2.addEventListener("input", runAndSearch);

// ==============================
// ポケモン名 → 覚える技
// ==============================
const pokemonInput = document.getElementById("pokemonInput");
const pokemonCandidates = document.getElementById("pokemonCandidates");
const pokemonProfile = document.getElementById("pokemonProfile");
const moveFilter = document.getElementById("moveFilter");
const contestFilter = document.getElementById("contestFilter");
const moveSort = document.getElementById("moveSort");
const pokemonCount = document.getElementById("pokemonCount");
const pokemonResult = document.getElementById("pokemonResult");
let pokemonMatches = [];
let pickedPokemon = null;
let contestFilterType = null; // null = すべて

const STAT_LABELS = ["HP", "攻撃", "防御", "特攻", "特防", "素早さ"];

// 版ごとのプロフィール欄
function profileColumn(data, version) {
  const col = el("div", "profile-col" + (version ? " profile-" + version : ""));
  if (version) {
    const mark = versionMode === version ? "（表示中）" : "";
    col.appendChild(el("div", "profile-version ver-" + version, VERSION_LABEL[version] + mark));
  }
  const head = el("div", "profile-head");
  (data.type || []).forEach(t => head.appendChild(typeBadge(t)));
  col.appendChild(head);
  const stats = (data.basestats || []).map((v, i) => `${STAT_LABELS[i]} ${v}`).join(" / ");
  const total = (data.basestats || []).reduce((a, b) => a + b, 0);
  col.appendChild(el("div", "profile-meta", `特性: ${(data.ability || []).join(" / ") || "—"}　体重: ${data.weight}kg`));
  col.appendChild(el("div", "profile-meta", `種族値: ${stats}（合計 ${total}）`));
  return col;
}

function renderProfile(p) {
  pokemonProfile.innerHTML = "";
  const top = el("div", "profile-top");
  top.appendChild(pokemonNameEl(p, "profile-name"));
  pokemonProfile.appendChild(top);
  if (p.version_differs && p.sirius) {
    const grid = el("div", "profile-versions");
    grid.appendChild(profileColumn(p, "altair"));
    grid.appendChild(profileColumn(p.sirius, "sirius"));
    pokemonProfile.appendChild(grid);
    pokemonProfile.appendChild(el("div", "profile-diff-note", "このポケモンは版によって種族値・タイプ・習得技が違います。"));
  } else {
    pokemonProfile.appendChild(profileColumn(p, null));
  }
}

function renderContestFilterButtons(container, current, onPick, withAll) {
  container.innerHTML = "";
  const make = (label, value) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cf-btn" + (current === value ? " active" : "");
    b.textContent = label;
    b.dataset.type = value === null ? "" : value;
    if (value) b.style.setProperty("--cf-color", CONTEST_COLOR[value]);
    b.addEventListener("click", () => onPick(current === value ? null : value));
    container.appendChild(b);
  };
  if (withAll) make("すべて", null);
  CONTEST_TYPES.forEach(t => make(t, t));
}

function sortedMoveIds(ids, mode) {
  if (mode === "default") return ids;
  const arr = ids.map((id, i) => ({ id, i, m: moveById.get(id) }));
  const key = {
    "appeal-desc": x => -(x.m && x.m.contest ? x.m.contest.appeal : -1),
    "appeal-asc": x => (x.m && x.m.contest ? x.m.contest.appeal : 99),
    "power-desc": x => -(x.m ? x.m.power : -1),
  }[mode];
  arr.sort((a, b) => key(a) - key(b) || a.i - b.i);
  return arr.map(x => x.id);
}

function moveRow(move, exclusive) {
  const li = document.createElement("li");
  const row = el("span", "move-name expandable");
  row.title = "クリックで技情報と説明文を表示";
  row.appendChild(el("span", "move-label", move.name));
  row.appendChild(contestBadge(move.contest.type));
  const hearts = heartsEl(move, false);
  hearts.classList.add("row-hearts");
  row.appendChild(hearts);
  row.appendChild(typeBadge(move.type));
  if (versionMode === "both" && exclusive) row.appendChild(versionBadge(exclusive));
  row.appendChild(el("span", "move-summary", moveSummaryText(move)));

  const detail = el("div", "move-detail");
  detail.appendChild(moveInfoCard(move));
  row.addEventListener("click", () => detail.classList.toggle("show"));
  li.appendChild(row);
  li.appendChild(detail);
  return li;
}

function renderContestFilter() {
  renderContestFilterButtons(contestFilter, contestFilterType, t => {
    contestFilterType = t;
    renderPokemonMoves();
  }, true);
}

function renderPokemonMoves() {
  pokemonResult.innerHTML = "";
  pokemonCount.textContent = "";
  renderContestFilter();
  if (!pickedPokemon) return;

  const all = pickedPokemon._moves[versionMode];
  if (all.length === 0) {
    setMessage(pokemonResult, "技データなし");
    return;
  }
  const f = norm(moveFilter.value);
  let shownIds = all.filter(moveId => {
    const m = moveById.get(moveId);
    if (!m) return !f && !contestFilterType;
    if (contestFilterType && m.contest.type !== contestFilterType) return false;
    if (!f) return true;
    return m._n.includes(f) || m._r.includes(f) || norm(m.type).includes(f) || norm(m.contest.type).includes(f);
  });
  shownIds = sortedMoveIds(shownIds, moveSort.value);

  pokemonCount.textContent = shownIds.length !== all.length
    ? `覚える技 ${shownIds.length} / ${all.length}件`
    : `覚える技 ${all.length}件`;

  if (shownIds.length === 0) {
    setMessage(pokemonResult, "絞り込み条件に合う技なし");
    return;
  }

  shownIds.forEach(moveId => {
    const move = moveById.get(moveId);
    if (!move) {
      const li = document.createElement("li");
      li.appendChild(el("span", "move-name", `技ID ${moveId} （技データなし）`));
      pokemonResult.appendChild(li);
      return;
    }
    pokemonResult.appendChild(moveRow(move, pickedPokemon._exclusive.get(moveId)));
  });
}

function showPokemon(p) {
  pickedPokemon = p;
  renderCandidates(pokemonCandidates, pokemonMatches, p, x => x.name, showPokemon);
  renderProfile(p);
  renderPokemonMoves();
}

const runPokemonSearch = debounce(function (word) {
  pokemonCandidates.innerHTML = "";
  pokemonProfile.innerHTML = "";
  pokemonResult.innerHTML = "";
  pokemonCount.textContent = "";
  pickedPokemon = null;
  if (norm(word).length < 2) return;
  if (!dataReady(pokemonResult)) return;

  pokemonMatches = findPokemon(word);
  if (pokemonMatches.length === 0) {
    setMessage(pokemonResult, `候補なし（${pokemonData.length}体中0体）`);
    return;
  }
  showPokemon(pokemonMatches[0]);
}, 300);

pokemonInput.addEventListener("input", function () {
  runPokemonSearch(this.value);
});
moveFilter.addEventListener("input", debounce(renderPokemonMoves, 200));
moveSort.addEventListener("change", renderPokemonMoves);
renderContestFilter();

// ==============================
// コンテストタイプで技を探す
// ==============================
const contestTypeButtons = document.getElementById("contestTypeButtons");
const contestTypeCount = document.getElementById("contestTypeCount");
const contestTypeResult = document.getElementById("contestTypeResult");
let contestTypePicked = null;

function renderContestTypeBox() {
  renderContestFilterButtons(contestTypeButtons, contestTypePicked, t => {
    contestTypePicked = t;
    renderContestTypeBox();
  }, false);
  contestTypeResult.innerHTML = "";
  contestTypeCount.textContent = "";
  if (!contestTypePicked || moveList.length === 0) return;

  const hit = moveList
    .filter(m => m.contest && m.contest.type === contestTypePicked)
    .sort((a, b) =>
      b.contest.appeal - a.contest.appeal || a.contest.jam - b.contest.jam || a.id - b.id);
  contestTypeCount.textContent = `${contestTypePicked}の技 ${hit.length}件（アピールが高い順）`;
  hit.forEach(m => {
    const li = document.createElement("li");
    const row = el("span", "move-name expandable");
    row.title = "クリックで技情報と説明文を表示";
    row.appendChild(el("span", "move-label", m.name));
    const hearts = heartsEl(m, false);
    hearts.classList.add("row-hearts");
    row.appendChild(hearts);
    row.appendChild(el("span", "effect-class small", m.contest.effect_class));
    row.appendChild(typeBadge(m.type));
    const detail = el("div", "move-detail");
    detail.appendChild(moveInfoCard(m));
    row.addEventListener("click", () => detail.classList.toggle("show"));
    li.appendChild(row);
    li.appendChild(detail);
    contestTypeResult.appendChild(li);
  });
}
renderContestTypeBox();

// ==============================
// バージョン切り替え
// ==============================
const versionSelect = document.getElementById("versionSelect");
const versionNote = document.getElementById("versionNote");

const VERSION_NOTE = {
  both: "アルタイル版・シリウス版のどちらかで覚える技を表示します。片方だけの技には版名を付けます。",
  altair: "アルタイル版で覚える技だけを表示します。",
  sirius: "シリウス版で覚える技だけを表示します。",
};

function applyVersion(mode) {
  if (!VERSION_NOTE[mode] || mode === versionMode) return;
  versionMode = mode;
  versionNote.textContent = VERSION_NOTE[mode];
  if (currentMove) showMove(currentMove);
  if (andPicked[0] || andPicked[1]) renderAnd();
  if (pickedPokemon) showPokemon(pickedPokemon);
}

versionSelect.addEventListener("change", function (event) {
  if (event.target && event.target.name === "version") applyVersion(event.target.value);
});
versionNote.textContent = VERSION_NOTE[versionMode];
