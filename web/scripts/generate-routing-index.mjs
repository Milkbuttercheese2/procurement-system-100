// 제도 찾기 라우팅용 슬림 인덱스 생성.
//
// API 라우트가 lib/data(제도 JSON 전체 4.4MB, 조문 원문 884건 포함)를 import 하면
// 서버 번들이 그만큼 커진다. Cloudflare Worker 스크립트 상한이 무료 3 MiB라 그대로는
// 배포가 안 된다. 라우팅에 실제로 필요한 건 이름·분류·요약·적용대상뿐이므로
// (66개 합쳐 약 17KB) 그것만 뽑아 별도 파일로 둔다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(WEB_DIR, "data", "institutions");
const OUT_FILE = path.join(WEB_DIR, "data", "routing-index.json");

const docs = fs
  .readdirSync(SRC_DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(fs.readFileSync(path.join(SRC_DIR, file), "utf8")));

// related는 제도 '이름'으로 적혀 있다. 모델에게는 slug로 줘야 후보로 그대로 쓸 수
// 있으므로 여기서 변환한다. 이름이 바뀌어 매칭이 깨지면 조용히 사라지는 대신
// 경고를 띄운다 — 연결이 빠진 채 배포되면 라우팅 품질이 소리 없이 나빠진다.
// 표기가 조금씩 달라 정확히 안 맞는 경우가 많다("입찰공고" vs "입찰공고(공고문
// 작성)"). 괄호·구두점·공백을 털어낸 형태로도 찾고, 그래도 안 되면 한쪽이 다른
// 쪽을 포함하는지 본다. 애매하면(후보 여럿) 연결하지 않는다 — 틀린 연결은 빠진
// 연결보다 나쁘다.
const slugByName = new Map(docs.map((d) => [d.name, d.slug]));
const norm = (s) => s.replace(/\([^)]*\)/g, "").replace(/[\s·,()]/g, "");
const slugByNorm = new Map();
for (const d of docs) {
  const key = norm(d.name);
  // 정규화 후 충돌하면 그 키는 못 쓴다.
  slugByNorm.set(key, slugByNorm.has(key) ? null : d.slug);
}

function resolve(name) {
  const exact = slugByName.get(name);
  if (exact) return exact;
  const key = norm(name);
  const byNorm = slugByNorm.get(key);
  if (byNorm) return byNorm;
  // 포함 관계로도 안 잡히는 표기 차이가 많다("여성기업제품 우선구매" vs
  // "여성기업제품 구매촉진" — 어느 쪽도 상대를 포함하지 않는다). 글자 2-gram
  // 겹침(Dice)으로 가장 가까운 것을 찾되, 점수가 낮거나 1·2위가 붙어 있으면
  // 포기한다. 엉뚱한 제도로 연결하느니 빠지는 편이 낫다.
  const scored = docs
    .map((d) => ({ slug: d.slug, score: dice(key, norm(d.name)) }))
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (best && best.score >= 0.6 && (!next || best.score - next.score >= 0.15)) {
    return best.slug;
  }
  return undefined;
}

function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  return out;
}

function dice(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared += 1;
  return (2 * shared) / (A.size + B.size);
}

const unresolved = [];

const entries = docs
  .map((d) => {
    const applicability = d.canvas?.applicability;
    const applicabilityText = Array.isArray(applicability)
      ? applicability.join(" ")
      : typeof applicability === "string"
        ? applicability
        : "";
    const related = (Array.isArray(d.related) ? d.related : [])
      .map((name) => {
        const slug = resolve(name);
        if (!slug) unresolved.push(`${d.slug} → ${name}`);
        return slug;
      })
      .filter((slug) => slug && slug !== d.slug);
    return {
      slug: d.slug,
      name: d.name,
      category: d.category ?? "",
      oneLiner: d.oneLiner ?? "",
      applicability: applicabilityText,
      related,
    };
  })
  .sort((a, b) => a.slug.localeCompare(b.slug));

fs.writeFileSync(OUT_FILE, JSON.stringify(entries) + "\n");

const bytes = fs.statSync(OUT_FILE).size;
const links = entries.reduce((n, e) => n + e.related.length, 0);
console.log(
  `라우팅 인덱스 생성: ${entries.length}개 제도, 연결 ${links}건, ${(bytes / 1024).toFixed(1)}KB → data/routing-index.json`,
);
if (unresolved.length > 0) {
  console.warn(
    `주의: related 이름 ${unresolved.length}건을 slug로 못 바꿨습니다 —\n  ` +
      unresolved.join("\n  "),
  );
}
