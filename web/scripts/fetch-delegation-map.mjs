// 법제처 3단비교(thdCmp, knd=2) API에서 법률→시행령/시행규칙 '위임조문' 공식
// 메타데이터를 받아 sources/law-cache/delegation-map.json 에 저장한다.
// 그래프 인덱스(generate-legal-graph.mjs)가 이 캐시를 오프라인으로 소비한다 —
// 층 분리: API 호출(층 1)은 여기까지, 그래프 빌드(층 2)는 결정론 유지.
// 사용: LAW_OC=... node scripts/fetch-delegation-map.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(WEB, "data", "institutions");
const OUT = path.join(WEB, "..", "sources", "law-cache", "delegation-map.json");
const OC = process.env.LAW_OC;
if (!OC) throw new Error("LAW_OC 환경변수가 필요합니다.");

// 3단비교의 기준법령은 '법률'뿐이다. 하위법령·행정규칙은 제외.
function isStatute(name) {
  return !/시행령|시행규칙|특례규정|예규|고시|훈령|기준|요령|조건|규정/.test(name ?? "");
}

// 조번호 "0005" + 조가지번호 "02" → "제5조의2"
function articleKey(joNo, branch) {
  const n = Number(joNo);
  const b = Number(branch ?? "0");
  if (!n) return null;
  return `제${n}조${b ? `의${b}` : ""}`;
}

// 인용/수집 대상 법률 목록: institution 출처에서 (officialName, mst) 수집
const statutes = new Map();
for (const f of fs.readdirSync(DATA_DIR).filter((x) => x.endsWith(".json"))) {
  const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
  for (const s of d.verification?.sources ?? []) {
    const name = s.officialName ?? s.law;
    if (s.mst && isStatute(name) && !statutes.has(name)) statutes.set(name, s.mst);
  }
}

const map = {}; // "법률명::제N조" -> [{law, article, tier}]
const report = [];
for (const [name, mst] of [...statutes.entries()].sort()) {
  const url = `https://www.law.go.kr/DRF/lawService.do?target=thdCmp&OC=${OC}&type=JSON&knd=2&MST=${mst}`;
  let json;
  try {
    const r = await fetch(url, { headers: { Referer: "https://www.law.go.kr" } });
    json = await r.json();
  } catch (e) {
    report.push(`${name}: 요청 실패 (${e.message})`);
    continue;
  }
  const arts = json?.LspttnThdCmpLawXService?.["위임조문삼단비교"]?.["법률조문"];
  if (!Array.isArray(arts)) {
    report.push(`${name}: 3단비교 데이터 없음`);
    continue;
  }
  let pairs = 0;
  for (const a of arts) {
    const srcArticle = articleKey(a["조번호"], a["조가지번호"]);
    if (!srcArticle) continue;
    const targets = [];
    for (const [field, tier] of [["시행령조문", "시행령"], ["시행규칙조문", "시행규칙"]]) {
      const raw = a[field];
      if (!raw) continue;
      for (const t of Array.isArray(raw) ? raw : [raw]) {
        const tgtArticle = articleKey(t["조번호"], t["조가지번호"]);
        const tgtLaw = (t["법령명"] ?? "").trim();
        if (tgtArticle && tgtLaw) targets.push({ law: tgtLaw, article: tgtArticle, tier });
      }
    }
    if (targets.length) {
      targets.sort((x, y) => (x.law + x.article).localeCompare(y.law + y.article, "ko"));
      map[`${name}::${srcArticle}`] = targets;
      pairs += targets.length;
    }
  }
  report.push(`${name}: 위임 ${pairs}건`);
}

const out = {
  note: "법제처 3단비교(thdCmp, knd=2) 공식 위임조문 메타데이터 캐시. fetch-delegation-map.mjs가 생성하고 generate-legal-graph.mjs가 소비한다.",
  fetchedAt: new Date().toISOString().slice(0, 10),
  delegations: Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b, "ko"))),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(report.join("\n"));
console.log(`\n총 ${Object.keys(map).length}개 법률 조문의 위임 관계 저장 → ${path.relative(process.cwd(), OUT)}`);
