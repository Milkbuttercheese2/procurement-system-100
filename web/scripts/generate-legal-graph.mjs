// 룰(정규식) 기반 법령 그래프 인덱스 생성기.
//
// 목적:
//   제도(institution) JSON 53개의 인용정보와 조문 원문(verification.articleTexts)에서
//   LLM 없이 정규식/규칙만으로 아래 엣지를 추출해 양방향 조회 가능한 그래프 인덱스를 만든다.
//     1) 제도 → 조문        (institutionCites)   : process.nodes[].legal_basis
//     2) 조문 → 조문        (articleRefs)        : articleTexts[].text 내부 상호참조
//     3) 미해소 참조        (unresolvedRefs)     : 같은 조/항, 전항, 위 규정 등 (엣지화 불가)
//     4) 역방향 인덱스      : 조문→제도, 조문→참조한 조문
//
// 1차 소스는 institution JSON 의 verification.articleTexts (사이트에 실제 노출되는 텍스트).
// 결정론적: generatedAt 을 제외하면 두 번 돌려도 동일 출력.
//
// 사용:
//   node scripts/generate-legal-graph.mjs            # 생성 + 통계/검증샘플 출력
//   node scripts/generate-legal-graph.mjs --quiet    # 파일만 생성, 통계 최소 출력
//
// 출력: web/data/legal-graph.json
//
// 법령명 해소 규칙(요약, 자세한 근거는 아래 resolvePrefix 주석 참조):
//   - 「법령명」 제N조         → 인용부호 안 법령명으로 해소
//   - 같은 법 제N조           → 직전 「」로 인용된 법령으로 해소(없으면 미해소)
//   - 법 제N조 (시행령/규칙/예규 컨텍스트) → 모법(법률)
//   - 영/시행령 제N조         → 모법 + " 시행령"
//   - 시행규칙/규칙 제N조      → 모법 + " 시행규칙"
//   - 접두 없는 제N조          → 같은 법령(self-law)
//   - 조 없이 제N항만          → 같은 조 내 항(self-article)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(REPO_DIR, "data", "institutions");
const OUT_FILE = path.join(REPO_DIR, "data", "legal-graph.json");
const QUIET = process.argv.includes("--quiet");

// ── 키/조문 정규화 (populate-article-texts.mjs 의 baseArticle/hangNumber 방식과 동일) ──
// "제7조제1항", "제12조의2제3항" → base "제7조" / "제12조의2"
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
// base + (항) → 정규화된 조문 라벨. 그래프 키의 조문 부분.
function articleLabel(base, hang) {
  return `${base}${hang ? `제${hang}항` : ""}`;
}
function makeKey(law, base, hang) {
  return `${law}::${articleLabel(base, hang)}`;
}

// ── 법령명 해소 ──
// 계약예규/규정/요령/기준 등 접미사(" 시행령"/" 시행규칙")가 없는 컨텍스트의 모법.
// 각 예규의 제1~2조(목적/정의)에서 "시행령"/"시행규칙"의 정의를 확인해 도출:
//   - 공사계약일반조건 제2조: "시행령"=「국가를 당사자로 하는 계약에 관한 법률 시행령」
//   - 예정가격 작성기준/종합계약집행요령/입찰참가자격등록규정 등도 동일하게 국가계약법 계열.
// (사이트 데이터의 계약예규는 전부 국가계약법 계열이며 bare "법" 접두는 사용하지 않음.)
const EXPLICIT_PARENT = new Map([
  ["(계약예규) 공사계약일반조건", "국가를 당사자로 하는 계약에 관한 법률"],
  ["(계약예규) 물품구매(제조)계약일반조건", "국가를 당사자로 하는 계약에 관한 법률"],
  ["(계약예규) 예정가격 작성기준", "국가를 당사자로 하는 계약에 관한 법률"],
  ["(계약예규) 공동계약운용요령", "국가를 당사자로 하는 계약에 관한 법률"],
  ["(계약예규) 적격심사기준", "국가를 당사자로 하는 계약에 관한 법률"],
  ["(계약예규) 정부 입찰·계약 집행기준", "국가를 당사자로 하는 계약에 관한 법률"],
  ["(계약예규) 입찰참가자격사전심사요령", "국가를 당사자로 하는 계약에 관한 법률"],
  ["종합계약집행요령", "국가를 당사자로 하는 계약에 관한 법률"],
  ["국가종합전자조달시스템 입찰참가자격등록규정", "국가를 당사자로 하는 계약에 관한 법률"],
]);

// 컨텍스트 법령 → 모법(법률) 이름. 해소 실패 시 null.
function parentLawOf(contextLaw) {
  if (contextLaw.endsWith(" 시행령")) return contextLaw.slice(0, -" 시행령".length);
  if (contextLaw.endsWith(" 시행규칙")) return contextLaw.slice(0, -" 시행규칙".length);
  if (EXPLICIT_PARENT.has(contextLaw)) return EXPLICIT_PARENT.get(contextLaw);
  // 법률 자체(접미사 없음)인 경우 자기 자신이 모법.
  if (contextLaw.endsWith("법") || contextLaw.endsWith("법률") || contextLaw.endsWith("특별법")) {
    return contextLaw;
  }
  return null;
}

// 접두 토큰(법/영/시행령/시행규칙/규칙) → 대상 법령명. 해소 실패 시 null.
function resolvePrefix(contextLaw, token) {
  const parent = parentLawOf(contextLaw);
  if (!parent) return null;
  if (token === "법") return parent; // 모법(법률)
  if (token === "영" || token === "시행령") return `${parent} 시행령`;
  if (token === "규칙" || token === "시행규칙") return `${parent} 시행규칙`;
  return null;
}

// 인용부호 안 법령명 정리(공백 정규화). 자기식별적이므로 그대로 대상 법령으로 사용.
function cleanQuotedLaw(name) {
  return name.replace(/\s+/g, " ").trim();
}

// ── 참조 체인 파서 ──
// "제9조제3항", "제3항, 제5항 및 제6항", "제8조 내지 제11조", "제30조제2항 및 제105조제3항" 등을
// {base, hang} 타겟 목록으로 전개. base 가 null 이면 self-article(같은 조 항 참조).
const ATOM = new RegExp(
  [
    "제(\\d+)조(?:의(\\d+))?\\s*(?:내지|~|-)\\s*제?(\\d+)조(?:의(\\d+))?", // 1 range
    "제(\\d+)조(?:의(\\d+))?", // 2 jo
    "제(\\d+)항", // 3 hang
    "제(\\d+)호", // 4 ho (무시)
    "제(\\d+)목", // 5 mok (무시)
  ].join("|"),
  "g",
);

// start 위치(제N조/제N항)에서 시작하는 참조 체인의 끝 인덱스를 구한다.
// 연속된 제N(조|항|호|목) 토큰을 접속어(내지/및/~/·/ㆍ/,/과/와/또는)로만 이어가며 확장.
function chainEnd(text, start) {
  const linker = /^\s*(?:내지|및|또는|과|와|이나|나|·|ㆍ|,|~|-)?\s*제\d+(?:조(?:의\d+)?|항|호|목)/;
  let end = start;
  // 첫 토큰
  const first = text.slice(start).match(/^제\d+(?:조(?:의\d+)?|항|호|목)/);
  if (!first) return start;
  end = start + first[0].length;
  // 이후 토큰들
  for (;;) {
    const rest = text.slice(end);
    const m = rest.match(linker);
    if (!m) break;
    end += m[0].length;
  }
  return end;
}

// 체인 문자열을 {base, hang} 타겟 목록으로 전개.
function parseChain(chainStr) {
  const units = []; // { base: "제N조"|null, hangs: number[] }
  let cur = null;
  ATOM.lastIndex = 0;
  let m;
  while ((m = ATOM.exec(chainStr)) !== null) {
    if (m[1]) {
      // 조 범위: 제N조 내지 제M조 (가지번호 없는 단순 범위만 전개)
      const a = Number(m[1]);
      const ab = m[2] ? Number(m[2]) : null;
      const b = Number(m[3]);
      const bb = m[4] ? Number(m[4]) : null;
      if (ab === null && bb === null && b >= a && b - a <= 200) {
        for (let n = a; n <= b; n += 1) units.push((cur = { base: `제${n}조`, hangs: [] }));
      } else {
        units.push({ base: `제${a}조${ab ? `의${ab}` : ""}`, hangs: [] });
        units.push((cur = { base: `제${b}조${bb ? `의${bb}` : ""}`, hangs: [] }));
      }
    } else if (m[5]) {
      // jo
      cur = { base: `제${m[5]}조${m[6] ? `의${m[6]}` : ""}`, hangs: [] };
      units.push(cur);
    } else if (m[7]) {
      // hang
      const n = Number(m[7]);
      if (cur) cur.hangs.push(n);
      else {
        // 조 없는 항 → self-article. 직전 self 유닛에 이어붙임.
        const last = units[units.length - 1];
        if (last && last.base === null) last.hangs.push(n);
        else units.push({ base: null, hangs: [n] });
      }
    }
    // ho / mok(m[9]/m[11]) 는 무시
  }
  // 유닛 → 타겟 전개
  const targets = [];
  for (const u of units) {
    if (u.hangs.length === 0) targets.push({ base: u.base, hang: null });
    else for (const h of u.hangs) targets.push({ base: u.base, hang: h });
  }
  return targets;
}

// ── 미해소 참조 패턴 ──
// 조/항/호 뒤 경계(ARTB): 조사·구두점·다음 조문 토큰만 허용. "이 조건"·"이 조정" 같은
// 복합명사(조건/조정/조항 등) 오탐을 막기 위해 조/항 이 단독 조문 토큰일 때만 매칭.
const ARTB = "(?=\\s|에|의|을|를|은|는|이|가|,|\\.|·|ㆍ|、|과|와|및|또는|제\\d|$)";
const UNRESOLVED_RE = new RegExp(
  [
    `같은\\s*조${ARTB}`,
    `같은\\s*항${ARTB}`,
    `같은\\s*호${ARTB}`,
    `같은\\s*목${ARTB}`,
    `같은\\s*법(?!\\s*(?:시행령|시행규칙)?\\s*제\\d+조)(?!률|령|규칙)`,
    `앞의?\\s*항${ARTB}`,
    `전항${ARTB}`,
    `전조${ARTB}`,
    `동항${ARTB}`,
    `동조${ARTB}`,
    `이\\s*조${ARTB}`,
    `이\\s*항${ARTB}`,
    `해당\\s*조${ARTB}`,
    `해당\\s*항${ARTB}`,
    `위\\s*규정`,
  ].join("|"),
  "g",
);

const CONSUMED = Symbol("consumed");

// 텍스트 1개(= 조문 하나)에서 참조를 추출.
// srcLaw: 컨텍스트 법령, srcBase/srcHang: 원 조문 식별.
// 반환: { edges:[{target, raw, context}], unresolved:[{raw, snippet}], mentions, resolved, unresolvedCount }
function extractRefs(text, srcLaw, srcBase) {
  const spans = []; // [start, end) 소비 구간
  const edges = [];
  const unresolved = [];
  let mentions = 0;
  let resolved = 0;
  const inSpan = (i) => spans.some(([s, e]) => i >= s && i < e);

  const snippet = (i, len = 0) =>
    text.slice(Math.max(0, i - 18), i + len + 22).replace(/\s+/g, " ").trim();

  const addEdge = (targetLaw, base, hang, raw, kind) => {
    if (!targetLaw || !base) return;
    const target = makeKey(targetLaw, base, hang);
    edges.push({ target, raw: raw.replace(/\s+/g, " ").trim(), context: kind });
    resolved += 1;
  };

  const emitChain = (targetLawResolver, chainStr, mentionRaw, kind) => {
    const targets = parseChain(chainStr);
    for (const t of targets) {
      const base = t.base ?? srcBase; // self-article: 같은 조
      const law = t.base ? targetLawResolver : srcLaw; // self-article 는 항상 자기 법령
      mentions += 1;
      if (law) addEdge(law, base, t.hang, mentionRaw, t.base ? kind : "self-article");
      else {
        unresolved.push({ raw: mentionRaw.replace(/\s+/g, " ").trim(), snippet: mentionRaw });
      }
    }
  };

  // 1) 「법령명」 (제N조...) — 인용부호 법령
  const quotedMatches = [];
  const quoteRe = /「([^」]+)」/g;
  let qm;
  while ((qm = quoteRe.exec(text)) !== null) {
    quotedMatches.push({ start: qm.index, end: quoteRe.lastIndex, name: cleanQuotedLaw(qm[1]) });
  }
  for (const q of quotedMatches) {
    // 인용부호 바로 뒤(공백만 허용)에 제N조/제N항이 오면 체인으로 붙인다.
    const after = text.slice(q.end);
    const am = after.match(/^\s*(?=제\d+(?:조|항))/);
    if (!am) {
      spans.push([q.start, q.end]);
      continue;
    }
    const chainStart = q.end + am[0].length;
    const cEnd = chainEnd(text, chainStart);
    const chainStr = text.slice(chainStart, cEnd);
    const raw = text.slice(q.start, cEnd);
    emitChain(q.name, chainStr, raw, `quoted:「${q.name}」`);
    spans.push([q.start, cEnd]);
  }

  // 2) 같은 법 (시행령/시행규칙)? 제N조 — 직전 인용법령으로 해소
  const sameLawRe = /같은\s*법(\s*시행령|\s*시행규칙)?\s*(?=제\d+조)/g;
  let sm;
  while ((sm = sameLawRe.exec(text)) !== null) {
    if (inSpan(sm.index)) continue;
    const prior = quotedMatches.filter((q) => q.end <= sm.index).pop();
    const modifier = (sm[1] || "").trim();
    let targetLaw = prior ? prior.name : null;
    if (targetLaw && modifier === "시행령") targetLaw = `${targetLaw} 시행령`;
    if (targetLaw && modifier === "시행규칙") targetLaw = `${targetLaw} 시행규칙`;
    const chainStart = sm.index + sm[0].length;
    const cEnd = chainEnd(text, chainStart);
    const raw = text.slice(sm.index, cEnd);
    if (targetLaw) {
      emitChain(targetLaw, text.slice(chainStart, cEnd), raw, `same-law:${targetLaw}`);
    } else {
      const targets = parseChain(text.slice(chainStart, cEnd));
      mentions += targets.length || 1;
      unresolved.push({ raw: "같은 법", snippet: snippet(sm.index, raw.length) });
    }
    spans.push([sm.index, cEnd]);
  }

  // 3) 접두 토큰(법/영/시행령/시행규칙/규칙) 제N조
  //    - 단어 경계: 앞 글자가 한글/영문이 아니어야 함(예: "산업표준화법"의 법 제외)
  //    - 앞 단어가 법/률/령 로 끝나면(=긴 법령명의 일부, 예 "…법률 시행령") 접두로 보지 않음
  const prefixRe = /(?<![가-힣A-Za-z])(시행령|시행규칙|법|영|규칙)\s*(?=제\d+조)/g;
  let pm;
  while ((pm = prefixRe.exec(text)) !== null) {
    if (inSpan(pm.index)) continue;
    const before = text.slice(Math.max(0, pm.index - 6), pm.index);
    if (/(?:법|률|령)\s*$/.test(before) && (pm[1] === "시행령" || pm[1] === "시행규칙")) continue;
    const targetLaw = resolvePrefix(srcLaw, pm[1]);
    const chainStart = pm.index + pm[0].length;
    const cEnd = chainEnd(text, chainStart);
    const raw = text.slice(pm.index, cEnd);
    if (targetLaw) {
      emitChain(targetLaw, text.slice(chainStart, cEnd), raw, `prefix:${pm[1]}`);
    } else {
      const targets = parseChain(text.slice(chainStart, cEnd));
      mentions += targets.length || 1;
      unresolved.push({ raw: `${pm[1]}(미해소 모법)`, snippet: snippet(pm.index, raw.length) });
    }
    spans.push([pm.index, cEnd]);
  }

  // 4) 접두 없는 제N조 (self-law)
  const bareJoRe = /제\d+조(?:의\d+)?/g;
  let bm;
  while ((bm = bareJoRe.exec(text)) !== null) {
    if (inSpan(bm.index)) continue;
    const cEnd = chainEnd(text, bm.index);
    const raw = text.slice(bm.index, cEnd);
    emitChain(srcLaw, text.slice(bm.index, cEnd), raw, "self-law");
    spans.push([bm.index, cEnd]);
  }

  // 5) 접두 없는 제N항 (self-article: 같은 조 항 참조). 나열("제3항, 제5항 및 제6항")은 개별 전개.
  const bareHangRe = /제(\d+)항/g;
  let hm;
  while ((hm = bareHangRe.exec(text)) !== null) {
    if (inSpan(hm.index)) continue;
    const cEnd = chainEnd(text, hm.index);
    const chainStr = text.slice(hm.index, cEnd);
    const raw = text.slice(hm.index, cEnd);
    // parseChain 은 base=null(=self-article) 항 목록을 돌려준다.
    emitChain(srcLaw, chainStr, raw, "self-article");
    spans.push([hm.index, cEnd]);
  }

  // 6) 미해소 지시어(같은 조/항, 전항, 위 규정 등)
  UNRESOLVED_RE.lastIndex = 0;
  let um;
  while ((um = UNRESOLVED_RE.exec(text)) !== null) {
    if (inSpan(um.index)) continue;
    mentions += 1;
    unresolved.push({ raw: um[0].replace(/\s+/g, " ").trim(), snippet: snippet(um.index, um[0].length) });
  }

  return { edges, unresolved, mentions, resolved };
}

// ─────────────────────────── 메인 ───────────────────────────
function main() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).sort();

  const institutions = {}; // slug -> { name, cites:Set }
  const articles = new Map(); // key -> { law, article, title, citedBy:Set, refsTo:[], referencedBy:Set }
  const articleText = new Map(); // key -> text (해소용, 최초 1회)
  const unresolvedAll = [];
  let mentionsTotal = 0;
  let resolvedTotal = 0;

  const ensureArticle = (key, law, base, title) => {
    if (!articles.has(key)) {
      articles.set(key, {
        law,
        article: key.slice(law.length + 2),
        title: title ?? null,
        citedBy: new Set(),
        citedByNodes: new Set(), // "slug\tnodeId"
        refsTo: [],
        referencedBy: new Set(),
      });
    } else if (title && !articles.get(key).title) {
      articles.get(key).title = title;
    }
    return articles.get(key);
  };

  // ── 1차 패스: 제도→조문 인용 + 조문 원문 수집 ──
  for (const file of files) {
    const slug = file.replace(/\.json$/, "");
    const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
    const cites = new Set();
    const at = d.verification?.articleTexts ?? {};

    for (const node of d.process?.nodes ?? []) {
      for (const lb of node.legal_basis ?? []) {
        const base = baseArticle(lb.article);
        if (!base) continue;
        const hang = hangNumber(lb.article);
        const key = makeKey(lb.law, base, hang);
        const title = at[key]?.title ?? null;
        const art = ensureArticle(key, lb.law, base, title);
        art.citedBy.add(slug);
        if (node.id) art.citedByNodes.add(`${slug}\t${node.id}`);
        cites.add(key);
      }
    }
    institutions[slug] = { name: d.name ?? slug, cites };

    // 조문 원문 수집(최초 1회) — 결정론: 파일명 정렬 순서
    for (const [key, v] of Object.entries(at)) {
      const law = key.slice(0, key.indexOf("::"));
      const artPart = key.slice(law.length + 2);
      const base = baseArticle(artPart);
      if (!base) continue;
      const hang = hangNumber(artPart);
      const nkey = makeKey(law, base, hang);
      ensureArticle(nkey, law, base, v.title ?? null);
      if (!articleText.has(nkey)) articleText.set(nkey, v.text ?? "");
    }
  }

  // ── 2차 패스: 조문→조문 참조 (원문 텍스트에서) ──
  const refKeys = [...articleText.keys()].sort();
  for (const key of refKeys) {
    const text = articleText.get(key);
    if (!text) continue;
    const law = key.slice(0, key.indexOf("::"));
    const base = baseArticle(key.slice(law.length + 2));
    const { edges, unresolved, mentions, resolved } = extractRefs(text, law, base);
    mentionsTotal += mentions;
    resolvedTotal += resolved;

    // 엣지 dedupe + self-loop 제거
    const seen = new Set();
    const srcArt = articles.get(key);
    for (const e of edges) {
      if (e.target === key) continue; // self-loop
      if (seen.has(e.target)) continue;
      seen.add(e.target);
      srcArt.refsTo.push(e);
    }
    for (const u of unresolved) unresolvedAll.push({ source: key, raw: u.raw, snippet: u.snippet });
  }

  // ── 3차 패스: 법제처 3단비교(thdCmp) 공식 위임관계 병합 ──
  // sources/law-cache/delegation-map.json (fetch-delegation-map.mjs가 수집한
  // 공식 메타데이터)을 오프라인으로 소비한다. 룰 추론이 아닌 법제처 관리
  // 데이터이므로 위임 엣지의 정본으로 삼고, 룰 기반 역참조(하위법의 "법
  // 제N조")와의 일치율을 교차검증 지표로 보고한다.
  let delegationEdges = 0;
  let delegationCrossChecked = 0;
  const delegationPath = path.join(REPO_DIR, "..", "sources", "law-cache", "delegation-map.json");
  if (fs.existsSync(delegationPath)) {
    const dmap = JSON.parse(fs.readFileSync(delegationPath, "utf8")).delegations ?? {};
    for (const [srcKey, targets] of Object.entries(dmap)) {
      const law = srcKey.slice(0, srcKey.indexOf("::"));
      const base = srcKey.slice(law.length + 2);
      const srcArt = ensureArticle(srcKey, law, base, null);
      const seen = new Set(srcArt.refsTo.map((e) => e.target));
      for (const t of targets) {
        const tKey = `${t.law}::${t.article}`;
        if (tKey === srcKey || seen.has(tKey)) continue;
        seen.add(tKey);
        srcArt.refsTo.push({ target: tKey, raw: `3단비교 ${t.tier}`, context: "delegation-official" });
        delegationEdges += 1;
        // 교차검증: 하위법 조문(어느 항이든)이 룰 추출로 이 법률 조문
        // (어느 항이든)을 역참조하는가 — 조 단위로 정규화해 비교
        const baseOf = (k) => {
          const i = k.indexOf("::");
          const m2 = k.slice(i + 2).match(/^제\d+조(?:의\d+)?/);
          return m2 ? k.slice(0, i + 2) + m2[0] : k;
        };
        const srcBase = baseOf(srcKey);
        const tBasePrefix = baseOf(tKey);
        let matched = false;
        for (const [ak, av] of articles) {
          if (!ak.startsWith(tBasePrefix)) continue;
          if (av.refsTo.some((e) => e.context !== "delegation-official" && baseOf(e.target) === srcBase)) { matched = true; break; }
        }
        if (matched) delegationCrossChecked += 1;
      }
    }
  }

  // ── 역방향 인덱스: referencedBy ──
  for (const [key, art] of articles) {
    for (const e of art.refsTo) {
      // 대상 조문 노드가 없으면 스텁 생성(참조-전용 노드) → 역방향 조회 완전성 확보
      const tLaw = e.target.slice(0, e.target.indexOf("::"));
      const tBase = baseArticle(e.target.slice(tLaw.length + 2));
      const t = ensureArticle(e.target, tLaw, tBase, null);
      t.referencedBy.add(key);
    }
  }

  // ── 직렬화(결정론: 키/배열 정렬) ──
  const sortedArticleKeys = [...articles.keys()].sort();
  const articlesOut = {};
  for (const key of sortedArticleKeys) {
    const a = articles.get(key);
    articlesOut[key] = {
      law: a.law,
      article: a.article,
      title: a.title,
      citedByInstitutions: [...a.citedBy].sort(),
      citedByNodes: [...a.citedByNodes]
        .sort()
        .map((s) => ({ slug: s.split("\t")[0], node: s.split("\t")[1] })),
      refsTo: [...a.refsTo].sort((x, y) => (x.target < y.target ? -1 : x.target > y.target ? 1 : 0)),
      referencedBy: [...a.referencedBy].sort(),
    };
  }

  const institutionsOut = {};
  for (const slug of Object.keys(institutions).sort()) {
    institutionsOut[slug] = {
      name: institutions[slug].name,
      cites: [...institutions[slug].cites].sort(),
    };
  }

  const unresolvedOut = unresolvedAll
    .slice()
    .sort((a, b) =>
      a.source < b.source ? -1 : a.source > b.source ? 1 : a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0,
    );

  const institutionCiteEdges = Object.values(institutionsOut).reduce((n, i) => n + i.cites.length, 0);
  const articleRefEdges = sortedArticleKeys.reduce((n, k) => n + articlesOut[k].refsTo.length, 0);
  const citedArticles = sortedArticleKeys.filter((k) => articlesOut[k].citedByInstitutions.length).length;

  const out = {
    generatedAt: new Date().toISOString(),
    stats: {
      institutions: Object.keys(institutionsOut).length,
      articles: sortedArticleKeys.length,
      citedArticles,
      referenceOnlyArticles: sortedArticleKeys.length - citedArticles,
      institutionCiteEdges,
      articleRefEdges,
      delegationEdges,
      delegationCrossChecked,
      unresolvedRefs: unresolvedOut.length,
    },
    articles: articlesOut,
    institutions: institutionsOut,
    unresolved: unresolvedOut,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n");

  // ── 통계 출력 ──
  const coverage = mentionsTotal ? ((resolvedTotal / mentionsTotal) * 100).toFixed(1) : "0.0";
  console.log(`생성: ${path.relative(REPO_DIR, OUT_FILE)}`);
  console.log("stats:", JSON.stringify(out.stats));
  console.log(
    `참조 패턴 총 ${mentionsTotal}건 중 ${resolvedTotal}건 해소 / ${mentionsTotal - resolvedTotal}건 미해소 (커버리지 ${coverage}%)`,
  );

  if (!QUIET) {
    // 미해소 유형별 빈도(정규화)
    const freq = new Map();
    const normType = (raw) => {
      if (/^같은\s*조/.test(raw)) return "같은 조(의 항)";
      if (/^같은\s*항/.test(raw)) return "같은 항";
      if (/^같은\s*호/.test(raw)) return "같은 호";
      if (/^같은\s*법/.test(raw)) return "같은 법(선행 인용 없음)";
      if (/self\)$/.test(raw)) return "제N항(self, 조 미상)";
      if (/미해소 모법/.test(raw)) return "접두어 모법 미해소";
      if (/전항/.test(raw)) return "전항";
      if (/전조/.test(raw)) return "전조";
      if (/동항/.test(raw)) return "동항";
      if (/동조/.test(raw)) return "동조";
      if (/^이\s*조/.test(raw)) return "이 조";
      if (/^이\s*항/.test(raw)) return "이 항";
      if (/위\s*규정/.test(raw)) return "위 규정";
      return raw;
    };
    for (const u of unresolvedOut) freq.set(normType(u.raw), (freq.get(normType(u.raw)) || 0) + 1);
    console.log("\n미해소 참조 유형별 빈도:");
    for (const [t, n] of [...freq.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${t}`);
    }

    // 검증 샘플
    console.log("\n── 검증 샘플 ──");
    const S1 = "국가를 당사자로 하는 계약에 관한 법률 시행령::제76조";
    console.log(`[1] ${S1} 를 인용하는 제도:`);
    console.log("   ", (articlesOut[S1]?.citedByInstitutions || []).join(", ") || "(없음)");

    console.log(`[2] debarment 가 인용하는 조문 (${institutionsOut.debarment?.cites.length || 0}건):`);
    console.log("   ", (institutionsOut.debarment?.cites || []).slice(0, 20).join("\n    "));

    const S3 = "국가를 당사자로 하는 계약에 관한 법률 시행령::제76조제8항";
    console.log(`[3] ${S3} 가 참조하는 조문:`);
    for (const e of articlesOut[S3]?.refsTo || []) console.log(`    → ${e.target}   (${e.context}) [${e.raw}]`);
    console.log(`    (원문 제8항: "…제3항, 제5항 또는 제6항에 따라 입찰참가자격을 제한받은 자…" 와 대조)`);

    const S4 = "국가를 당사자로 하는 계약에 관한 법률 시행령::제76조제3항";
    console.log(`[4] ${S4} 가 참조하는 조문 (법/self 해소 확인):`);
    for (const e of articlesOut[S4]?.refsTo || []) console.log(`    → ${e.target}   (${e.context}) [${e.raw}]`);
  }

  return out;
}

main();
