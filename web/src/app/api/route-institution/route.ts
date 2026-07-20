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

const MAX_QUERY_LENGTH = 500;
const MAX_CANDIDATES = 3;
const PREFILTER_KEEP = 15;
// 프리필터 점수 하한. 이보다 낮으면 조달 질문으로 보지 않고 모델을 부르지 않는다.
//
// scripts/calibrate-prefilter.mjs 실측(조달 10건 / 무관 8건):
//   조달 질문 최저 0.154, 무관 질문 최고 0.250("이혼 소송 절차" — 법률 어휘가 겹친다)
//   0.12 → 조달 10/10 통과, 무관 5/8 차단
//   0.15 → 조달 10/10 통과, 무관 7/8 차단  (다만 최저 조달 질문과 0.004 차이)
//
// 0.15가 더 많이 거르지만 여유가 없다. 진짜 조달 질문을 되돌려보내는 쪽이 헛호출
// 한 번보다 나쁘므로 0.12로 둔다. 남는 것은 1단계에서 후보 0개로 걸러진다.
const PREFILTER_FLOOR = 0.12;
// 너무 짧은 인용구는 아무 데나 걸린다("계약", "제1항"). 대조의 의미가 생기는 하한.
const MIN_QUOTE_LENGTH = 12;

const ANTHROPIC_MODEL = process.env.CHAT_MODEL ?? "claude-sonnet-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
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

interface ArticleAsset {
  key: string;
  law: string;
  article: string;
  title: string;
  text: string;
  url?: string;
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

async function loadArticles(
  slug: string,
  request: Request,
): Promise<ArticleAsset[]> {
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
      if (res.ok) return (await res.json()) as ArticleAsset[];
    }
  } catch {
    // 로컬 next dev 등 Cloudflare 컨텍스트가 없는 환경 → 아래로 폴백.
  }
  try {
    const res = await fetch(new URL(`/articles/${slug}.json`, request.url));
    if (res.ok) return (await res.json()) as ArticleAsset[];
  } catch {
    /* 자산을 못 읽으면 근거 없이 답하지 않고 빈 배열을 돌려준다 */
  }
  return [];
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

const STAGE2_RULES = `아래 조문 원문에 **실제로 적힌 내용만** 근거로 답하십시오.

각 문장(claim)은 셋을 함께 냅니다:
- text: 사용자에게 보일 한 문장. 담당자가 읽고 이해할 수 있는 말로 씁니다.
- quote: 그 문장의 근거가 되는 구절을 **조문 원문에서 글자 그대로** 복사합니다.
  요약하거나 다듬지 마십시오. 원문과 한 글자라도 다르면 그 문장은 버려집니다.
- article: 그 구절이 있는 조문 키. 목록에 있는 것만 씁니다.

반드시 지킬 것:
- 원문에 없는 수치·기한·요건·절차를 쓰지 마십시오. 기억에 있는 조문을 끌어오지 마십시오.
- 원문으로 뒷받침되지 않는 말은 아예 하지 마십시오(claim에서 빼십시오).
- 4~6개 claim으로, 사용자의 상황에 답하는 순서로 배열하십시오.
- 상황이 모호해 좁힐 수 없으면 needsMoreInfo를 true로 두십시오.`;

// ── 대조 ───────────────────────────────────────────────────────────────────

const flatten = (s: string) => s.replace(/\s+/g, "");

interface VerifiedClaim {
  text: string;
  article: string;
  law: string;
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
) {
  const byKey = new Map(articles.map((a) => [a.key, a]));
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
      law: article.law,
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
}

function anthropicProvider(
  apiKey: string,
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
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        thinking: { type: "disabled" },
        output_config: {
          // effort는 모델마다 지원 여부가 다르다. Haiku에 넣으면 400.
          ...(SUPPORTS_EFFORT.test(ANTHROPIC_MODEL)
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
  };
}

function geminiProvider(
  apiKey: string,
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
        model: GEMINI_MODEL,
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

  let query: unknown;
  try {
    ({ query } = (await request.json()) as { query?: unknown });
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (typeof query !== "string" || !query.trim()) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);

  // 0) 프리필터 — 조달 질문이 아니면 모델을 부르지 않는다.
  const { top, score } = prefilter(trimmed);
  if (score < PREFILTER_FLOOR || top.length === 0) {
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
  const chain: Provider[] = [];
  if (geminiKey) chain.push(geminiProvider(geminiKey, geminiBaseURL, gatewayToken));
  if (anthropicKey)
    chain.push(anthropicProvider(anthropicKey, baseURL, gatewayToken));

  let lastError: string | undefined;

  for (const provider of chain) {
    try {
      // 1) 제도 선택
      const picked = await provider.json(
        `공공조달 제도 목록에서 사용자 상황에 해당하는 제도를 최대 ${MAX_CANDIDATES}개, 관련성이 높은 순서로 고르십시오. 설명은 하지 마십시오.\n\n${top
          .map(entryText)
          .join("\n---\n")}`,
        trimmed,
        stage1Schema(top.map((e) => e.slug)),
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
      const articles = (
        await Promise.all(slugs.map((s) => loadArticles(s, request)))
      ).flat();
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
      const answered = await provider.json(
        `${STAGE2_RULES}\n\n조문 원문:\n\n${corpus}`,
        trimmed,
        stage2Schema(articles.map((a) => a.key)),
        2048,
      );

      const rawClaims = Array.isArray(
        (answered as { claims?: unknown })?.claims,
      )
        ? ((answered as { claims: Array<Record<string, unknown>> }).claims)
        : [];

      // 3) 대조 — 인용구가 원문에 없는 문장은 버린다.
      const { kept, dropped } = verifyClaims(rawClaims, articles);

      return Response.json({
        claims: kept,
        candidates: slugs,
        needsMoreInfo: (answered as { needsMoreInfo?: unknown })?.needsMoreInfo === true,
        // 몇 개를 걸렀는지 알려준다. 화면에는 "일부 문장은 근거 대조에 실패해
        // 제외했다"고만 표시하고, 버려진 문장 자체는 내보내지 않는다.
        droppedCount: dropped.length,
        provider: provider.name,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
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
