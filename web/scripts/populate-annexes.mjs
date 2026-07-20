// 조문이 가리키는 별표 본문을 수집한다.
//
// 왜 필요한가: 조문 884건 중 14건이 "별표 N에 따른다"로 끝나는데, 그 별표 본문을
// 우리가 갖고 있지 않다. 그런데 별표에 들어 있는 것이 하필 실무에서 제일 중요한
// 수치다 — 부정당업자 제재기간(시행규칙 별표2), 적격심사 배점(별표3의2·4·9) 같은
// 것들. 본문 없이 조문만 주면 모델이 조문은 정확히 인용하면서 별표 내용을 지어낼
// 수 있고, 이건 인용구 대조로 못 잡는 유형이다.
//
// 수집은 저작 시점에 한 번 한다. 운영(Cloudflare Worker)에서는 법령 API를 부르지
// 않고 여기서 만든 정적 자산만 읽는다.
//
// 필요: LAW_OC (국가법령정보센터 오픈API 신청 시 받는 이메일 ID)
//   web/.dev.vars 에 LAW_OC=... 로 넣고 실행한다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTICLES_DIR = path.join(WEB_DIR, "public", "articles");
const OUT_FILE = path.join(WEB_DIR, "data", "annexes.json");

const OC = process.env.LAW_OC;
if (!OC) {
  console.error(
    "LAW_OC 가 없습니다. web/.dev.vars 에 LAW_OC=... 를 넣고 다시 실행하세요.",
  );
  process.exit(1);
}

const BASE = "https://www.law.go.kr/DRF";

/** 법령명 → { id, mst, kind }. 행정규칙이면 admrul로 폴백한다. */
async function findLaw(name) {
  for (const target of ["law", "admrul"]) {
    const url = `${BASE}/lawSearch.do?OC=${OC}&target=${target}&type=JSON&display=20&query=${encodeURIComponent(name)}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      continue; // 오픈API는 오류를 HTML로 주기도 한다
    }
    const list =
      data?.LawSearch?.law ?? data?.AdmRulSearch?.admrul ?? data?.LawSearch?.admrul;
    const rows = Array.isArray(list) ? list : list ? [list] : [];
    // 정확히 같은 이름을 우선하고, 없으면 첫 결과.
    const exact =
      rows.find((r) => (r.법령명한글 ?? r.행정규칙명)?.trim() === name) ?? rows[0];
    if (exact) {
      return {
        target,
        id: exact.법령ID ?? exact.행정규칙ID,
        mst: exact.법령일련번호 ?? exact.행정규칙일련번호,
        name: (exact.법령명한글 ?? exact.행정규칙명)?.trim(),
      };
    }
  }
  return null;
}

/**
 * 별표 목록 조회.
 *
 * 함정 둘:
 *  - 응답 루트가 `licBylSearch`다(대문자 B 아님). 법령·행정규칙 검색과 표기가 달라
 *    LicBylSearch로 읽으면 조용히 0건이 된다.
 *  - knd=1 을 줘야 별표만 온다. 없으면 서식(별지 서식)이 섞여 별표가 안 보인다.
 */
async function listAnnexes(lawName) {
  // 법령 별표는 licbyl, 행정규칙(고시·훈령·예규) 별표는 admbyl 로 나뉜다.
  // 우리 근거의 상당수가 계약예규·조달청 기준이라 admbyl 쪽이 오히려 많다.
  const targets = [
    { target: "licbyl", root: "licBylSearch", key: "licbyl" },
    { target: "admbyl", root: "admRulBylSearch", key: "admbyl" },
  ];
  for (const t of targets) {
    const url = `${BASE}/lawSearch.do?OC=${OC}&target=${t.target}&type=JSON&display=100&search=2&knd=1&query=${encodeURIComponent(lawName)}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    let rows = [];
    try {
      const data = JSON.parse(await res.text());
      const list = data?.[t.root]?.[t.key] ?? Object.values(data?.[t.root] ?? {}).find(Array.isArray);
      rows = Array.isArray(list) ? list : list ? [list] : [];
    } catch {
      continue;
    }
    // 검색어가 부분일치라 다른 법령이 섞여 온다. 이름이 정확히 같은 것만.
    const mine = rows.filter((r) => {
      const owner = String(r.관련법령명 ?? r.관련행정규칙명 ?? "").trim();
      return owner === lawName || owner.replace(/\s/g, "") === lawName.replace(/\s/g, "");
    });
    if (mine.length > 0) return mine;
  }
  return [];
}

/**
 * 응답에 실려 오는 링크에는 OC(인증키)가 쿼리로 박혀 있다. 그대로 저장하면
 * 키가 저장소에 커밋된다. 반드시 지우고 쓴다.
 */
function scrubKey(link) {
  if (!link) return undefined;
  const path = String(link).replace(/([?&])OC=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  return `https://www.law.go.kr${path}`;
}

/** "000200" → "별표2", "000302" → "별표3의2" */
function decodeAnnexNo(raw) {
  const n = String(raw ?? "").padStart(6, "0");
  const main = parseInt(n.slice(0, 4), 10);
  const sub = parseInt(n.slice(4), 10);
  if (!main) return "";
  return `별표${main}${sub ? `의${sub}` : ""}`;
}

// ── 필요한 별표 목록을 조문에서 뽑는다 ──────────────────────────────────────

const needed = new Map(); // 법령명 → Set<별표번호>
for (const file of fs.readdirSync(ARTICLES_DIR)) {
  const { articles } = JSON.parse(
    fs.readFileSync(path.join(ARTICLES_DIR, file), "utf8"),
  );
  for (const a of articles) {
    const hits = a.text.match(/별표\s*\d+(?:의\d+)?/g);
    if (!hits) continue;
    // "(계약예규) 공사계약일반조건" 같은 접두어는 검색에 방해가 된다.
    const law = a.law.replace(/^\([^)]*\)\s*/, "");
    if (!needed.has(law)) needed.set(law, new Set());
    for (const h of hits) needed.get(law).add(h.replace(/\s+/g, ""));
  }
}

console.log(
  `조문에서 찾은 별표: ${[...needed.values()].reduce((n, s) => n + s.size, 0)}건 / 법령 ${needed.size}개`,
);

const out = {};
let ok = 0;
let miss = 0;

for (const [lawName, wanted] of needed) {
  const annexes = await listAnnexes(lawName);
  if (annexes.length === 0) {
    console.warn(`  ✗ 별표 목록이 비었음: ${lawName}`);
    miss += wanted.size;
    continue;
  }
  for (const want of wanted) {
    const found = annexes.find((a) => decodeAnnexNo(a.별표번호) === want);
    if (!found) {
      // 조문이 가리키는 별표가 그 법령에 없는 경우가 실제로 있다(다른 법령의
      // 별표를 인용하거나, 조문 표기가 옛 번호인 경우). 지어내지 말고 남긴다.
      console.warn(`  ✗ ${lawName} ${want} — 그 법령에 없음`);
      miss += 1;
      continue;
    }
    out[`${lawName}::${want}`] = {
      law: lawName,
      annex: want,
      title: String(found.별표명 ?? "").trim(),
      // 본문은 HWP/PDF 파일이라 링크로 넘긴다. 표 형식이라 텍스트로 옮기면
      // 행·열 관계가 깨져서, 어설픈 텍스트보다 원본 링크가 정확하다.
      url: scrubKey(found.별표법령상세링크 ?? found.별표행정규칙상세링크),
      fileUrl: scrubKey(found.별표서식파일링크),
    };
    ok += 1;
  }
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 1)}\n`);
console.log(`별표 수집: 성공 ${ok}건 / 실패 ${miss}건 → data/annexes.json`);
