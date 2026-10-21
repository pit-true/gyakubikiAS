// jsdom で index.html + app.js を実際に読み込み、表示結果を検証する。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");

// ---- ページを1度だけ組み立てる -------------------------------------------
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", err => {
  throw err;
});

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), {
  runScripts: "outside-only",
  virtualConsole,
  url: "http://localhost/",
});
const { window } = dom;

// fetch はローカルファイル読み込みに差し替える（pokemon_links.json は無くてもよい）
window.fetch = url =>
  Promise.resolve({
    json: () => Promise.resolve(JSON.parse(fs.readFileSync(path.join(ROOT, url), "utf8"))),
  });

window.eval(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"));

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const $ = sel => window.document.querySelector(sel);
const all = sel => [...window.document.querySelectorAll(sel)];
const txt = sel => ($(sel) ? $(sel).textContent.replace(/\s+/g, " ").trim() : "");
const flat = sel => txt(sel).replace(/\s+/g, "");

async function type(sel, value) {
  const el = $(sel);
  el.value = value;
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(400);
}

function click(el) {
  el.dispatchEvent(new window.Event("click", { bubbles: true }));
}

function selectVersion(value) {
  const radio = $(`#versionSelect input[value="${value}"]`);
  radio.checked = true;
  radio.dispatchEvent(new window.Event("change", { bubbles: true }));
}

const pokemonJson = JSON.parse(fs.readFileSync(path.join(ROOT, "all_pokemon_data.json"), "utf8"));
const moveJson = JSON.parse(fs.readFileSync(path.join(ROOT, "pokemon_moves.json"), "utf8"));
const effectJson = JSON.parse(fs.readFileSync(path.join(ROOT, "contest_effects.json"), "utf8"));
const metaJson = JSON.parse(fs.readFileSync(path.join(ROOT, "data_meta.json"), "utf8"));
const moveByName = new Map(moveJson.map(m => [m.name, m]));

function moveIdsIn(p, version) {
  if (version === "altair") return p.move_ids.filter(id => !p.sirius_only_ids.includes(id));
  if (version === "sirius") return p.move_ids.filter(id => !p.altair_only_ids.includes(id));
  return p.move_ids;
}

function expectedLearnersById(moveIds, version) {
  const versions = version === "both" ? ["altair", "sirius"] : [version];
  return pokemonJson
    .filter(p => versions.some(v => moveIds.every(id => moveIdsIn(p, v).includes(id))))
    .map(p => p.name);
}

const namesOf = sel => all(`${sel} li .pokemon-nolink, ${sel} li .pokemon-link`).map(e => e.textContent);

const asufia = pokemonJson.find(p => p.name === "アスフィア");

test.before(async () => {
  await wait(300);
});

// ---- データ ---------------------------------------------------------------
test("データ: 件数と必須フィールドがそろっている", () => {
  assert.equal(moveJson.length, metaJson.counts.moves);
  assert.equal(pokemonJson.length, metaJson.counts.pokemon);
  assert.equal(effectJson.length, metaJson.counts.contest_effects);
  for (const m of moveJson) {
    assert.ok(m.contest, `${m.name} にコンテストデータ`);
    assert.ok(["かっこよさ", "うつくしさ", "かわいさ", "かしこさ", "たくましさ"].includes(m.contest.type), m.name);
    assert.ok(Number.isInteger(m.contest.appeal) && Number.isInteger(m.contest.jam), m.name);
    assert.ok(typeof m.description === "string" && m.description.length > 0, m.name);
  }
  assert.equal(moveJson.filter(m => m.vanilla_name).length, metaJson.renamed_moves.length);
});

test("データ読み込み: 先頭と末尾のポケモン・技を検索で引ける", async () => {
  const lastP = pokemonJson[pokemonJson.length - 1];
  await type("#pokemonInput", lastP.name);
  assert.match(txt("#pokemonProfile"), new RegExp("^" + lastP.name));
  const lastM = moveJson[moveJson.length - 1];
  await type("#moveInput", lastM.name);
  assert.match(flat("#moveInfo"), new RegExp("^" + lastM.name));
});

// ---- 技名 → 覚えるポケモン ----------------------------------------------
test("技名検索: コンテスト情報（タイプ・◎・●・分類・説明・コンボ・かける）が出る", async () => {
  selectVersion("both");
  await type("#moveInput", "げきりん");

  const move = moveByName.get("げきりん");
  const info = flat("#moveInfo");
  assert.match(info, /^げきりん/);
  assert.ok(info.includes(move.contest.type), "コンテストタイプ");
  assert.equal($("#moveInfo .hearts-appeal").textContent, "◎".repeat(move.contest.appeal));
  assert.equal($("#moveInfo .hearts-jam").textContent, "●".repeat(move.contest.jam));
  assert.ok(info.includes(move.contest.effect_class), "効果分類");
  assert.equal($("#moveInfo .contest-desc").textContent, move.contest.description);
  assert.ok(info.includes("この技から繋がる技"));
  assert.ok(info.includes("この技に繋がる元の技"));

  // かけるのページ
  assert.ok(move.kakeru, "データにkakeruがある");
  assert.ok(info.includes("分類コード" + move.kakeru.code));
  assert.ok(info.includes("解説"));
  assert.ok($("#moveInfo details.kakeru-comment"), "解説は折りたたみ");
  assert.equal(all("#moveInfo .kakeru-combo").length, move.kakeru.combos.length);

  // バトル（副）
  assert.ok(info.includes("タイプドラゴン"));
  assert.ok(info.includes("分類特殊"));
  assert.ok(info.includes("威力" + move.power));
  assert.ok(info.includes("命中" + move.accuracy));
  assert.ok(info.includes("接触する"));
  assert.ok(info.includes("PP"));

  const expected = expectedLearnersById([move.id], "both");
  assert.deepEqual(namesOf("#moveResult"), expected);
  assert.match(txt("#moveCount"), new RegExp(`覚えるポケモン ${expected.length}体`));
});

test("技名検索: かけるのコンボ先一覧が出る", async () => {
  await type("#moveInput", "はたく");
  const k = moveByName.get("はたく").kakeru;
  assert.ok(k.combos.length > 0);
  const items = all("#moveInfo .kakeru-combo");
  assert.equal(items.length, k.combos.length);
  assert.ok(items[0].textContent.includes(k.combos[0].code) && items[0].textContent.includes(k.combos[0].move));
});

test("技名検索: 技名を変えた技でも『原作名』の注記は出さない", async () => {
  await type("#moveInput", "エナジーボール");
  const info = flat("#moveInfo");
  assert.match(info, /^エナジーボール/);
  assert.ok(!info.includes("原作名"));
  assert.equal($("#moveInfo .vanilla-tag"), null);
});

test("技名検索: ローマ字・ひらがな入力でもカタカナ技に当たる", async () => {
  await type("#moveInput", "えなじーぼーる");
  assert.match(flat("#moveInfo"), /^エナジーボール/);
  await type("#moveInput", "gekirin");
  assert.match(flat("#moveInfo"), /^げきりん/);
});

test("技名検索: 部分一致は候補チップで切り替えられる", async () => {
  await type("#moveInput", "ぼーる");
  const chips = all("#moveCandidates .chip");
  assert.ok(chips.length > 1);
  const target = chips.find(c => c.textContent === "エナジーボール");
  assert.ok(target);
  click(target);
  assert.match(flat("#moveInfo"), /^エナジーボール/);
  assert.equal($("#moveCandidates .chip.active").textContent, "エナジーボール");
});

test("技名検索: コンボのボタンで別の技へ移動できる", async () => {
  await type("#moveInput", "はたく");
  const btn = all("#moveInfo .combo-link").find(b => b.textContent === "おうふくビンタ");
  assert.ok(btn, "はたくの繋がる技におうふくビンタ");
  click(btn);
  assert.match(flat("#moveInfo"), /^おうふくビンタ/);
  assert.equal($("#moveInput").value, "おうふくビンタ");
});

test("技名検索: 習得方法のタグが付く", async () => {
  await type("#moveInput", "げきりん");
  assert.ok(all("#moveResult .learn-tag").length > 0);
});

test("技名検索: 存在しない技名は候補なし、1文字では検索しない", async () => {
  await type("#moveInput", "そんなわざはない");
  assert.match(txt("#moveResult"), /候補なし/);
  assert.equal(txt("#moveInfo"), "");
  await type("#moveInput", "あ");
  assert.equal(txt("#moveResult"), "");
});

test("技名検索: 威力0の技は — と必中で表示し、変化として扱う", async () => {
  await type("#moveInput", "みがわり");
  const info = flat("#moveInfo");
  assert.ok(info.includes("威力—"));
  assert.ok(info.includes("分類変化"));
});

// ---- 版の違い（アスフィア） ------------------------------------------------
test("版切り替え: アスフィアのアルタイル/シリウス限定技が版ごとに出る", async () => {
  const onlyA = asufia.altair_only_ids[0];
  const onlyS = asufia.sirius_only_ids[0];
  const nameA = moveJson.find(m => m.id === onlyA).name;

  selectVersion("both");
  await type("#moveInput", nameA);
  const item = all("#moveResult li").find(li => li.textContent.includes("アスフィア"));
  assert.ok(item, "両方表示ではアスフィアが出る");
  assert.ok(item.textContent.includes("アルタイルのみ"), "版名タグ");

  selectVersion("sirius");
  assert.ok(!namesOf("#moveResult").includes("アスフィア"), "シリウスでは出ない");
  assert.deepEqual(namesOf("#moveResult"), expectedLearnersById([onlyA], "sirius"));

  selectVersion("altair");
  assert.ok(namesOf("#moveResult").includes("アスフィア"));
  assert.ok(onlyS);
  selectVersion("both");
});

test("AND検索: 版をまたぐ組み合わせ（アルタイル限定技＋シリウス限定技）は成立しない", async () => {
  const mA = moveJson.find(m => m.id === asufia.altair_only_ids[0]);
  const mS = moveJson.find(m => m.id === asufia.sirius_only_ids[0]);
  selectVersion("both");
  await type("#andMove1", mA.name);
  await type("#andMove2", mS.name);

  const cards = all("#andInfo .move-card");
  assert.equal(cards.length, 2);
  assert.ok(cards[0].textContent.includes(mA.name));
  assert.ok(cards[1].textContent.includes(mS.name));

  const got = namesOf("#andResult");
  assert.ok(!got.includes("アスフィア"), "アスフィアは両版をまたぐので出ない");
  assert.deepEqual(got, expectedLearnersById([mA.id, mS.id], "both"));
});

test("AND検索: 同じ版に属する組み合わせ（アルタイル限定技どうし）は成立する", async () => {
  const [a1, a2] = asufia.altair_only_ids.slice(0, 2).map(id => moveJson.find(m => m.id === id));
  selectVersion("both");
  await type("#andMove1", a1.name);
  await type("#andMove2", a2.name);
  const got = namesOf("#andResult");
  assert.ok(got.includes("アスフィア"));
  assert.deepEqual(got, expectedLearnersById([a1.id, a2.id], "both"));

  selectVersion("sirius");
  assert.ok(!namesOf("#andResult").includes("アスフィア"));
  selectVersion("both");
});

test("AND検索: 通常の積集合", async () => {
  await type("#andMove1", "げきりん");
  await type("#andMove2", "つるぎのまい");
  const ids = [moveByName.get("げきりん").id, moveByName.get("つるぎのまい").id];
  assert.deepEqual(namesOf("#andResult"), expectedLearnersById(ids, "both"));
});

test("AND検索: 片方が存在しない技名なら候補なし", async () => {
  await type("#andMove1", "げきりん");
  await type("#andMove2", "そんなわざはない");
  assert.match(txt("#andResult"), /候補なし/);
});

// ---- ポケモン名 → 覚える技 ----------------------------------------------
test("ポケモン検索: アスフィアは両版のプロフィールを並べて出す", async () => {
  selectVersion("both");
  await type("#pokemonInput", "あすふぃあ");

  const cols = all("#pokemonProfile .profile-versions .profile-col");
  assert.equal(cols.length, 2, "版差分ブロック");
  assert.match(cols[0].textContent, /アルタイル/);
  assert.match(cols[1].textContent, /シリウス/);
  const flatCol = c => c.textContent.replace(/\s+/g, "");
  assert.ok(flatCol(cols[0]).includes(asufia.type.join("")));
  assert.ok(flatCol(cols[1]).includes(asufia.sirius.type.join("")));
  assert.ok(flatCol(cols[0]).includes(`HP${asufia.basestats[0]}`));
  assert.ok(flatCol(cols[0]).includes(`こうげき`) || flatCol(cols[0]).includes(`攻撃${asufia.basestats[1]}`));
  assert.ok(flatCol(cols[1]).includes(`攻撃${asufia.sirius.basestats[1]}`));
  assert.notEqual(asufia.basestats[1], asufia.sirius.basestats[1]);
  assert.match(txt("#pokemonProfile"), /特性: ふしぎなうろこ/);
  assert.match(txt("#pokemonProfile"), /体重: 160kg/);
});

test("ポケモン検索: 版差分のないポケモンは単一プロフィール", async () => {
  const other = pokemonJson.find(p => !p.version_differs);
  await type("#pokemonInput", other.name);
  assert.equal(all("#pokemonProfile .profile-versions").length, 0);
  assert.match(txt("#pokemonProfile"), /種族値: HP/);
});

test("ポケモン検索: 技行にコンテストタイプ・◎・●・分類・威力・命中が出る", async () => {
  await type("#pokemonInput", "あすふぃあ");
  const rows = all("#pokemonResult li");
  assert.equal(rows.length, asufia.move_ids.length);
  const first = rows[0];
  const move = moveJson.find(m => m.id === asufia.move_ids[0]);
  assert.ok(first.querySelector(".contest-badge").textContent === move.contest.type);
  assert.equal(first.querySelector(".hearts-appeal").textContent, "◎".repeat(move.contest.appeal));
  assert.equal(first.querySelector(".hearts-jam").textContent, "●".repeat(move.contest.jam));
  assert.match(first.querySelector(".move-summary").textContent, /(物理|特殊|変化) \/ 威力\S+ \/ 命中\S+/);

  const detail = first.querySelector(".move-detail");
  assert.ok(!detail.classList.contains("show"));
  click(first.querySelector(".move-name"));
  assert.ok(detail.classList.contains("show"));
  assert.ok(detail.textContent.includes(move.description));
});

test("ポケモン検索: 版別表示で版限定技が増減し、両方では版名が付く", async () => {
  await type("#pokemonInput", "あすふぃあ");
  selectVersion("both");
  assert.equal(all("#pokemonResult li").length, asufia.move_ids.length);
  assert.equal(all("#pokemonResult .ver-badge").length, asufia.altair_only_ids.length + asufia.sirius_only_ids.length);

  selectVersion("altair");
  assert.equal(all("#pokemonResult li").length, asufia.move_ids.length - asufia.sirius_only_ids.length);
  assert.equal(all("#pokemonResult .ver-badge").length, 0);
  selectVersion("sirius");
  assert.equal(all("#pokemonResult li").length, asufia.move_ids.length - asufia.altair_only_ids.length);
  selectVersion("both");
});

test("ポケモン検索: コンテストタイプで絞り込める", async () => {
  await type("#pokemonInput", "あすふぃあ");
  selectVersion("both");
  const buttons = all("#contestFilter .cf-btn");
  assert.deepEqual(buttons.map(b => b.textContent), ["すべて", "かっこよさ", "うつくしさ", "かわいさ", "かしこさ", "たくましさ"]);

  const ids = asufia.move_ids.map(id => moveJson.find(m => m.id === id));
  const want = ids.filter(m => m.contest.type === "かっこよさ").length;
  assert.ok(want > 0 && want < ids.length);

  click(buttons.find(b => b.textContent === "かっこよさ"));
  let rows = all("#pokemonResult li");
  assert.equal(rows.length, want);
  assert.ok(rows.every(li => li.querySelector(".contest-badge").textContent === "かっこよさ"));
  assert.match(txt("#pokemonCount"), new RegExp(`覚える技 ${want} / ${ids.length}件`));

  // テキストフィルタとの併用
  await type("#moveFilter", "ドラゴン");
  rows = all("#pokemonResult li");
  assert.ok(rows.every(li => li.querySelector(".contest-badge").textContent === "かっこよさ"));
  assert.ok(rows.length <= want);
  await type("#moveFilter", "");

  // もう一度押すと解除
  click(all("#contestFilter .cf-btn").find(b => b.textContent === "かっこよさ"));
  assert.equal(all("#pokemonResult li").length, ids.length);
});

test("ポケモン検索: アピール順に並べ替えられる", async () => {
  await type("#pokemonInput", "あすふぃあ");
  const sort = $("#moveSort");
  sort.value = "appeal-desc";
  sort.dispatchEvent(new window.Event("change", { bubbles: true }));
  let ap = all("#pokemonResult li .hearts-appeal").map(e => e.textContent.length);
  assert.deepEqual(ap, [...ap].sort((a, b) => b - a));
  assert.ok(ap[0] > ap[ap.length - 1]);

  sort.value = "appeal-asc";
  sort.dispatchEvent(new window.Event("change", { bubbles: true }));
  ap = all("#pokemonResult li .hearts-appeal").map(e => e.textContent.length);
  assert.deepEqual(ap, [...ap].sort((a, b) => a - b));
  sort.value = "default";
  sort.dispatchEvent(new window.Event("change", { bubbles: true }));
});

test("ポケモン検索: ポケモン名はリンクなしのプレーンテキスト（links JSONが無くても動く）", async () => {
  await type("#pokemonInput", "あすふぃあ");
  assert.equal(all("#pokemonProfile a").length, 0);
  assert.ok($("#pokemonProfile .profile-name"));
});

// ---- コンテストタイプで技を探す --------------------------------------------
test("コンテストタイプ検索: 選んだタイプの技がアピール順に並ぶ", async () => {
  const buttons = all("#contestTypeButtons .cf-btn");
  assert.equal(buttons.length, 5);
  click(buttons.find(b => b.textContent === "うつくしさ"));

  const want = moveJson.filter(m => m.contest.type === "うつくしさ");
  const rows = all("#contestTypeResult li");
  assert.equal(rows.length, want.length);
  assert.match(txt("#contestTypeCount"), new RegExp(`うつくしさの技 ${want.length}件`));
  const ap = rows.map(li => li.querySelector(".hearts-appeal").textContent.length);
  assert.deepEqual(ap, [...ap].sort((a, b) => b - a));

  click(rows[0].querySelector(".move-name"));
  assert.ok(rows[0].querySelector(".move-detail").classList.contains("show"));
  assert.ok(rows[0].querySelector(".move-detail").textContent.includes("コンテスト"));
});

// ---- コンボ技一覧 -----------------------------------------------------------
const comboStarters = moveJson.filter(m => m.contest.combo_to_ids.length > 0);

test("コンボ技一覧: 先に出す技ごとに1行、次に出す技が並ぶ", () => {
  const rows = all("#comboResult li");
  assert.equal(rows.length, comboStarters.length);
  const pairs = comboStarters.reduce((n, m) => n + m.contest.combo_to_ids.length, 0);
  assert.match(txt("#comboCount"), new RegExp(`先に出す技 ${comboStarters.length}件、コンボ ${pairs}組`));

  const row = rows.find(li => li.querySelector(".combo-head .move-label").textContent === "はたく");
  assert.ok(row);
  const next = [...row.querySelectorAll(".combo-partners .move-label")].map(e => e.textContent);
  assert.deepEqual(next, ["おうふくビンタ", "たたきつける", "だましうち"]);
  assert.ok(row.querySelector(".combo-head .contest-badge"));
  assert.ok(row.querySelector(".combo-head .hearts-appeal").textContent.length > 0);
  assert.ok(row.textContent.includes("→"));
});

test("コンボ技一覧: 原作名の注記も、かけるのページだけのコンボ一覧も出さない", () => {
  assert.equal(all("#comboResult .vanilla-note").length, 0);
  assert.equal($("#comboExtraBlock"), null);
  assert.ok(!txt("body").includes("かけるのページ（ROMのデータにないコンボ）"));
});

test("コンボ技一覧: 技名をクリックすると技情報カードが開く", async () => {
  const row = all("#comboResult li").find(
    li => li.querySelector(".combo-head .move-label").textContent === "はたく");
  click(row.querySelector(".combo-partners .combo-move"));
  assert.equal($("#moveInput").value, "おうふくビンタ");
  assert.ok(txt("#moveInfo").includes("おうふくビンタ"));
});

test("コンボ技一覧: 部門で絞り込める", () => {
  const btn = all("#comboTypeButtons .cf-btn").find(b => b.textContent === "かしこさ");
  click(btn);
  const want = comboStarters.filter(m => m.contest.type === "かしこさ");
  const rows = all("#comboResult li");
  assert.equal(rows.length, want.length);
  assert.ok(rows.length > 0 && rows.length < comboStarters.length);
  rows.forEach(li => assert.equal(li.querySelector(".combo-head .contest-badge").textContent, "かしこさ"));
  click(all("#comboTypeButtons .cf-btn").find(b => b.textContent === "すべて"));
  assert.equal(all("#comboResult li").length, comboStarters.length);
});

test("コンボ技一覧: 技名で絞り込める（ローマ字・カタカナ）", async () => {
  await type("#comboFilter", "hataku");
  let rows = all("#comboResult li");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector(".combo-head .move-label").textContent, "はたく");
  await type("#comboFilter", "ハタク");
  assert.equal(all("#comboResult li").length, 1);
  await type("#comboFilter", "");
  assert.equal(all("#comboResult li").length, comboStarters.length);
});

test("コンボ技一覧: 逆引きで、その技の前に出す技が出る", async () => {
  const cb = $("#comboReverse");
  cb.checked = true;
  cb.dispatchEvent(new window.Event("change", { bubbles: true }));
  const byId = new Map(moveJson.map(m => [m.id, m]));
  const target = byId.get(3); // おうふくビンタ
  const prevNames = target.contest.combo_from_ids.map(id => byId.get(id).name);
  assert.ok(prevNames.length > 0);

  await type("#comboFilter", target.romaji);
  const row = all("#comboResult li").find(
    li => li.querySelector(".combo-head .move-label").textContent === target.name);
  assert.ok(row);
  const prev = [...row.querySelectorAll(".combo-partners .move-label")].map(e => e.textContent);
  assert.deepEqual([...prev].sort(), [...prevNames].sort());
  // 逆引きでは「前の技 → 見出しの技」の順
  assert.ok(row.firstElementChild.classList.contains("combo-partners"));
  assert.match(txt("#comboCount"), /次に出す技/);

  await type("#comboFilter", "");
  const heads = new Set(comboStarters.flatMap(m => m.contest.combo_to_ids));
  assert.equal(all("#comboResult li").length, heads.size);
});

test("コンボ技一覧: 逆引きを戻す", () => {
  const cb = $("#comboReverse");
  cb.checked = false;
  cb.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.match(txt("#comboCount"), /先に出す技/);
});

test("コンボ技一覧: バージョンを切り替えても一覧は変わらない", () => {
  selectVersion("sirius");
  assert.equal(all("#comboResult li").length, comboStarters.length);
  selectVersion("both");
});
