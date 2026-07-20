// 상황 설명 → 제도 slug 라우팅.
//
// 이 엔드포인트는 답을 생성하지 않는다. 모델은 66개 제도 중 어느 것으로 보낼지만
// 고르고(구조화 출력 + enum으로 slug를 강제), 화면에 뜨는 제도 정보는 클라이언트가
// 로컬 검증 데이터에서 렌더링한다. 모델이 쓴 문장이 답이 되면 법령 해석을 하는 셈이라
// README의 면책 범위를 벗어난다.
//
// ANTHROPIC_API_KEY는 서버에서만 읽는다. 브라우저 번들에 들어가지 않는다.

import Anthropic from "@anthropic-ai/sdk";
import { getAllInstitutions } from "@/lib/data";

// Cloudflare 어댑터가 런타임을 결정하도록 명시하지 않는다. 라우트 핸들러는
// 기본적으로 캐시되지 않으므로 별도 설정이 필요 없다.

const MAX_QUERY_LENGTH = 500;
const MAX_CANDIDATES = 3;

// 비용 전제가 Haiku 기준(약 $1/$5 per MTok)으로 잡혀 있다. 모델을 올리면 단가가
// 몇 배로 뛰므로 환경변수로만 바꾸도록 둔다.
const MODEL = process.env.CHAT_MODEL ?? "claude-haiku-4-5";

/** 라우팅용 인덱스. 제도당 250자 안팎, 66개 합쳐 8천 토큰 수준이라 통째로 넣는다. */
const INSTITUTIONS = getAllInstitutions();
const SLUGS = INSTITUTIONS.map((institution) => institution.slug);

const INDEX_TEXT = INSTITUTIONS.map((institution) => {
  const applicability = institution.canvas?.applicability;
  const applicabilityText = Array.isArray(applicability)
    ? applicability.join(" ")
    : typeof applicability === "string"
      ? applicability
      : "";
  return [
    `slug: ${institution.slug}`,
    `이름: ${institution.name}`,
    `분류: ${institution.category ?? ""}`,
    `요약: ${institution.oneLiner ?? ""}`,
    applicabilityText ? `적용대상: ${applicabilityText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}).join("\n\n---\n\n");

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

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      // enum으로 막아두면 모델이 없는 제도를 지어낼 수 없다.
      items: { type: "string", enum: SLUGS },
      maxItems: MAX_CANDIDATES,
    },
    reason: { type: "string" },
    needsMoreInfo: { type: "boolean" },
  },
  required: ["candidates", "reason", "needsMoreInfo"],
  additionalProperties: false,
} as const;

// IP당 간이 제한. 서버리스에서는 인스턴스마다 초기화되므로 완전한 방어가 아니다.
// 실질적인 상한은 Anthropic Console의 월 지출 한도이며, 이건 그 앞단의 완충일 뿐이다.
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

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // 키가 없는 배포(정적 미리보기 등)에서도 화면이 깨지지 않도록 조용히 503.
    return Response.json({ error: "not_configured" }, { status: 503 });
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
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: MODEL,
      // 응답은 slug 몇 개와 짧은 이유뿐이다. 넉넉히 잡을 이유가 없다.
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      messages: [{ role: "user", content: trimmed }],
    });

    if (message.stop_reason === "refusal") {
      return Response.json(
        { candidates: [], reason: "", needsMoreInfo: false },
        { status: 200 },
      );
    }

    const text = message.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") {
      return Response.json({ error: "empty_response" }, { status: 502 });
    }

    const parsed = JSON.parse(text.text) as {
      candidates?: unknown;
      reason?: unknown;
      needsMoreInfo?: unknown;
    };

    // 스키마가 강제하지만 한 번 더 거른다 — 화면에 없는 제도가 뜨는 것보다 낫다.
    const candidates = Array.isArray(parsed.candidates)
      ? parsed.candidates
          .filter((slug): slug is string => typeof slug === "string")
          .filter((slug) => SLUGS.includes(slug))
          .slice(0, MAX_CANDIDATES)
      : [];

    return Response.json({
      candidates,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      needsMoreInfo: parsed.needsMoreInfo === true,
    });
  } catch {
    return Response.json({ error: "upstream_failed" }, { status: 502 });
  }
}
