// 인용 조문의 현행 원문을 국가법령정보센터 Open API로 받아 institution JSON의
// verification.articleTexts 에 저장한다. 팝업(조문확인)에서 조문 원문을 보여주기 위한 데이터.
// 사용: LAW_OC=... KOREAN_LAW_CLI=... node scripts/populate-article-texts.mjs [--only slug]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(REPO_DIR, "data", "institutions");
const CLI = process.env.KOREAN_LAW_CLI;
const OC = process.env.LAW_OC;
if (!CLI || !OC) throw new Error("KOREAN_LAW_CLI, LAW_OC 환경변수가 필요합니다.");

const onlyArg = process.argv.indexOf("--only");
const ONLY = onlyArg > -1 ? process.argv[onlyArg + 1] : null;

const compact = (s) => (s ?? "").replace(/\s+/g, "").replace(/[·ㆍ]/g, "");
// "제7조제1항", "제12조의2제3항" → base article "제7조", "제12조의2"
function baseArticle(article) {
  const m = String(article).match(/제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/);
  if (!m) return null;
  return `제${m[1]}조${m[2] ? `의${m[2]}` : ""}`;
}

// 인용에 지정된 항 번호("제3항") 추출. 없으면 null.
function hangNumber(article) {
  const m = String(article).match(/제\s*(\d+)\s*항/);
  return m ? Number(m[1]) : null;
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚";
// 조문 본문에서 n번째 항(원숫자 마커)만 추출. 마커가 없으면(단항 조문 등) 본문 전체를 반환.
function extractHang(body, n) {
  const marker = CIRCLED[n - 1];
  if (!marker) return body;
  const start = body.indexOf(marker);
  if (start === -1) return body; // 해당 항 마커 없음 → 조문 전체로 폴백
  const next = CIRCLED[n];
  let end = body.length;
  if (next) {
    const ni = body.indexOf(next, start + 1);
    if (ni !== -1) end = ni;
  }
  return body.slice(start, end).trim();
}

function stripToolNoise(s) {
  return (s || "")
    .split("\n")
    .filter(
      (line) =>
        !/^\(node:\d+\)/.test(line) &&
        !/UNDICI|EnvHttpProxyAgent/.test(line) &&
        !/--trace-warnings/.test(line),
    )
    .join("\n");
}

function runCli(args) {
  const res = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env },
    maxBuffer: 64 * 1024 * 1024,
  });
  // stdout만 사용한다. stderr(UNDICI 경고 등 내부 노이즈)는 조문 원문에 섞지 않는다.
  return stripToolNoise(res.stdout || "");
}

async function fetchAdminRuleFull(serial) {
  const url = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=admrul&ID=${serial}&type=JSON`;
  try {
    const r = await fetch(url);
    if (!r.ok) return "";
    const j = await r.json();
    // 응답 전체를 JSON.stringify 하면 조문 본문에 \" 같은 이스케이프 잔재가 남는다.
    // 조문내용은 줄 단위 문자열 배열이므로 그대로 이어붙인다.
    const articles = j?.AdmRulService?.["조문내용"];
    const text = Array.isArray(articles) ? articles.join("\n") : JSON.stringify(j);
    // admrul 전문 API는 호출 서버 IP가 계정에 등록돼 있지 않으면 조문 대신
    // 오류 문구("사용자 정보 검증에 실패…")를 200으로 돌려준다. 조문 헤더가 없는
    // 응답으로 CLI 본문(잘렸어도 조문 포함)을 덮어쓰면 전부 미수록이 되므로 버린다.
    if (!/제\s*\d+\s*조/.test(text)) return "";
    return text;
  } catch {
    return "";
  }
}

// 본문 안에서 자기 조문이 아닌 다른 조문의 '행 시작' 헤더(제N조 …)를 만나면 그 앞에서 절단한다.
// 문장 중간의 상호참조("법 제7조제1항 …")는 행 시작이 아니므로 절단하지 않는다.
function truncateAtForeignArticle(body, ownKey) {
  const lineHeader = /^제(\d+)조(?:의(\d+))?(?:\s|\(|$)/; // 행 시작 조문 헤더/목차 라인
  const out = [];
  for (const line of body.split("\n")) {
    const hm = line.match(lineHeader);
    if (hm) {
      const key = `제${hm[1]}조${hm[2] ? `의${hm[2]}` : ""}`;
      if (key !== ownKey) break; // 다른 조문 헤더 → 여기서 멈춘다
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

// 본문 텍스트에서 "제N조(제목) …" 블록을 각 조문 단위로 분리
function parseArticleBodies(output) {
  const map = new Map();
  // 헤더 라인: 제7조(계약의 방법)  — 조문 제목 괄호 포함
  const headerRe = /제(\d+)조(?:의(\d+))?\s*\(([^)]*)\)/g;
  const marks = [];
  let m;
  while ((m = headerRe.exec(output)) !== null) {
    marks.push({ idx: m.index, key: `제${m[1]}조${m[2] ? `의${m[2]}` : ""}`, title: m[3], headEnd: headerRe.lastIndex });
  }
  // 단항 조문은 원문 본문에 "제N조(제목)" 헤더가 반복되지 않아 CLI 출력이
  // "제N조 제목" 제목 줄 + 본문 형태로만 나온다(예: 법 제20조, 영 제78조).
  // 행 시작의 괄호 없는 제목 줄도 헤더로 인식한다. 본문 속 "제N항" 이어쓰기·
  // 문장 줄과 혼동하지 않도록 제목은 60자 이하, '다.'로 끝나지 않고,
  // '제N'으로 시작하지 않는 줄로 한정한다.
  const bareHeaderRe = /^제(\d+)조(?:의(\d+))?[ \t]+(\S[^\n]*)$/gm;
  while ((m = bareHeaderRe.exec(output)) !== null) {
    const title = m[3].trim();
    if (title.length > 60 || /다\.$/.test(title) || /^제\d+\s*(?:항|호|조)/.test(title)) continue;
    marks.push({ idx: m.index, key: `제${m[1]}조${m[2] ? `의${m[2]}` : ""}`, title, headEnd: bareHeaderRe.lastIndex });
  }
  marks.sort((a, b) => a.idx - b.idx);
  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i].headEnd;
    const end = i + 1 < marks.length ? marks[i + 1].idx : output.length;
    let body = output.slice(start, end).trim();
    // JSON 잔여 구두점 정리
    body = body.replace(/\\n/g, "\n").replace(/^["\s,:]+/, "").replace(/["\s,]+$/, "").trim();
    // 방어: 본문에 섞인 다른 조문 내용 절단(자기 조문 헤더는 이미 제거된 상태이므로 첫 이질 헤더에서 멈춤)
    body = truncateAtForeignArticle(body, marks[i].key);
    if (!map.has(marks[i].key) && body) {
      map.set(marks[i].key, { title: marks[i].title, body });
    }
  }
  return map;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function processFile(file) {
  const p = path.join(DATA_DIR, file);
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  const verification = d.verification;
  if (!verification || !Array.isArray(verification.sources)) return { file, filled: 0, skipped: "no-sources" };

  const sourceByLaw = new Map();
  for (const s of verification.sources) {
    sourceByLaw.set(compact(s.law), s);
    if (s.officialName) sourceByLaw.set(compact(s.officialName), s);
  }

  // 인용 (law, baseArticle) 수집
  const needed = new Map(); // sourceKey -> {source, articles:Set, citations:[{law,article,base}]}
  for (const node of d.process?.nodes ?? []) {
    for (const lb of node.legal_basis ?? []) {
      const base = baseArticle(lb.article);
      if (!base) continue;
      const src = sourceByLaw.get(compact(lb.law));
      if (!src) continue;
      const skey = src.mst ? `mst:${src.mst}` : src.adminRuleSerial ? `adm:${src.adminRuleSerial}` : null;
      if (!skey) continue;
      if (!needed.has(skey)) needed.set(skey, { source: src, bases: new Set(), keys: new Set() });
      needed.get(skey).bases.add(base);
      needed.get(skey).keys.add(`${lb.law}::${lb.article}`);
    }
  }

  const articleTexts = {}; // "law::article" -> {title, body, effectiveOn}
  for (const [, group] of needed) {
    const src = group.source;
    let output = "";
    let fallback = "";
    if (src.mst) {
      for (const b of chunk([...group.bases], 20)) {
        output += "\n" + runCli(["get_batch_articles", "--mst", src.mst, "--articles", JSON.stringify(b)]);
      }
    } else if (src.adminRuleSerial) {
      output = runCli(["get_admin_rule", "--id", src.adminRuleSerial]);
      // CLI 출력은 항·호가 줄바꿈으로 구분된 정본이다. 다만 50,000자에서 잘리므로
      // 뒤쪽 조문은 폴백에서만 얻을 수 있다. 폴백으로 '덮어쓰면' 앞쪽 조문의
      // 줄바꿈까지 함께 잃으므로(팝업은 pre-wrap이라 문단 구분이 사라진다),
      // 덮어쓰지 않고 CLI에 없는 조문만 보충한다.
      if (/응답이 너무 길어|too long/i.test(output)) {
        fallback = await fetchAdminRuleFull(src.adminRuleSerial);
      }
    }
    const bodies = parseArticleBodies(output);
    if (fallback) {
      for (const [key, body] of parseArticleBodies(fallback)) {
        if (!bodies.has(key)) bodies.set(key, body);
      }
    }
    for (const key of group.keys) {
      const [, article] = key.split("::");
      const base = baseArticle(article);
      const hit = bodies.get(base);
      if (hit) {
        // 인용이 특정 항(제N항)을 지정하면 그 항만, 아니면 조문 전체를 담는다.
        const n = hangNumber(article);
        const text = n ? extractHang(hit.body, n) : hit.body;
        articleTexts[key] = {
          article: base,
          title: hit.title,
          // 상한 1400자는 국가계약법 시행령 제26조처럼 긴 조문·항을 중간에서 끊어,
          // 정작 인용 대상인 호가 원문에 누락되는 문제가 있었다(44건).
          text: text.slice(0, 20000),
          effectiveOn: src.effectiveOn ?? src.promulgatedOn ?? null,
        };
      }
    }
  }

  const filled = Object.keys(articleTexts).length;
  if (filled > 0) {
    verification.articleTexts = articleTexts;
    fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
  }
  return { file, filled };
}

const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json") && (!ONLY || f === `${ONLY}.json`));
let total = 0;
for (const f of files) {
  const r = await processFile(f);
  total += r.filled || 0;
  console.log(`${r.file}: ${r.filled ?? 0} 조문 원문${r.skipped ? ` (${r.skipped})` : ""}`);
}
console.log(`\n총 ${total}개 조문 원문 저장 (${files.length}개 제도)`);
