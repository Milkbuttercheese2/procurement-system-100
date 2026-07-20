// 상황 설명 → 제도 slug 라우팅.
//
// 이 엔드포인트는 답을 생성하지 않는다. 모델은 66개 제도 중 어느 것으로 보낼지만
// 고르고(구조화 출력 + enum으로 slug를 강제), 화면에 뜨는 제도 정보는 클라이언트가
// 로컬 검증 데이터에서 렌더링한다. 모델이 쓴 문장이 답이 되면 법령 해석을 하는 셈이라
// README의 면책 범위를 벗어난다.
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

// 비용 전제가 저가 모델 기준이라 환경변수로만 바꾸도록 둔다.
const ANTHROPIC_MODEL = process.env.CHAT_MODEL ?? "claude-haiku-4-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash";

interface RoutingEntry {
  slug: string;
  name: string;
  category: string;
  oneLiner: string;
  applicability: string;
}

const ENTRIES = routingIndex as RoutingEntry[];
const SLUGS = ENTRIES.map((entry) => entry.slug);

const INDEX_TEXT = ENTRIES.map((entry) =>
  [
    `slug: ${entry.slug}`,
    `이름: ${entry.name}`,
    `분류: ${entry.category}`,
    `요약: ${entry.oneLiner}`,
    entry.applicability ? `적용대상: ${entry.applicability}` : "",
  ]
    .filter(Boolean)
    .join("\n"),
).join("\n\n---\n\n");

const SYSTEM_PROMPT = `당신은 대한민국 공공조달 제도 안내 사이트의 라우터입니다.

사용자는 조달 업무를 맡게 된 공공기관 담당자이며, 대개 제도 이름을 모릅니다.
상황 설명을 읽고 아래 제도 목록에서 해당할 수 있는 것을 최대 ${MAX_CANDIDATES}개 고르십시오.

지켜야 할 것:
- 법령을 해석하지 마십시오. "가능하다/불가능하다", "얼마까지 된다" 같은 판단을 하지 마십시오.
  금액 기준·요건 충족 여부는 사용자가 제도 페이지의 조문 원문을 보고 판단합니다.
- reason에는 어떤 상황으로 이해했고 왜 그 제도를 골랐는지만 2문장 이내로 적으십시오.
- 목록에 없는 제도를 만들어내지 마십시오. slug는 반드시 아래 목록의 것만 씁니다.
- 상황이 모호해 제도를 좁힐 수 없으면 needsMoreInfo를 true로 두고, 그래도 가능성 있는
  후보는 함께 반환하십시오.
- 조달과 무관한 질문이면 candidates를 비우고 needsMoreInfo를 false로 두십시오.

제도 목록:

${INDEX_TEXT}`;

// enum으로 막아두면 모델이 없는 제도를 지어낼 수 없다.
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: { type: "string", enum: SLUGS },
      maxItems: MAX_CANDIDATES,
    },
    reason: { type: "string" },
    needsMoreInfo: { type: "boolean" },
  },
  required: ["candidates", "reason", "needsMoreInfo"],
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
  let parsed: { candidates?: unknown; reason?: unknown; needsMoreInfo?: unknown };
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
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
    needsMoreInfo: parsed.needsMoreInfo === true,
  };
}

async function routeWithAnthropic(apiKey: string, query: string) {
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: ANTHROPIC_MODEL,
    // 응답은 slug 몇 개와 짧은 이유뿐이다. 넉넉히 잡을 이유가 없다.
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages: [{ role: "user", content: query }],
  });
  if (message.stop_reason === "refusal") return { candidates: [], reason: "", needsMoreInfo: false };
  const block = message.content.find((b) => b.type === "text");
  return normalize(block?.type === "text" ? block.text : undefined);
}

async function routeWithGemini(apiKey: string, query: string) {
  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: query,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseJsonSchema: OUTPUT_SCHEMA,
      maxOutputTokens: 512,
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
    const result = anthropicKey
      ? await routeWithAnthropic(anthropicKey as string, trimmed)
      : await routeWithGemini(geminiKey as string, trimmed);

    if (!result) return Response.json({ error: "empty_response" }, { status: 502 });
    return Response.json(result);
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
        availableModels,
        build: buildStamp,
      },
      { status: 502 },
    );
  }
}
