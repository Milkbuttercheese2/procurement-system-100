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

// 모델명은 요청 시점에 읽는다. Worker에서 환경값은 요청마다 넘어오는 env 객체에
// 담기므로, 모듈 로드 시 process.env를 읽으면 기본값으로 굳어버린다(시크릿에서
// 같은 문제를 이미 겪었다).
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";
// gemini-3.5-flash 는 무료 티어 할당량이 사실상 없다 — 맨몸 호출에서도 항상
// 429(RESOURCE_EXHAUSTED)가 났고, 같은 키로 flash-lite 는 200이 떨어졌다.
// 게이트웨이·키 문제가 아니라 모델 선택 문제였다.
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
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
  /** 법률 / 대통령령 / 부령 / 행정규칙 — "제26조"만으로는 구분이 안 된다. */
  kind?: string;
  effectiveOn?: string;
  promulgatedOn?: string;
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

// 조문이 "별표 N"을 가리키는데 우리는 별표 본문을 갖고 있지 않다(884건 중 14건).
// 별표에는 제재기간·적격심사 배점 같은 핵심 기준이 들어 있어, 그대로 두면 모델이
// 조문은 정확히 인용하면서 별표 내용을 지어낼 여지가 있다. 인용구 대조로는
// 못 막는 유형이라 따로 못을 박는다.
const ANNEX_WARNING = `
주의: 아래 원문에 "별표 N"이 언급되더라도 그 별표의 내용은 제공되지 않았습니다.
별표에 정해진 구체적 기준·금액·기간·배점을 쓰지 마십시오. "그 기준은 해당 별표에
정해져 있으니 조문 링크에서 확인하라"는 취지로만 안내하십시오.`;

// ── 대조 ───────────────────────────────────────────────────────────────────

const flatten = (s: string) => s.replace(/\s+/g, "");

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
  };
}

/**
 * 프로즈에 섞여 온 JSON을 건져낸다.
 *
 * NVIDIA는 response_format json_schema 를 문서상 보장하지 않고, 실제로 추론
 * 텍스트("The user is asking…")를 그대로 뱉는 경우가 있었다. 코드펜스와 앞뒤
 * 설명을 걷어내고 첫 JSON 객체를 꺼낸다. 그래도 enum 보장이 없으므로 최종
 * 안전장치는 slug 필터와 verifyClaims 쪽이다.
 */
function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  try {
    return JSON.parse(body.trim());
  } catch {
    /* 아래에서 중괄호 범위를 직접 찾는다 */
  }
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(body.slice(start, end + 1));
  }
  throw new Error(`JSON을 찾지 못함: ${raw.slice(0, 120)}`);
}

/**
 * NVIDIA NIM (build.nvidia.com). OpenAI 호환이라 SDK 없이 fetch로 붙인다 —
 * 워커 번들이 이미 3 MiB 상한에 가까워 의존성을 늘리지 않는 편이 안전하다.
 *
 * 실측에서 세 가지가 걸렸고 각각 대응한다:
 *  - 추론 텍스트를 그대로 뱉음 → chat_template_kwargs.enable_thinking=false
 *  - 응답이 중간에 끊김("Unterminated string") → 추론을 끈 뒤 max_tokens 여유
 *  - 503 ResourceExhausted (32/32) → 무료 공용 용량 포화. 우리가 할 수 있는 건
 *    폴백뿐이라 체인 다음 제공자로 넘어간다.
 *
 * strict: true 는 넣되 믿지 않는다. 문서에 보장이 없고 지켜지지 않는 것을 봤다.
 * enum이 새더라도 slug 필터와 verifyClaims에서 걸러진다.
 */
function nvidiaProvider(apiKey: string, model: string): Provider {
  return {
    name: "nvidia",
    async json(system, user, schema, maxTokens) {
      const body = JSON.stringify({
          model,
          // 추론을 껐어도 서식 여유는 준다. 끊긴 JSON은 통째로 버려지므로
          // 토큰을 아끼려다 응답 전체를 잃는 편이 손해가 크다.
          max_tokens: maxTokens * 2,
          temperature: 0,
          // 추론 모델이라 기본값이면 사고 과정을 본문에 그대로 쓴다.
          chat_template_kwargs: {
            enable_thinking: false,
            force_nonempty_content: true,
          },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "result", schema, strict: true },
          },
      });

      // 503 ResourceExhausted(32/32)는 공용 용량이 순간적으로 찬 것이고 금방
      // 풀린다 — 실측에서 연속 5회 모두 1~9초에 성공했다. 한 번 막혔다고 유료
      // 제공자로 넘기면 공짜로 될 일에 돈을 낸다. 짧게 두 번 더 시도한다.
      let res: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body,
        });
        if (res.status !== 503) break;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
      if (!res || !res.ok) {
        const detail = res ? await res.text() : "no response";
        throw new Error(`nvidia ${res?.status} ${detail.slice(0, 600)}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      return content ? extractJson(content) : null;
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
  const nvidiaKey = await readKey("NVIDIA_API_KEY");
  if (!anthropicKey && !geminiKey && !nvidiaKey) {
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
  const anthropicModel = (await readKey("CHAT_MODEL")) ?? DEFAULT_ANTHROPIC_MODEL;
  const geminiModel = (await readKey("GEMINI_MODEL")) ?? DEFAULT_GEMINI_MODEL;
  const nvidiaModel = (await readKey("NVIDIA_MODEL")) ?? DEFAULT_NVIDIA_MODEL;

  // 무료인 것부터 쓰고, 막히면 유료로 내려간다.
  const chain: Provider[] = [];
  if (nvidiaKey) chain.push(nvidiaProvider(nvidiaKey, nvidiaModel));
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
      const files = await Promise.all(slugs.map((s) => loadArticles(s, request)));
      const articles = files.flatMap((f) => f.articles ?? []);
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
        // 조문 스냅샷 기준일. 법령정보 MCP가 모든 응답에 조회기준일을 달고
        // "연혁일 수 있으니 현행을 재확인하라"고 경고하는 것과 같은 취지다.
        // 밝히지 않으면 개정된 뒤에도 현행처럼 읽힌다.
        asOfDate,
        provider: provider.name,
        model:
          provider.name === "nvidia"
            ? nvidiaModel
            : provider.name === "gemini"
              ? geminiModel
              : anthropicModel,
        ...(Object.keys(providerErrors).length
          ? { fellBackFrom: providerErrors }
          : {}),
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
