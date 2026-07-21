// 상황 설명 → 검증된 조문에 근거한 안내.
//
// 파이프라인:
//   0) 프리필터   66개를 글자 2-gram 겹침으로 15개로 좁힌다(LLM 호출 0회, 토큰 0).
//                 점수가 하한에 못 미치면 조달 질문이 아니라고 보고 여기서 끝낸다.
//   1) 제도 선택   좁혀진 목록에서 최대 3개를 고른다(slug는 enum으로 강제).
//   2) 근거 답변   고른 제도의 '검증된 조문 원문'만 주고, 문장마다 원문에서 그대로
//                 뜯어온 인용구를 함께 내게 한다.
//   3) 대조        인용구가 원문에 문자열로 실재하는지 확인한다. 실패한 문장은
//                 버린다(로그만 남기지 않는다 — 근거 없는 문장이 화면에 뜨는 것이
//                 이 사이트에서 가장 나쁜 실패다).
//
// 환각 방지의 핵심은 3)이다. "조문을 봤다"가 아니라 "이 문장이 이 원문의 이 구절에서
// 나왔다"를 기계적으로 확인한다. 모델이 실재하는 조문번호를 달고 엉뚱한 말을 하는
// 경우까지 잡으려면 조문 존재 확인만으로는 부족하다.
//
// 그래도 완전하지는 않다. 인용구가 진짜여도 그 구절이 그 문장을 뒷받침하는지까지는
// 기계가 판단하지 못한다. 그래서 인용마다 국가법령정보센터 링크를 붙여 사용자가
// 직접 대조할 수 있게 한다.

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
// 조문 원문(2.9MB)은 번들에 넣지 않는다. Worker 상한(무료 3 MiB)을 넘는다.
// public/articles/<slug>.json 으로 두고 필요한 것만 런타임에 읽는다.
import routingIndex from "../../../../data/routing-index.json";
import buildStamp from "../../../../data/build-stamp.json";
import { CHAT_ENABLED } from "@/lib/features";
// 조문이 가리키는 별표의 제목과 원문 링크. 본문(HWP/PDF)은 담지 않는다 —
// 표를 텍스트로 옮기면 행·열 관계가 깨져 오히려 틀린 근거가 된다.
import annexes from "../../../../data/annexes.json";

const MAX_QUERY_LENGTH = 500;
const MAX_CANDIDATES = 3;
const PREFILTER_KEEP = 15;
// 프리필터 점수 하한. 이보다 낮으면 조달 질문으로 보지 않고 모델을 부르지 않는다.
//
// 이 하한의 역할은 "정답을 고르는 것"이 아니라 "명백히 무관한 질문에서 모델을
// 아끼는 것"뿐이다. 순위 정확도는 상위 15개를 1단계 모델에 넘겨 맡긴다
// (실측 recall@15 = 14/15).
//
// scripts/calibrate-prefilter.mjs 실측(조달 20건 / 무관 8건):
//   조달 최저 0.063("선금을 주고 싶은데 절차가 어떻게 되나요")
//   무관 최고 0.250("이혼 소송 절차" — 법률 어휘가 겹친다)
//   0.05 → 조달 20/20 통과, 무관 4/8 차단
//   0.12 → 조달 19/20   ← 선금 질문이 차단됐다. 실제로 겪은 오작동이다.
//
// 임계값을 올려 무관 질문을 더 거르려다 진짜 질문을 막았다. 통과한 무관 질문은
// 1단계에서 후보 0개로 걸러지므로, 하한은 낮게 두고 판단은 모델에 넘긴다.
const PREFILTER_FLOOR = 0.05;
// 너무 짧은 인용구는 아무 데나 걸린다("계약", "제1항"). 대조의 의미가 생기는 하한.
const MIN_QUOTE_LENGTH = 12;
// 2단계에 싣는 '항' 개수. 조 단위로 싣던 것을 항 단위로 바꿨다.
//
// 조 전체로 검색하면 긴 조가 아무 질문에나 걸린다 — 실측에서 "지체상금률이
// 얼마인가요"에 1,881자 제25조(지체상금 일반)가 386자 제75조(지체상금률, 실제 답)와
// 같은 점수를 받았다. 긴 글일수록 겹치는 2-gram이 많아서다. 답이 특정 항이나 호에
// 있는데 관련성이 먼 조가 근거로 딸려오면 동문서답이 된다.
//
// 항으로 쪼개면(조 884건 → 검색 단위 1,853개) 요율이 적힌 항이 직접 걸린다.
// 점수도 Dice로 바꿔 긴 단위에 붙던 이점을 없앴다.
//
// 개수는 근거 포함률로 정했다(scripts/eval/retrieval.mjs):
//   18항 → 94.7%   24항 → 94.7%   30항 → 100%   40항 → 100%
// 항은 조보다 훨씬 짧아서 30개를 실어도 텍스트가 크게 늘지 않는다. 답에 필요한
// 내용을 빠뜨리는 쪽이 토큰 몇백 개보다 손해가 크다.
const MAX_ARTICLES = 30;
// 이어서 보낼 이전 대화 수. 후속 질문("그럼 얼마나 되나요")이 앞 맥락을 잃지
// 않게 하는 것이 목적이라 길게 둘 이유가 없다. 길수록 토큰만 늘고, 오래된
// 화제가 남아 엉뚱한 제도로 끌고 가기도 한다.
const MAX_HISTORY = 3;

// 모델명은 요청 시점에 읽는다. Worker에서 환경값은 요청마다 넘어오는 env 객체에
// 담기므로, 모듈 로드 시 process.env를 읽으면 기본값으로 굳어버린다(시크릿에서
// 같은 문제를 이미 겪었다).
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";
// gemini-3.5-flash 는 무료 티어 할당량이 사실상 없다 — 맨몸 호출에서도 항상
// 429(RESOURCE_EXHAUSTED)가 났고, 같은 키로 flash-lite 는 200이 떨어졌다.
// 게이트웨이·키 문제가 아니라 모델 선택 문제였다.
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
// output_config.effort 를 받는 모델. Haiku 계열은 지원하지 않는다(400).
const SUPPORTS_EFFORT = /^claude-(opus|sonnet|fable|mythos)/;

interface RoutingEntry {
  slug: string;
  name: string;
  category: string;
  oneLiner: string;
  applicability: string;
  related: string[];
}

interface Clause {
  /** "제1항" — 항 표시가 없는 조는 빈 문자열 */
  label: string;
  text: string;
}

interface ArticleAsset {
  key: string;
  law: string;
  article: string;
  title: string;
  text: string;
  url?: string;
  /** 법률 / 대통령령 / 부령 / 행정규칙 — "제26조"만으로는 구분이 안 된다. */
  kind?: string;
  effectiveOn?: string;
  promulgatedOn?: string;
  clauses?: Clause[];
}

interface ArticleFile {
  asOfDate?: string;
  articles: ArticleAsset[];
}

const ENTRIES = routingIndex as RoutingEntry[];
const NAME_BY_SLUG = new Map(ENTRIES.map((e) => [e.slug, e.name]));

// ── 0) 프리필터 ─────────────────────────────────────────────────────────────
// 글자 2-gram 겹침. 형태소 분석기 없이도 한국어에서 꽤 잘 듣고, 무엇보다 로컬이라
// 토큰을 쓰지 않는다. 인덱스 전체를 매번 모델에 넣던 것을 4분의 1로 줄인다.

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  const t = s.replace(/\s/g, "");
  for (let i = 0; i < t.length - 1; i += 1) out.add(t.slice(i, i + 2));
  return out;
}

const BLOB = new Map(
  ENTRIES.map((e) => [
    e.slug,
    bigrams(`${e.name}${e.oneLiner}${e.applicability}${e.category}`),
  ]),
);

function prefilter(query: string) {
  const q = bigrams(query);
  if (q.size === 0) return { top: [] as RoutingEntry[], score: 0 };
  const scored = ENTRIES.map((e) => {
    const b = BLOB.get(e.slug)!;
    let shared = 0;
    for (const g of q) if (b.has(g)) shared += 1;
    return { e, score: shared / q.size };
  }).sort((a, b) => b.score - a.score);
  return {
    top: scored.slice(0, PREFILTER_KEEP).map((x) => x.e),
    score: scored[0]?.score ?? 0,
  };
}

const entryText = (e: RoutingEntry) =>
  [
    `slug: ${e.slug}`,
    `이름: ${e.name}`,
    `분류: ${e.category}`,
    `요약: ${e.oneLiner}`,
    e.applicability ? `적용대상: ${e.applicability}` : "",
    e.related.length > 0
      ? `연결된 제도: ${e.related.map((s) => NAME_BY_SLUG.get(s)).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

// ── 조문 자산 읽기 ──────────────────────────────────────────────────────────

/**
 * 별표 본문을 읽는다.
 *
 * 제목 인덱스(data/annexes.json)는 번들에 있지만 본문(145KB)은 정적 자산으로 둔다.
 * 질의에 걸린 별표만 가져오면 되므로 전부 번들에 넣을 이유가 없다.
 */
let annexTextCache: Record<string, { text?: string }> | null = null;
async function loadAnnexTexts(
  request: Request,
): Promise<Record<string, { text?: string }>> {
  if (annexTextCache) return annexTextCache;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const assets = (ctx.env as Record<string, unknown>).ASSETS as
      | { fetch: (req: Request | URL) => Promise<Response> }
      | undefined;
    if (assets) {
      const res = await assets.fetch(new URL("/annexes.json", "https://assets.local"));
      if (res.ok) {
        annexTextCache = (await res.json()) as Record<string, { text?: string }>;
        return annexTextCache;
      }
    }
  } catch {
    /* 아래로 폴백 */
  }
  try {
    const res = await fetch(new URL("/annexes.json", request.url));
    if (res.ok) {
      annexTextCache = (await res.json()) as Record<string, { text?: string }>;
      return annexTextCache;
    }
  } catch {
    /* 본문을 못 읽으면 제목만으로 안내한다 */
  }
  return {};
}

async function loadArticles(
  slug: string,
  request: Request,
): Promise<ArticleFile> {
  // Worker에서는 ASSETS 바인딩이 가장 직접적인 경로다.
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const assets = (ctx.env as Record<string, unknown>).ASSETS as
      | { fetch: (req: Request | URL) => Promise<Response> }
      | undefined;
    if (assets) {
      const res = await assets.fetch(
        new URL(`/articles/${slug}.json`, "https://assets.local"),
      );
      if (res.ok) return (await res.json()) as ArticleFile;
    }
  } catch {
    // 로컬 next dev 등 Cloudflare 컨텍스트가 없는 환경 → 아래로 폴백.
  }
  try {
    const res = await fetch(new URL(`/articles/${slug}.json`, request.url));
    if (res.ok) return (await res.json()) as ArticleFile;
  } catch {
    /* 자산을 못 읽으면 근거 없이 답하지 않고 빈 목록을 돌려준다 */
  }
  return { articles: [] };
}

/**
 * 클라이언트가 보낸 대화 이력을 검증한다.
 *
 * 이력은 전적으로 클라이언트가 만들어 보내는 값이라 그대로 믿지 않는다. 길이를
 * 자르고, slug는 실재하는 것만 남긴다 — 지어낸 slug가 프롬프트에 들어가면 모델이
 * 없는 제도를 있다고 여긴다.
 */
function readHistory(raw: unknown): Array<{ query: string; slugs: string[] }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-MAX_HISTORY)
    .map((item) => {
      const r = item as { query?: unknown; slugs?: unknown };
      const q = typeof r.query === "string" ? r.query.trim().slice(0, 200) : "";
      const slugs = Array.isArray(r.slugs)
        ? r.slugs
            .filter((s): s is string => typeof s === "string")
            .filter((s) => NAME_BY_SLUG.has(s))
            .slice(0, MAX_CANDIDATES)
        : [];
      return { query: q, slugs };
    })
    .filter((h) => h.query.length > 0);
}

/** 프롬프트에 붙일 이전 대화 요약. 답변 본문은 넣지 않는다 — 길기만 하고, 우리가
 *  이미 검증해 화면에 띄운 것이라 모델이 다시 볼 필요가 없다. */
function historyBlock(history: Array<{ query: string; slugs: string[] }>) {
  if (history.length === 0) return "";
  const lines = history.map((h, i) => {
    const names = h.slugs.map((s) => NAME_BY_SLUG.get(s)).filter(Boolean);
    return `${i + 1}. "${h.query}"${names.length ? ` → 안내한 제도: ${names.join(", ")}` : ""}`;
  });
  return [
    "",
    "",
    "[이전 대화 — 이어지는 질문일 수 있으니 참고하십시오]",
    ...lines,
    '지시대명사나 생략된 주어("그럼", "그건", "얼마나")는 위 맥락으로 해석하십시오.',
    "이어지는 질문이면 직전에 안내한 제도를 그대로 유지하십시오. 사용자가 화제를",
    "분명히 바꾼 경우에만 다른 제도를 고르십시오.",
  ].join("\n");
}

// ── 스키마 ─────────────────────────────────────────────────────────────────

const stage1Schema = (slugs: string[]) => ({
  type: "object",
  properties: {
    candidates: { type: "array", items: { type: "string", enum: slugs } },
  },
  required: ["candidates"],
  additionalProperties: false,
});

// 문장 단위로 근거를 묶는다. 통째로 긴 답을 받으면 어느 부분이 어느 조문에서
// 나왔는지 알 수 없어 대조가 불가능하다.
const stage2Schema = (keys: string[]) => ({
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          quote: { type: "string" },
          article: { type: "string", enum: keys },
        },
        required: ["text", "quote", "article"],
        additionalProperties: false,
      },
    },
    needsMoreInfo: { type: "boolean" },
  },
  required: ["claims", "needsMoreInfo"],
  additionalProperties: false,
});

const STAGE2_RULES = `아래 조문 원문에 **실제로 적힌 내용만** 근거로, 질문에 답하십시오.

가장 중요한 것: **묻지 않은 것을 말하지 마십시오.**
조문에 있다고 해서 넣지 말고, 그 사람이 물어본 것에만 답합니다. 개수를 채우려고
관련 없는 조문을 끌어오면 동문서답이 됩니다.

- 한 문장으로 답할 수 있으면 한 문장만 쓰십시오. 억지로 늘리지 마십시오.
- 첫 문장은 질문에 대한 직접적인 답이어야 합니다. 배경 설명부터 시작하지 마십시오.
  ("얼마나 되나" → 금액·기준부터. "어떻게 하나" → 첫 단계부터. "가능한가" → 된다/안 된다를
   가르는 요건부터.)
- 주어진 조문으로 답할 수 없는 질문이면, 억지로 비슷한 조문을 끌어다 답하지 말고
  "제공된 조문에서는 확인되지 않는다"고 밝히십시오.
- 보통 2~4개면 충분합니다. 정말 필요할 때만 그 이상 씁니다.

각 문장(claim)은 셋을 함께 냅니다:
- text: 사용자에게 보일 한 문장. 담당자가 읽고 바로 이해할 수 있는 말로 씁니다.
  조문 문체를 그대로 옮기지 말고, 실무자에게 설명하듯 풀어 쓰십시오.
- quote: 그 문장의 근거가 되는 구절을 **조문 원문에서 글자 그대로** 복사합니다.
  요약하거나 다듬지 마십시오. 원문과 한 글자라도 다르면 그 문장은 버려집니다.
- article: 그 구절이 있는 조문 키. 목록에 있는 것만 씁니다.

절대 하지 말 것:
- 원문에 없는 수치·기한·요건·절차를 쓰는 것. 기억에 있는 조문을 끌어오지 마십시오.
- 원문으로 뒷받침되지 않는 말. 근거가 없으면 그 문장은 아예 빼십시오.

상황이 모호해 좁힐 수 없으면 needsMoreInfo를 true로 두십시오.`;

const ANNEX_INDEX = annexes as Record<
  string,
  { law: string; annex: string; title: string; url?: string }
>;

/**
 * 원문에 언급된 별표의 '제목'만 알려준다.
 *
 * 별표 본문은 HWP/PDF 표라 텍스트로 옮기면 행·열이 무너진다. 그래서 제목까지만
 * 주고 내용은 링크로 넘긴다. 제목만 있어도 "그 별표가 무엇을 정한 것인지"는
 * 정확히 말할 수 있고, 구체적 수치를 지어내는 것은 계속 막을 수 있다.
 */
/**
 * 질의와 가까운 별표를 찾는다.
 *
 * 별표 본문(HWP/PDF 표)은 갖고 있지 않아서, 답이 별표 안에 있는 질문은 근거를
 * 못 만든다 — 실제로 "공사수행능력 신인도평가"가 제도만 뜨고 문장은 0건이었다.
 * 검증이 제 일을 한 것이지만, 사용자에게는 그냥 답이 없는 화면이다.
 * 내용을 지어내지 않으면서 도움이 되는 유일한 방법은 "그건 이 별표에 있다"고
 * 정확히 알려주는 것이다.
 */
function matchAnnexes(
  query: string,
  texts: Record<string, { text?: string }>,
) {
  // 제목만으로 재면 정작 답이 든 별표를 놓친다 — "신인도"를 물었을 때 그 내용이
  // 있는 별표1의 제목은 "추정가격 100억원 미만…"이라 한 글자도 안 겹쳤다.
  // 본문까지 넣고 재야 걸린다.
  const q = bigrams(query);
  if (q.size === 0) return [];
  return Object.entries(ANNEX_INDEX)
    .map(([key, a]) => {
      const body = texts[key]?.text ?? "";
      const g = bigrams(`${a.law}${a.title}${body}`);
      let shared = 0;
      for (const x of q) if (g.has(x)) shared += 1;
      // 본문이 길어 Dice가 작아지므로 질의 기준으로 정규화한다.
      return { annex: a, key, score: shared / q.size };
    })
    .filter((x) => x.score >= 0.3)
    .sort((x, y) => y.score - x.score)
    .slice(0, 2);
}

function annexNote(corpus: string, articles: ArticleAsset[]) {
  const laws = new Set(articles.map((a) => a.law.replace(/^\([^)]*\)\s*/, "")));
  const found: string[] = [];
  for (const hit of new Set(corpus.match(/별표\s*\d+(?:의\d+)?/g) ?? [])) {
    const no = hit.replace(/\s+/g, "");
    for (const law of laws) {
      const entry = ANNEX_INDEX[`${law}::${no}`];
      if (entry) {
        found.push(`- ${law} ${no}: ${entry.title}`);
        break;
      }
    }
  }
  if (found.length === 0) return "";
  return [
    "",
    "",
    "[원문이 가리키는 별표]",
    ...found,
    "별표의 제목까지만 제공됩니다. 그 안에 정해진 구체적 기준·금액·기간·배점은",
    "주어지지 않았으니 쓰지 마십시오. 어떤 별표에 정해져 있는지만 안내하고,",
    "구체적 내용은 조문 링크에서 확인하라고 하십시오.",
  ].join("\n");
}

const ANNEX_WARNING = `
주의: 아래 원문에 "별표 N"이 언급되더라도 그 별표의 내용은 제공되지 않았습니다.
별표에 정해진 구체적 기준·금액·기간·배점을 쓰지 마십시오. "그 기준은 해당 별표에
정해져 있으니 조문 링크에서 확인하라"는 취지로만 안내하십시오.`;

// ── 대조 ───────────────────────────────────────────────────────────────────

/**
 * 대조용 정규화.
 *
 * 공백뿐 아니라 HTML 태그도 지운다. 별표 본문은 표 마크업(<tr><td>…<br>…)이라,
 * 모델이 셀 내용을 자연스럽게 인용하면 <br> 하나 때문에 원문과 안 맞는다 —
 * "담합하면 제한 몇 년"이 별표2를 정확히 찾고도 답을 못 내던 이유가 이것이다.
 * 태그는 내용이 아니므로 무시해도 대조가 느슨해지지 않는다.
 */
const flatten = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, "")
    .replace(/\s+/g, "");

interface VerifiedClaim {
  text: string;
  /** 전체 키. "법령명::제N조" */
  article: string;
  /** 화면 표시용 조문 번호만. "제25조" */
  articleNo: string;
  law: string;
  kind?: string;
  effectiveOn?: string;
  title: string;
  url?: string;
}

/**
 * 인용구가 조문 원문에 실재하는지 확인하고, 통과한 문장만 남긴다.
 * 공백만 무시하고 글자는 그대로 대조한다 — 느슨하게 하면 대조의 의미가 없다.
 */
function verifyClaims(
  claims: Array<{ text?: unknown; quote?: unknown; article?: unknown }>,
  articles: ArticleAsset[],
  byKey = new Map(articles.map((a) => [a.key, a])),
) {
  const kept: VerifiedClaim[] = [];
  const dropped: string[] = [];

  for (const c of claims) {
    const text = typeof c.text === "string" ? c.text.trim() : "";
    const quote = typeof c.quote === "string" ? c.quote.trim() : "";
    const key = typeof c.article === "string" ? c.article : "";
    const article = byKey.get(key);

    if (!text || !article) {
      dropped.push(text || "(빈 문장)");
      continue;
    }
    if (flatten(quote).length < MIN_QUOTE_LENGTH) {
      dropped.push(text);
      continue;
    }
    if (!flatten(article.text).includes(flatten(quote))) {
      dropped.push(text);
      continue;
    }
    kept.push({
      text,
      article: key,
      // 화면에는 조문 번호만 보인다. 법령명은 길어서 문장 뒤에 붙으면 읽기를
      // 방해한다 — 법령명·구분·시행일은 링크의 title로 넘긴다.
      articleNo: article.article || key.split("::")[1] || key,
      law: article.law,
      kind: article.kind,
      effectiveOn: article.effectiveOn,
      title: article.title,
      url: article.url,
    });
  }
  return { kept, dropped };
}

// ── 제공자 ─────────────────────────────────────────────────────────────────

// SDK가 인덱스 시그니처를 요구한다.
type JsonSchema = Record<string, unknown>;

interface Provider {
  name: string;
  json: (
    system: string,
    user: string,
    schema: JsonSchema,
    maxTokens: number,
  ) => Promise<unknown>;
  /** 2단계용. 본문 조각을 오는 대로 흘려준다. */
  stream: (
    system: string,
    user: string,
    schema: JsonSchema,
    maxTokens: number,
  ) => AsyncIterable<string>;
}

/**
 * 자라나는 JSON 문자열에서 완성된 claim 객체만 차례로 꺼낸다.
 *
 * 스트리밍의 목적은 "빨리 보여주기"인데, 검증 전 문장을 띄우면 근거 없는 말이
 * 잠깐 보였다 사라진다 — 이 사이트에서 가장 피해야 할 실패다. 그래서 문자 단위로
 * 흘리지 않고 claim 하나가 닫히는 순간마다 꺼내서, 서버에서 대조를 통과한 것만
 * 내보낸다. 사용자가 보는 문장은 전부 이미 검증된 것이다.
 */
function makeClaimReader() {
  let buffer = "";
  let cursor = -1; // claims 배열 안으로 들어가기 전에는 -1

  return function read(chunk: string): Array<Record<string, unknown>> {
    buffer += chunk;
    const out: Array<Record<string, unknown>> = [];

    // 바깥 래퍼({"claims":[ ... ]})를 먼저 지나야 한다. 그러지 않으면 첫 '{'가
    // 래퍼로 잡혀 배열 전체를 한 덩어리로 건너뛰고, claim이 하나도 안 나온다.
    if (cursor < 0) {
      const key = buffer.indexOf('"claims"');
      if (key < 0) return out;
      const bracket = buffer.indexOf("[", key);
      if (bracket < 0) return out;
      cursor = bracket + 1;
    }

    for (;;) {
      const start = buffer.indexOf("{", cursor);
      if (start < 0) return out;
      let depth = 0;
      let inString = false;
      let escaped = false;
      let end = -1;
      for (let i = start; i < buffer.length; i += 1) {
        const ch = buffer[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = !inString;
        if (inString) continue;
        if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end < 0) return out; // 아직 안 닫혔다 — 다음 조각을 기다린다
      try {
        out.push(
          JSON.parse(buffer.slice(start, end + 1)) as Record<string, unknown>,
        );
      } catch {
        /* 완결처럼 보였으나 깨진 조각 — 버린다 */
      }
      cursor = end + 1;
    }
  };
}

function anthropicProvider(
  apiKey: string,
  model: string,
  baseURL?: string,
  gatewayToken?: string,
): Provider {
  // 워커에서 api.anthropic.com 을 직접 부르면 403 "Request not allowed" 가 난다
  // (같은 키가 로컬에서는 동작 → 키가 아니라 실행 위치 문제). AI Gateway를 거친다.
  const client = new Anthropic({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(gatewayToken
      ? { defaultHeaders: { "cf-aig-authorization": `Bearer ${gatewayToken}` } }
      : {}),
  });
  return {
    name: "anthropic",
    async json(system, user, schema, maxTokens) {
      const message = await client.messages.create({
        model,
        max_tokens: maxTokens,
        thinking: { type: "disabled" },
        output_config: {
          // effort는 모델마다 지원 여부가 다르다. Haiku에 넣으면 400.
          ...(SUPPORTS_EFFORT.test(model)
            ? { effort: "low" as const }
            : {}),
          format: { type: "json_schema", schema },
        },
        system,
        messages: [{ role: "user", content: user }],
      });
      if (message.stop_reason === "refusal") return null;
      const block = message.content.find((b) => b.type === "text");
      return block?.type === "text" ? JSON.parse(block.text) : null;
    },
    async *stream(system, user, schema, maxTokens) {
      const s = client.messages.stream({
        model,
        max_tokens: maxTokens,
        thinking: { type: "disabled" },
        output_config: {
          ...(SUPPORTS_EFFORT.test(model) ? { effort: "low" as const } : {}),
          format: { type: "json_schema", schema },
        },
        system,
        messages: [{ role: "user", content: user }],
      });
      for await (const event of s) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield event.delta.text;
        }
      }
    },
  };
}

function geminiProvider(
  apiKey: string,
  model: string,
  baseURL?: string,
  gatewayToken?: string,
): Provider {
  // Gemini도 워커에서 직접 부르면 지역 차단에 막힌다
  // ("User location is not supported"). 같은 게이트웨이를 경유한다.
  const client = new GoogleGenAI({
    apiKey,
    ...(baseURL || gatewayToken
      ? {
          httpOptions: {
            ...(baseURL ? { baseUrl: baseURL } : {}),
            ...(gatewayToken
              ? { headers: { "cf-aig-authorization": `Bearer ${gatewayToken}` } }
              : {}),
          },
        }
      : {}),
  });
  return {
    name: "gemini",
    async json(system, user, schema, maxTokens) {
      const res = await client.models.generateContent({
        model,
        contents: user,
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          maxOutputTokens: maxTokens,
        },
      });
      return res.text ? JSON.parse(res.text) : null;
    },
    async *stream(system, user, schema, maxTokens) {
      const res = await client.models.generateContentStream({
        model,
        contents: user,
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          maxOutputTokens: maxTokens,
        },
      });
      for await (const chunk of res) {
        if (chunk.text) yield chunk.text;
      }
    },
  };
}

// ── 간이 레이트 리밋 ────────────────────────────────────────────────────────
// 서버리스라 인스턴스마다 초기화된다. 실질적 상한은 각 콘솔의 지출/할당량이며
// 이건 그 앞단의 완충일 뿐이다.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5_000) hits.clear();
  return false;
}

/**
 * 키를 읽는다. Worker에서 시크릿은 요청마다 넘어오는 env 객체에 담기며
 * process.env로 옮겨지는 것이 항상 보장되지는 않는다(실제로 둘 다 빈 배포가 있었다).
 */
async function readKey(name: string): Promise<string | undefined> {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const value = (ctx.env as Record<string, unknown>)[name];
    return typeof value === "string" && value ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  // 기능이 꺼져 있으면 존재하지 않는 것처럼 군다. 503으로 "있지만 안 된다"고
  // 알리면 주소가 노출되고, 켜지길 기다리는 호출이 붙는다.
  if (!CHAT_ENABLED) {
    return new Response("Not Found", { status: 404 });
  }

  const anthropicKey = await readKey("ANTHROPIC_API_KEY");
  const geminiKey = await readKey("GEMINI_API_KEY");
  if (!anthropicKey && !geminiKey) {
    return Response.json(
      { error: "not_configured", build: buildStamp },
      { status: 503 },
    );
  }

  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (rateLimited(ip)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { query?: unknown; history?: unknown };
  try {
    body = (await request.json()) as { query?: unknown; history?: unknown };
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const query = body.query;
  if (typeof query !== "string" || !query.trim()) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  const history = readHistory(body.history);

  // 0) 프리필터 — 조달 질문이 아니면 모델을 부르지 않는다.
  //
  // 후속 질문은 그 자체로는 조달 어휘가 없다("그럼 얼마나 되나요" 같은 것).
  // 이전 질문을 함께 넣어 점수를 매기지 않으면 정상적인 되묻기가 '범위 밖'으로
  // 차단된다. 모델에 넘기는 질문은 원문 그대로다 — 점수 계산에만 쓴다.
  const prefilterText = [...history.map((h) => h.query), trimmed].join(" ");
  const { top, score } = prefilter(prefilterText);

  // 직전에 안내한 제도는 후보에 반드시 넣는다. 후속 질문은 어휘가 짧아
  // 프리필터 점수가 낮게 나오는데, 후보에서 빠지면 모델이 고를 수조차 없다
  // (실측: "그럼 그건 어디에 정해져 있나요"가 부정당업자 제재 → 입찰참가자격
  //  등록으로 샜다). 앞에 두어 순서로도 힌트를 준다.
  const carried = (history[history.length - 1]?.slugs ?? [])
    .map((slug) => ENTRIES.find((e) => e.slug === slug))
    .filter((e): e is RoutingEntry => Boolean(e));
  const candidates = [
    ...carried,
    ...top.filter((e) => !carried.some((c) => c.slug === e.slug)),
  ].slice(0, PREFILTER_KEEP);
  if (score < PREFILTER_FLOOR && carried.length === 0) {
    return Response.json({
      outOfScope: true,
      claims: [],
      candidates: [],
      needsMoreInfo: false,
    });
  }

  const baseURL = await readKey("ANTHROPIC_BASE_URL");
  const geminiBaseURL = await readKey("GEMINI_BASE_URL");
  const gatewayToken = await readKey("CF_AI_GATEWAY_TOKEN");

  // Gemini 무료 티어를 먼저 쓰고, 할당량 소진·오류 시 Claude로 넘어간다.
  const anthropicModel = (await readKey("CHAT_MODEL")) ?? DEFAULT_ANTHROPIC_MODEL;
  const geminiModel = (await readKey("GEMINI_MODEL")) ?? DEFAULT_GEMINI_MODEL;

  // 무료이면서 빠른 Gemini를 먼저 쓰고, 막히면 Haiku로 넘어간다. 실측:
  //   gemini-3.1-flash-lite  3.1초  1순위 89%  근거 97.1%  무료
  //   claude-haiku-4-5      12.5초  1순위 93%  근거 80.2%  51.4원
  //
  // NVIDIA(Nemotron 3 Ultra)는 뺐다. 정확도는 준수했으나(1순위 87%) 27.5초로
  // 사용자가 기다릴 수 있는 수준이 아니었고, 무료라는 이점은 Gemini가 더 빠르게
  // 제공한다. 되살리려면 커밋 08fdedc 참조.
  const chain: Provider[] = [];
  if (geminiKey)
    chain.push(geminiProvider(geminiKey, geminiModel, geminiBaseURL, gatewayToken));
  if (anthropicKey)
    chain.push(
      anthropicProvider(anthropicKey, anthropicModel, baseURL, gatewayToken),
    );

  let lastError: string | undefined;
  // 어느 제공자가 왜 밀렸는지 남긴다. 폴백이 조용히 돌면 무료 티어가 안 쓰이는
  // 것을 눈치채지 못한 채 유료 호출만 나간다(실제로 그런 상태가 있었다).
  const providerErrors: Record<string, string> = {};

  for (const provider of chain) {
    try {
      // 1) 제도 선택
      const picked = await provider.json(
        `공공조달 제도 목록에서 사용자 상황에 해당하는 제도를 최대 ${MAX_CANDIDATES}개, 관련성이 높은 순서로 고르십시오. 설명은 하지 마십시오.${historyBlock(
          history,
        )}\n\n${candidates.map(entryText).join("\n---\n")}`,
        trimmed,
        stage1Schema(candidates.map((e) => e.slug)),
        256,
      );
      const slugs = (
        Array.isArray((picked as { candidates?: unknown })?.candidates)
          ? (picked as { candidates: unknown[] }).candidates
          : []
      )
        .filter((s): s is string => typeof s === "string")
        .filter((s) => NAME_BY_SLUG.has(s))
        .slice(0, MAX_CANDIDATES);

      if (slugs.length === 0) {
        return Response.json({
          outOfScope: true,
          claims: [],
          candidates: [],
          needsMoreInfo: false,
          provider: provider.name,
        });
      }

      // 2) 근거 답변 — 고른 제도의 검증 조문만 준다.
      const files = await Promise.all(slugs.map((s) => loadArticles(s, request)));
      const allArticles = files.flatMap((f) => f.articles ?? []);
      // 질의와 가까운 '항'을 고른다. 조가 아니라 항 단위인 이유는 위 MAX_ARTICLES
      // 주석 참고. 점수는 Dice(2·겹침/(질의+단위))라 긴 단위가 유리하지 않다.
      const queryGrams = bigrams(trimmed);
      const units = allArticles.flatMap((a) =>
        (a.clauses?.length ? a.clauses : [{ label: "", text: a.text }]).map(
          (c) => {
            const g = bigrams(`${a.title}${c.text}`);
            let shared = 0;
            for (const x of queryGrams) if (g.has(x)) shared += 1;
            return {
              article: a,
              clause: c,
              score: (2 * shared) / (queryGrams.size + g.size || 1),
            };
          },
        ),
      );
      // 별표도 같은 저울에 올린다. 제재기간·적격심사 배점처럼 실무에서 제일 자주
      // 묻는 수치가 조문이 아니라 별표에 있다 — 조문만 검색하면 "공사수행능력
      // 신인도평가"처럼 제도는 맞히고 답은 못 하는 일이 생긴다.
      const annexTexts = await loadAnnexTexts(request);
      const annexHits = matchAnnexes(trimmed, annexTexts);
      for (const { annex: hit, key } of annexHits) {
        const body = annexTexts[key]?.text;
        if (!body) continue;
        // 표가 길어 통째로 실으면 다른 근거를 밀어낸다. 문단 단위로 쪼개 경쟁시킨다.
        for (const part of body.split(/\n{2,}/)) {
          const text = part.trim();
          if (text.length < 20) continue;
          const g = bigrams(`${hit.title}${text}`);
          let shared = 0;
          for (const x of queryGrams) if (g.has(x)) shared += 1;
          units.push({
            article: {
              key,
              law: hit.law,
              article: hit.annex,
              title: hit.title,
              text: body,
              url: hit.url,
              kind: "별표",
            },
            clause: { label: "", text },
            score: (2 * shared) / (queryGrams.size + g.size || 1),
          });
        }
      }

      const picked2 = units
        .sort((x, y) => y.score - x.score)
        .slice(0, MAX_ARTICLES);
      // 인용구 대조는 조 전체 본문에 대해 한다 — 인용이 항 경계를 걸칠 수 있다.
      const articles = [...new Set(picked2.map((u) => u.article))];
      // 여러 제도를 묶으면 기준일이 다를 수 있다. 가장 오래된 것을 밝힌다 —
      // "언제까지 확인된 조문인가"는 가장 보수적인 값이어야 한다.
      const asOfDate = files
        .map((f) => f.asOfDate)
        .filter((d): d is string => Boolean(d))
        .sort()[0];
      if (articles.length === 0) {
        // 조문을 못 읽었으면 근거 없이 답하지 않는다.
        return Response.json(
          { error: "articles_unavailable", build: buildStamp },
          { status: 503 },
        );
      }

      const corpus = articles
        .map((a) => `[${a.key}] ${a.title}\n${a.text}`)
        .join("\n\n");
      // 별표 본문은 우리가 갖고 있지 않다. 언급되면 내용을 지어내지 말라고 못을 박는다.
      const mentionsAnnex = /별표\s*\d/.test(corpus);
      // claim이 하나 닫힐 때마다 대조하고, 통과한 것만 흘려보낸다.
      // NDJSON — 한 줄에 객체 하나. SSE보다 파싱이 단순하고 프록시 영향이 적다.
      const encoder = new TextEncoder();
      const byKey = new Map(articles.map((a) => [a.key, a]));
      const stream = new ReadableStream({
        async start(controller) {
          const send = (obj: unknown) =>
            controller.enqueue(encoder.encode(`${JSON.stringify(obj)}
`));

          // 제도 카드는 먼저 보낸다 — 본문을 기다리는 동안 볼 것이 생긴다.
          send({
            type: "meta",
            candidates: slugs,
            asOfDate,
            provider: provider.name,
            model: provider.name === "gemini" ? geminiModel : anthropicModel,
          });

          const read = makeClaimReader();
          let dropped = 0;
          let sent = 0;
          try {
            for await (const chunk of provider.stream(
              `${STAGE2_RULES}${mentionsAnnex ? ANNEX_WARNING : ""}${historyBlock(history)}${annexNote(corpus, articles)}

조문 원문:

${corpus}`,
              trimmed,
              stage2Schema([...new Set(picked2.map((u) => u.article.key))]),
              2048,
            )) {
              for (const raw of read(chunk)) {
                const { kept, dropped: bad } = verifyClaims([raw], articles, byKey);
                dropped += bad.length;
                for (const claim of kept) {
                  send({ type: "claim", claim });
                  sent += 1;
                }
              }
            }
          } catch (error) {
            send({
              type: "error",
              detail: (error instanceof Error ? error.message : String(error)).slice(0, 200),
            });
          }
          // 근거 있는 문장을 하나도 못 만들었으면, 답이 어디에 있는지라도 알린다.
          // 별표 본문이 없어서 생기는 공백이 대부분이다.
          const annexHints =
            sent === 0 ? annexHits.map((x) => x.annex) : [];
          send({ type: "done", droppedCount: dropped, annexes: annexHints });
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
          // 중간 프록시가 모아서 한 번에 보내면 스트리밍이 무의미해진다.
          "X-Accel-Buffering": "no",
        },
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      // 잘라내면 정작 필요한 부분이 사라진다. Gemini의 429는 "Quota exceeded for
      // metric ..." 뒤에 어느 한도인지가 나오는데, 300자에서 끊겨 분당인지
      // 일일인지 구분을 못 했다.
      providerErrors[provider.name] = lastError.slice(0, 1200);
      // 다음 제공자로 넘어간다.
    }
  }

  return Response.json(
    {
      error: "upstream_failed",
      detail: lastError?.slice(0, 300),
      build: buildStamp,
    },
    { status: 502 },
  );
}
