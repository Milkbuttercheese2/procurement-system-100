// 상황 설명 → 메타데이터 기반 설명 + 제도 slug 안내.
//
// 모델은 인덱스에 실린 메타데이터(요약·적용대상·분류·제도 간 연결)만을 근거로 상황을
// 정리해 answer를 쓰고, 해당 제도 slug를 고른다. slug는 enum으로 강제되므로 없는
// 제도를 지어낼 수 없고, 화면의 제도 카드는 여전히 로컬 검증 데이터로 렌더링한다.
//
// 경계: 조문 해석·요건 충족 여부·금액과 기한 기준은 모델이 판단하지 않는다(프롬프트에서
// 금지). 그건 사용자가 제도 페이지의 조문 원문을 보고 판단할 몫이며, 이 사이트의 신뢰는
// "검증된 조문만 보여준다"는 데서 나온다. answer는 검증된 조문의 대체물이 아니라
// 그리로 가는 길잡이다 — 사이드바 하단 면책 문구도 같은 취지다.
//
// provider는 환경변수로 정해진다. ANTHROPIC_API_KEY가 있으면 Claude, 없고
// GEMINI_API_KEY가 있으면 Gemini. 둘 다 없으면 503을 돌려주고 사이드바가 안내만 한다.
// 결제 문제로 Gemini 무료 티어를 먼저 쓰다가, 나중에 Anthropic 키만 넣으면 전환된다.
//
// 주의: Gemini 무료 티어는 약관상 입력·출력이 모델 개선에 쓰일 수 있다. 민감한 조달
// 건 정보를 넣는 운영 환경에서는 유료 티어나 Claude로 올려야 한다.

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
// lib/data를 쓰면 제도 JSON 전체(4.4MB, 조문 원문 884건 포함)가 서버 번들에 들어가
// Cloudflare Worker 상한(무료 3 MiB)을 넘는다. 라우팅에 필요한 필드만 담은 슬림
// 인덱스(45KB)를 prebuild 단계에서 만들어 쓴다. → scripts/generate-routing-index.mjs
import routingIndex from "../../../../data/routing-index.json";
// 배포된 워커가 어느 커밋인지 응답으로 확인하기 위한 스탬프.
import buildStamp from "../../../../data/build-stamp.json";

const MAX_QUERY_LENGTH = 500;
const MAX_CANDIDATES = 3;

// 라우팅 품질을 우선해 Sonnet 5를 쓴다. Haiku보다 단가가 약 3배이므로
// 월 지출 한도(Console에서 설정)를 반드시 함께 걸어둘 것.
// 비용을 낮추려면 CHAT_MODEL 환경변수로 claude-haiku-4-5 로 내릴 수 있다.
const ANTHROPIC_MODEL = process.env.CHAT_MODEL ?? "claude-sonnet-5";
// gemini-3-flash 는 존재하지 않는 ID였다(404 NOT_FOUND). 현재 GA는 3.5/3.1 계열이며
// 2.0 계열은 2026-06-01 종료됐다. 더 싸게 가려면 gemini-3.1-flash-lite.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

interface RoutingEntry {
  slug: string;
  name: string;
  category: string;
  oneLiner: string;
  applicability: string;
  related: string[];
}

const ENTRIES = routingIndex as RoutingEntry[];
const SLUGS = ENTRIES.map((entry) => entry.slug);
const NAME_BY_SLUG = new Map(ENTRIES.map((entry) => [entry.slug, entry.name]));

const INDEX_TEXT = ENTRIES.map((entry) =>
  [
    `slug: ${entry.slug}`,
    `이름: ${entry.name}`,
    `분류: ${entry.category}`,
    `요약: ${entry.oneLiner}`,
    entry.applicability ? `적용대상: ${entry.applicability}` : "",
    // 제도 간 연결. 하나를 짚은 뒤 "그럼 그다음은?"을 이어가려면 이 관계가 필요하다.
    entry.related.length > 0
      ? `연결된 제도: ${entry.related
          .map((slug) => `${NAME_BY_SLUG.get(slug)}(${slug})`)
          .join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n"),
).join("\n\n---\n\n");

const SYSTEM_PROMPT = `당신은 대한민국 공공조달 제도 안내 사이트의 안내자입니다.

사용자는 조달 업무를 맡게 된 공공기관 담당자나 조달업체 담당자이며, 대개 제도 이름을
모릅니다. 아래 제도 목록의 메타데이터(요약·적용대상·분류·제도 간 연결)만을 근거로
상황을 해석하고, 어떻게 정리되는 사안인지 설명한 뒤 해당 제도로 안내하십시오.

answer 작성 방법 — 다음 순서로 생각해서 3~5문장으로 쓰십시오:
1. 사용자의 상황이 조달 절차의 어느 단계인지 짚습니다(계약 전인지, 이행 중인지, 분쟁인지).
2. 그 단계에서 어떤 제도가 왜 적용되는지, 목록의 요약·적용대상에 비추어 설명합니다.
3. '연결된 제도'를 활용해 앞뒤로 뭐가 따라오는지 짚어줍니다
   (예: 지체상금이 문제라면 그다음에 계약 해제·해지나 제재로 이어질 수 있음).
4. 확정적으로 말할 수 없는 부분은 제도 페이지의 조문 원문에서 확인하라고 넘깁니다.

절대 하지 말 것:
- 법령 해석. "가능하다/불가능하다", "며칠 안에 해야 한다", "얼마까지 수의계약이 된다" 같은
  단정을 하지 마십시오. 요건 충족 여부와 금액·기한 기준은 사용자가 조문 원문을 보고
  판단합니다. 목록에 없는 수치나 기한을 기억에서 꺼내 쓰지 마십시오.
- 목록에 없는 제도·법령·조문을 지어내는 것. slug는 반드시 목록의 것만 씁니다.
- 목록의 메타데이터로 뒷받침되지 않는 주장. 근거가 없으면 "이 사이트의 자료만으로는
  판단하기 어렵다"고 쓰십시오.

그 밖에:
- candidates에는 가장 관련 있는 제도를 최대 ${MAX_CANDIDATES}개, 관련성이 높은 순서로 넣습니다.
- 상황이 모호해 좁힐 수 없으면 needsMoreInfo를 true로 두고, 무엇을 더 알려주면 좁혀지는지
  answer 끝에 한 문장으로 물으십시오.
- 조달과 무관한 질문이면 candidates를 비우고, 이 사이트가 다루는 범위가 아니라고 답하십시오.

제도 목록:

${INDEX_TEXT}`;

// enum으로 막아두면 모델이 없는 제도를 지어낼 수 없다.
//
// maxItems는 넣지 않는다. Anthropic 구조화 출력이 배열에 대해 이 제약을 지원하지
// 않아 400을 돌려준다("For 'array' type, property 'maxItems' is not supported").
// 개수 제한은 프롬프트로 지시하고 normalize()에서 slice로 강제한다.
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: { type: "string", enum: SLUGS },
    },
    answer: { type: "string" },
    needsMoreInfo: { type: "boolean" },
  },
  required: ["answer", "candidates", "needsMoreInfo"],
  additionalProperties: false,
};

// IP당 간이 제한. 서버리스에서는 인스턴스마다 초기화되므로 완전한 방어가 아니다.
// 실질적인 상한은 각 제공자 콘솔의 지출/할당량 한도이며, 이건 그 앞단의 완충일 뿐이다.
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
  if (hits.size > 5_000) hits.clear(); // 메모리 무한 증가 방지
  return false;
}

/** 모델이 돌려준 JSON 문자열 → 검증된 응답. 실패하면 null. */
function normalize(raw: string | undefined) {
  if (!raw) return null;
  let parsed: { candidates?: unknown; answer?: unknown; needsMoreInfo?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // 스키마가 강제하지만 한 번 더 거른다 — 화면에 없는 제도가 뜨는 것보다 낫다.
  const candidates = Array.isArray(parsed.candidates)
    ? parsed.candidates
        .filter((slug): slug is string => typeof slug === "string")
        .filter((slug) => SLUGS.includes(slug))
        .slice(0, MAX_CANDIDATES)
    : [];
  return {
    candidates,
    answer: typeof parsed.answer === "string" ? parsed.answer : "",
    needsMoreInfo: parsed.needsMoreInfo === true,
  };
}

async function routeWithAnthropic(
  apiKey: string,
  query: string,
  baseURL?: string,
  gatewayToken?: string,
) {
  // baseURL이 있으면 Cloudflare AI Gateway를 경유한다.
  //
  // 워커에서 api.anthropic.com 을 직접 부르면 403 "Request not allowed" 가 난다.
  // 같은 키·같은 코드가 로컬(한국)에서는 정상 동작하므로 키 문제가 아니라 워커가
  // 실행되는 위치/IP를 Anthropic이 거부하는 것이다. 게이트웨이를 거치면 출발지가
  // Cloudflare 게이트웨이 인프라가 되어 우회될 수 있다.
  // 게이트웨이가 Authenticated 모드면 자체 토큰을 cf-aig-authorization 헤더로
  // 요구한다(없으면 401 Unauthorized). Anthropic 키와는 별개의 값이다.
  const client = new Anthropic({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(gatewayToken
      ? { defaultHeaders: { "cf-aig-authorization": `Bearer ${gatewayToken}` } }
      : {}),
  });
  const message = await client.messages.create({
    model: ANTHROPIC_MODEL,
    // slug 몇 개 + 3~5문장 설명. 512로는 설명이 중간에 잘린다.
    max_tokens: 1024,
    // Sonnet 5는 thinking을 생략하면 adaptive로 돈다. 이 작업은 인덱스를 보고
    // 66개 중 고르는 분류라 추론 단계가 필요 없고, 켜두면 토큰과 지연만 늘어난다.
    thinking: { type: "disabled" },
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: query }],
  });
  if (message.stop_reason === "refusal") return { candidates: [], answer: "", needsMoreInfo: false };
  const block = message.content.find((b) => b.type === "text");
  return normalize(block?.type === "text" ? block.text : undefined);
}

async function routeWithGemini(
  apiKey: string,
  query: string,
  baseURL?: string,
  gatewayToken?: string,
) {
  // Anthropic과 마찬가지로 워커에서 직접 부르면 지역 차단에 막힌다
  // ("User location is not supported"). AI Gateway를 거치면 우회된다.
  // GEMINI_BASE_URL 예: https://gateway.ai.cloudflare.com/v1/<acct>/<gw>/google-ai-studio
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
  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: query,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseJsonSchema: OUTPUT_SCHEMA,
      maxOutputTokens: 1024,
    },
  });
  return normalize(response.text);
}

/**
 * 모델명이 틀렸을 때 실제로 쓸 수 있는 모델 이름을 돌려준다.
 * 모델 ID는 계정·시점에 따라 달라서 추측하면 계속 헛돈다. 키는 서버에만 있으므로
 * 조회도 서버에서 한다(이름만 반환, 값·키는 노출 없음).
 */
async function listGeminiModels(apiKey: string): Promise<string[]> {
  try {
    const client = new GoogleGenAI({ apiKey });
    const pager = await client.models.list();
    const names: string[] = [];
    for await (const model of pager) {
      const name = (model as { name?: string }).name;
      if (name) names.push(name);
      if (names.length >= 40) break;
    }
    return names;
  } catch (error) {
    return [`(목록 조회 실패: ${error instanceof Error ? error.message : String(error)})`.slice(0, 200)];
  }
}

/**
 * 키를 읽는다.
 *
 * Cloudflare Worker에서 시크릿은 process.env가 아니라 요청마다 넘어오는 env 객체에
 * 담긴다. @opennextjs/cloudflare가 process.env로 옮겨주긴 하지만 항상 보장되지는
 * 않아, 실제 배포에서 둘 다 비어 보이는 일이 있었다(503 not_configured).
 * 그래서 process.env → getCloudflareContext().env 순으로 확인한다.
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
    // 로컬 next dev 등 Cloudflare 컨텍스트가 없는 환경.
    return undefined;
  }
}

/**
 * 진단용. 어떤 변수 '이름'이 워커에 보이는지만 돌려준다. 값은 절대 내보내지 않는다.
 * 키를 넣었는데 503이 날 때, 이름 오타인지 다른 worker에 넣은 것인지 구분하려는 것.
 */
async function listEnvKeys(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  const procKeys = Object.keys(process.env ?? {});
  out.processEnvCount = procKeys.length;
  // 값은 절대 담지 않는다. 이름만, 그것도 우리가 찾는 것 위주로.
  out.processEnvMatches = procKeys.filter((k) => /API|KEY|GEMINI|ANTHROPIC/i.test(k));

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    // 바인딩 '이름'은 비밀이 아니다(ASSETS, IMAGES 등 구조적인 것들).
    // 여기에 ASSETS 같은 게 보이는데 GEMINI_API_KEY만 없다면 → 시크릿 미등록.
    // 아무것도 안 보이면 → env 객체 자체가 안 넘어오는 것(어댑터/런타임 문제).
    out.cfBindings = Object.keys(ctx.env ?? {});
  } catch (error) {
    out.cfContextError = error instanceof Error ? error.message : String(error);
  }

  return out;
}

export async function POST(request: Request) {
  const anthropicKey = await readKey("ANTHROPIC_API_KEY");
  const geminiKey = await readKey("GEMINI_API_KEY");
  if (!anthropicKey && !geminiKey) {
    // 키가 없는 배포에서도 화면이 깨지지 않도록 조용히 503.
    // 어느 쪽도 못 읽었는지 구분할 수 있게 진단 정보를 함께 준다(값은 노출 안 함).
    const seen = await listEnvKeys();
    return Response.json(
      { error: "not_configured", build: buildStamp, seen },
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
  // 긴 입력으로 토큰을 태우는 걸 막는다.
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);

  try {
    // 둘 다 있으면 Anthropic을 쓴다(최종 목표 provider).
    const baseURL = await readKey("ANTHROPIC_BASE_URL");
    const geminiBaseURL = await readKey("GEMINI_BASE_URL");
    const gatewayToken = await readKey("CF_AI_GATEWAY_TOKEN");

    // Gemini 무료 티어를 먼저 쓰고, 할당량 소진·오류 시 Claude로 넘어간다.
    // Gemini만 있으면 Gemini만, Claude만 있으면 Claude만 쓴다.
    let result = null;
    let usedProvider: string | undefined;
    let geminiError: string | undefined;

    if (geminiKey) {
      try {
        result = await routeWithGemini(geminiKey, trimmed, geminiBaseURL, gatewayToken);
        usedProvider = "gemini";
      } catch (error) {
        // 429(할당량)든 다른 오류든 폴백한다. 사용자 입장에서는 답이 나오는 게 중요하다.
        geminiError = error instanceof Error ? error.message : String(error);
        result = null;
      }
    }

    if (!result && anthropicKey) {
      result = await routeWithAnthropic(anthropicKey, trimmed, baseURL, gatewayToken);
      usedProvider = "anthropic";
    }

    if (!result) {
      return Response.json(
        { error: "empty_response", geminiError: geminiError?.slice(0, 200) },
        { status: 502 },
      );
    }
    // 어느 provider가 응답했는지 알 수 있게 싣는다. 폴백이 언제 도는지 파악용.
    return Response.json({ ...result, provider: usedProvider });
  } catch (error) {
    // 어느 provider가 왜 실패했는지 응답으로 알 수 있게 한다. 모델명 오류·권한·
    // 스키마 거부 등을 구분하려면 메시지가 필요하다. 키는 메시지에 실리지 않는다.
    const detail = error instanceof Error ? error.message : String(error);
    // 모델을 못 찾은 경우에는 쓸 수 있는 모델 목록을 함께 돌려준다.
    const modelMissing = /not found|NOT_FOUND|404/i.test(detail);
    const availableModels =
      modelMissing && !anthropicKey && geminiKey
        ? await listGeminiModels(geminiKey)
        : undefined;
    return Response.json(
      {
        error: "upstream_failed",
        provider: anthropicKey ? "anthropic" : "gemini",
        model: anthropicKey ? ANTHROPIC_MODEL : GEMINI_MODEL,
        detail: detail.slice(0, 400),
        // 게이트웨이 설정이 워커에 실제로 도달했는지. 값은 노출하지 않고
        // 존재 여부와 형태만 싣는다.
        viaGateway: Boolean(await readKey("ANTHROPIC_BASE_URL")),
        gatewayUrlShape: (await readKey("ANTHROPIC_BASE_URL"))
          ?.replace(/\/v1\/[^/]+\//, "/v1/<account>/")
          ?.slice(0, 120),
        hasGatewayToken: Boolean(await readKey("CF_AI_GATEWAY_TOKEN")),
        availableModels,
        build: buildStamp,
      },
      { status: 502 },
    );
  }
}
