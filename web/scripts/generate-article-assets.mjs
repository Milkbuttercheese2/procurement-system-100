// 제도별 조문 원문을 정적 자산으로 떼어낸다.
//
// API 라우트가 조문 원문을 import 하면 Worker 스크립트 상한(무료 3 MiB)을 넘는다
// (전체 조문 884건 ≈ 2.9MB). 그래서 번들에 넣지 않고 public/ 아래 정적 파일로
// 두고, 답변에 필요한 1~3개 제도의 것만 런타임에 불러온다.
//
// 함께 담는 것:
// - officialUrl: 인용마다 국가법령정보센터 링크를 걸어 사용자가 직접 대조할 수
//   있게 한다. 모델을 믿는 대신 확인 경로를 주는 쪽이 안전하다.
// - kind / effectiveOn / promulgatedOn: 법령정보 MCP가 모든 응답에 시행일과
//   조회기준일을 달고 "연혁일 수 있으니 현행을 재확인하라"고 경고하는 것과 같은
//   취지다. 우리 데이터는 특정 시점의 스냅샷이므로, 그 시점을 밝히지 않으면
//   개정된 뒤에도 현행인 것처럼 읽힌다. 조문 자체보다 이게 더 위험하다.
//   또 "제26조"만으로는 법률인지 시행령인지 알 수 없어 kind를 함께 싣는다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 조문 본문을 항(①②③…) 단위로 쪼갠다.
 *
 * 항 표시가 없는 조(9%)는 통째로 한 덩어리로 둔다. 호(1. 2. 3.)까지 쪼개지 않는
 * 이유는, 호는 대개 앞 항의 문장을 이어받아 단독으로는 뜻이 통하지 않기 때문이다.
 */
function splitClauses(text) {
  const marks = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮";
  if (!new RegExp(`[${marks}]`).test(text)) {
    return [{ label: "", text: text.trim() }];
  }
  const out = [];
  const re = new RegExp(`([${marks}])`, "g");
  const parts = text.split(re);
  // split 결과: [머리말, 표시, 본문, 표시, 본문, ...]
  if (parts[0]?.trim()) out.push({ label: "", text: parts[0].trim() });
  for (let i = 1; i < parts.length; i += 2) {
    const idx = marks.indexOf(parts[i]) + 1;
    const body = (parts[i + 1] ?? "").trim();
    if (body) out.push({ label: `제${idx}항`, text: body });
  }
  return out;
}

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(WEB_DIR, "data", "institutions");
const OUT_DIR = path.join(WEB_DIR, "public", "articles");

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

let files = 0;
let articles = 0;
let linked = 0;

for (const file of fs.readdirSync(SRC_DIR).filter((f) => f.endsWith(".json"))) {
  const d = JSON.parse(fs.readFileSync(path.join(SRC_DIR, file), "utf8"));
  const texts = d.verification?.articleTexts ?? {};
  if (Object.keys(texts).length === 0) continue;

  // 법령명 → 출처 정보. 키가 "법령명::제N조" 꼴이라 앞부분으로 찾는다.
  const sourceByLaw = new Map();
  for (const s of d.verification?.sources ?? []) {
    if (s.law) sourceByLaw.set(s.law, s);
    if (s.officialName) sourceByLaw.set(s.officialName, s);
  }

  const out = [];
  for (const [key, val] of Object.entries(texts)) {
    const law = key.split("::")[0];
    // "(계약예규) 공사계약일반조건"처럼 접두어가 붙은 키는 벗겨서도 찾아본다.
    const bare = law.replace(/^\([^)]*\)\s*/, "");
    const src = sourceByLaw.get(law) ?? sourceByLaw.get(bare);
    if (src?.officialUrl) linked += 1;
    // 규정 전체가 아니라 해당 조로 바로 보낸다. 사이트의 [조문 확인] 버튼과 같은
    // 방식이다(ProcessVerification.tsx) — officialUrl 뒤에 /제N조 를 붙이면
    // 법제처가 그 조로 스크롤해 준다. 항까지는 딥링크가 안 되므로 조까지만.
    const articleNo = val?.article ?? key.split("::")[1] ?? "";
    const jo = articleNo.match(/제\s*\d+\s*조(?:의\s*\d+)?/)?.[0]?.replace(/\s+/g, "");
    const deepable =
      src?.officialUrl && jo && /law\.go\.kr\/(법령|행정규칙)\//.test(src.officialUrl);
    const url = deepable
      ? `${src.officialUrl.replace(/\/+$/, "")}/${jo}`
      : src?.officialUrl;
    out.push({
      key,
      law,
      // 항 단위로 쪼개 둔다. 검색을 조 전체로 하면 긴 조가 아무 질문에나 걸린다
      // (실측: 1,881자 제25조가 386자 제75조와 같은 점수를 받았다. 답은 제75조에
      // 있었다). 항으로 나누면 "지체상금률"을 묻는 질문이 요율이 적힌 항에 걸린다.
      clauses: splitClauses(String(val?.text ?? "")),
      article: articleNo,
      title: val?.title ?? "",
      text: String(val?.text ?? (typeof val === "string" ? val : "")),
      url,
      kind: src?.kind,
      effectiveOn: src?.effectiveOn,
      promulgatedOn: src?.promulgatedOn,
    });
    articles += 1;
  }

  fs.writeFileSync(
    path.join(OUT_DIR, `${d.slug}.json`),
    JSON.stringify({ asOfDate: d.asOfDate ?? d.verification?.verifiedAt, articles: out }),
  );
  files += 1;
}

const bytes = fs
  .readdirSync(OUT_DIR)
  .reduce((n, f) => n + fs.statSync(path.join(OUT_DIR, f)).size, 0);

console.log(
  `조문 자산 생성: ${files}개 제도 / 조문 ${articles}건 / 공식링크 ${linked}건 / ` +
    `${(bytes / 1024 / 1024).toFixed(2)}MB → public/articles/`,
);
if (linked < articles) {
  console.warn(`주의: 공식 링크를 못 붙인 조문 ${articles - linked}건 (법령명 불일치)`);
}
