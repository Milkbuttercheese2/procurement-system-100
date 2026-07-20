// 제도별 조문 원문을 정적 자산으로 떼어낸다.
//
// API 라우트가 조문 원문을 import 하면 Worker 스크립트 상한(무료 3 MiB)을 넘는다
// (전체 조문 884건 ≈ 2.9MB). 그래서 번들에 넣지 않고 public/ 아래 정적 파일로
// 두고, 답변에 필요한 1~3개 제도의 것만 런타임에 불러온다.
//
// 함께 담는 것:
// - officialUrl: 인용마다 국가법령정보센터 링크를 걸어 사용자가 직접 대조할 수
//   있게 한다. 모델을 믿는 대신 확인 경로를 주는 쪽이 안전하다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

  // 법령명 → 공식 링크. 키가 "법령명::제N조" 꼴이라 앞부분으로 찾는다.
  const urlByLaw = new Map();
  for (const s of d.verification?.sources ?? []) {
    if (s.officialUrl) {
      if (s.law) urlByLaw.set(s.law, s.officialUrl);
      if (s.officialName) urlByLaw.set(s.officialName, s.officialUrl);
    }
  }

  const out = [];
  for (const [key, val] of Object.entries(texts)) {
    const law = key.split("::")[0];
    // "(계약예규) 공사계약일반조건"처럼 접두어가 붙은 키는 벗겨서도 찾아본다.
    const bare = law.replace(/^\([^)]*\)\s*/, "");
    const url = urlByLaw.get(law) ?? urlByLaw.get(bare);
    if (url) linked += 1;
    out.push({
      key,
      law,
      article: val?.article ?? key.split("::")[1] ?? "",
      title: val?.title ?? "",
      text: String(val?.text ?? (typeof val === "string" ? val : "")),
      url,
    });
    articles += 1;
  }

  fs.writeFileSync(path.join(OUT_DIR, `${d.slug}.json`), JSON.stringify(out));
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
