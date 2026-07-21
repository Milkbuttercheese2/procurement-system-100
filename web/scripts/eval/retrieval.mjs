// 검색 평가. docs/retrieval-evaluation-policy.md 참고.
//
// LLM을 부르지 않는다 — 검색 단계만 재므로 공짜이고 빠르며, 모델을 바꿔도 결과가
// 흔들리지 않는다. 재는 것은 둘:
//   제도 적중률   질문에 맞는 제도를 골랐나(프리필터 상위 N 안에 들었나)
//   근거 포함률   답에 필요한 문구가 실제로 모델에 넘어갈 텍스트에 들어왔나
import fs from "node:fs";

const idx = JSON.parse(fs.readFileSync("data/routing-index.json", "utf8"));
const QS = JSON.parse(fs.readFileSync("scripts/eval/questions.json", "utf8"));

const PREFILTER_KEEP = 15;
const MAX_ARTICLES = 30;

const bg = (s) => {
  const o = new Set();
  const t = s.replace(/\s/g, "");
  for (let i = 0; i < t.length - 1; i += 1) o.add(t.slice(i, i + 2));
  return o;
};
const BLOB = new Map(
  idx.map((e) => [e.slug, bg(`${e.name}${e.oneLiner}${e.applicability}${e.category}`)]),
);
const flat = (s) => s.replace(/\s+/g, "");

function prefilter(q) {
  const Q = bg(q);
  return idx
    .map((e) => {
      const b = BLOB.get(e.slug);
      let n = 0;
      for (const g of Q) if (b.has(g)) n += 1;
      return { e, s: n / (Q.size || 1) };
    })
    .sort((a, b) => b.s - a.s);
}

/** 운영과 같은 방식으로 항 단위 검색 후, 모델에 넘어갈 텍스트를 만든다. */
function retrieve(query, slugs) {
  const Q = bg(query);
  const units = slugs.flatMap((slug) => {
    const file = `public/articles/${slug}.json`;
    // 정답 목록에 있어도 조문 자산이 없는 제도가 있다(조문 대조 미완료).
    if (!fs.existsSync(file)) return [];
    const { articles } = JSON.parse(fs.readFileSync(file, "utf8"));
    return articles.flatMap((a) =>
      (a.clauses?.length ? a.clauses : [{ label: "", text: a.text }]).map((c) => {
        const g = bg(`${a.title}${c.text}`);
        let n = 0;
        for (const x of Q) if (g.has(x)) n += 1;
        return { a, c, score: (2 * n) / (Q.size + g.size || 1) };
      }),
    );
  });
  return units
    .sort((x, y) => y.score - x.score)
    .slice(0, MAX_ARTICLES)
    .map((u) => `${u.a.title}\n${u.c.text}`)
    .join("\n\n");
}

let hit = 0;
let evTotal = 0;
let evFound = 0;
let scored = 0;
const misses = [];

for (const t of QS) {
  const ranked = prefilter(t.q);
  const top = ranked.slice(0, PREFILTER_KEEP).map((x) => x.e.slug);
  const inTop = t.ok.some((s) => top.includes(s));
  if (inTop) hit += 1;

  if (!t.evidence?.length) continue;
  scored += 1;
  // 실제로 고를 제도는 LLM이 정하지만, 검색 품질만 보려면 정답 제도로 고정한다.
  const corpus = flat(retrieve(t.q, t.ok));
  const found = t.evidence.filter((e) => corpus.includes(flat(e)));
  evTotal += t.evidence.length;
  evFound += found.length;
  if (found.length < t.evidence.length) {
    misses.push({
      q: t.q,
      missing: t.evidence.filter((e) => !corpus.includes(flat(e))),
      got: `${found.length}/${t.evidence.length}`,
    });
  }
}

console.log(`제도 적중률 (상위 ${PREFILTER_KEEP})  ${hit}/${QS.length}  (${((hit / QS.length) * 100).toFixed(0)}%)`);
console.log(`근거 포함률 (상위 ${MAX_ARTICLES}항)  ${evFound}/${evTotal}  (${evTotal ? ((evFound / evTotal) * 100).toFixed(1) : 0}%)   — 문항 ${scored}개`);
if (misses.length) {
  console.log("\n놓친 근거:");
  for (const m of misses) console.log(`  [${m.got}] ${m.q}\n         ${m.missing.join(" / ")}`);
}
