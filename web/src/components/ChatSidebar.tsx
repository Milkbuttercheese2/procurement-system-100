"use client";

// 제도 찾기 사이드바.
//
// 상황 설명을 /api/route-institution 에 넘기고, 돌아온 설명(answer)과 제도 slug를
// 보여준다. answer는 모델이 인덱스 메타데이터만 근거로 쓴 길잡이이고, 제도 카드에
// 뜨는 이름·요약·검증 상태는 전부 로컬 검증 데이터에서 온다 — 조문 원문은 제도
// 페이지에서 확인하는 구조를 유지한다.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./ChatSidebar.module.css";

export interface ChatIndexEntry {
  slug: string;
  name: string;
  oneLiner: string;
  category: string;
  verified: boolean;
}

export interface VerifiedClaim {
  text: string;
  article: string;
  articleNo: string;
  law: string;
  kind?: string;
  effectiveOn?: string;
  title: string;
  url?: string;
}

interface RouteResponse {
  candidates: string[];
  claims: VerifiedClaim[];
  needsMoreInfo: boolean;
  /** 근거 대조에 실패해 버려진 문장 수. 무엇이 빠졌는지는 내보내지 않는다. */
  droppedCount?: number;
  /** 조문 스냅샷 기준일. 이후 개정은 반영돼 있지 않다. */
  asOfDate?: string;
  /** 조달 범위 밖 질문. 모델을 부르지 않고 돌려보낸 경우. */
  outOfScope?: boolean;
  /** 실제로 답한 제공자와 모델. 어디로 데이터가 갔는지 밝히기 위해 표시한다. */
  provider?: string;
  model?: string;
}

export interface AnnexHint {
  law: string;
  annex: string;
  title: string;
  url?: string;
}

interface StreamEvent {
  type: "meta" | "claim" | "done" | "error";
  candidates?: string[];
  asOfDate?: string;
  provider?: string;
  model?: string;
  claim?: VerifiedClaim;
  droppedCount?: number;
  annexes?: AnnexHint[];
  detail?: string;
}

interface BotTurn {
  role: "bot";
  claims: VerifiedClaim[];
  slugs: string[];
  needsMoreInfo: boolean;
  droppedCount: number;
  outOfScope: boolean;
  asOfDate?: string;
  provider?: string;
  model?: string;
  annexes?: AnnexHint[];
}

type Turn =
  | { role: "user"; text: string }
  | BotTurn
  | { role: "error"; text: string };

const MAX_QUERY_LENGTH = 500;
const OPEN_STORAGE_KEY = "chat-sidebar-open";
// 저장 형식이 바뀌면 키를 올린다. reason → answer로 필드명을 바꿨을 때, 예전
// 형식으로 저장돼 있던 대화가 복원되면서 turn.answer가 undefined가 되어 답변이
// 통째로 빈 칸으로 보였다. 옛 대화를 살리는 것보다 버리는 편이 낫다.
const TURNS_STORAGE_KEY = "chat-sidebar-turns-v2";
// 서버로 함께 보낼 이전 대화 수. 서버도 같은 값으로 자르지만, 필요 없는 것을
// 네트워크에 실을 이유가 없다.
const HISTORY_TURNS = 3;

export default function ChatSidebar({ index }: { index: ChatIndexEntry[] }) {
  // 제도 카드를 누르면 페이지가 이동하면서 컴포넌트가 새로 마운트된다. 상태를
  // 메모리에만 두면 그때마다 패널이 닫혀버리므로, 사용자가 직접 닫기 전까지는
  // 열린 상태가 유지되도록 저장한다.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(OPEN_STORAGE_KEY) === "1") setOpen(true);
    } catch {
      // 프라이빗 모드 등 localStorage를 못 쓰는 환경.
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(OPEN_STORAGE_KEY, open ? "1" : "0");
    } catch {
      /* 저장 실패는 무시한다 */
    }
  }, [open]);
  // 패널이 열린 채로 제도 카드를 누르면 페이지가 이동한다. 대화까지 날아가면
  // 열린 상태를 유지한 보람이 없으므로 같이 복원한다. 탭을 닫으면 사라지도록
  // sessionStorage를 쓴다.
  const [turns, setTurns] = useState<Turn[]>([]);
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(TURNS_STORAGE_KEY);
      if (saved) setTurns(JSON.parse(saved) as Turn[]);
    } catch {
      // 손상된 값이면 빈 대화로 시작한다.
    }
  }, []);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(TURNS_STORAGE_KEY, JSON.stringify(turns));
    } catch {
      /* 저장 실패는 무시한다 */
    }
  }, [turns]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  // 진행 중인 요청을 취소하기 위한 핸들. 응답이 10초 넘게 걸릴 때가 있어서,
  // 기다릴지 말지는 사용자가 정하게 한다.
  const abortRef = useRef<AbortController | null>(null);

  const bySlug = useCallback(
    (slug: string) => index.find((entry) => entry.slug === slug),
    [index],
  );

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // 패널은 본문을 밀거나 줄이지 않고 오른쪽을 덮는다. 본문 크기가 바뀌면
  // 읽던 위치가 흔들려서 오히려 방해가 됐다. 클래스는 다른 스타일 훅으로 남겨둔다.
  useEffect(() => {
    document.body.classList.toggle("chat-open", open);
    return () => document.body.classList.remove("chat-open");
  }, [open]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [turns, pending]);

  // Esc로 닫던 동작은 뺐다. 이 패널은 모달이 아니라 계속 켜두고 쓰는 도구여서,
  // 입력 중 Esc가 눌려 대화가 사라지는 편이 손해가 크다. 닫기는 × 버튼만.

  /**
   * 대화 이력을 {질문, 안내한 제도} 쌍으로 뽑는다. 질문 바로 뒤의 봇 응답을
   * 짝지어야 하므로 순서대로 훑는다.
   */
  function historyFrom(list: Turn[]) {
    const pairs: Array<{ query: string; slugs: string[] }> = [];
    for (let i = 0; i < list.length; i += 1) {
      const t = list[i];
      if (t.role !== "user") continue;
      const next = list[i + 1];
      pairs.push({
        query: t.text,
        slugs: next && next.role === "bot" ? next.slugs : [],
      });
    }
    return pairs.slice(-HISTORY_TURNS);
  }

  /** 대화를 비운다. 이력이 다음 질문의 맥락으로 쓰이므로, 화제를 완전히 바꿀 때
   *  직전 제도를 끌고 가지 않으려면 이 버튼이 필요하다. */
  function reset() {
    cancel();
    setTurns([]);
    setDraft("");
    try {
      window.sessionStorage.removeItem(TURNS_STORAGE_KEY);
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
    inputRef.current?.focus();
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending) return;

    setTurns((prev) => [...prev, { role: "user", text: trimmed }]);
    setDraft("");
    setPending(true);

    try {
      // 끝의 슬래시는 필수다. next.config의 trailingSlash 때문에 슬래시가 없으면
      // 308로 되돌아오고, POST 본문이 한 번 더 실려 가는 낭비가 생긴다.
      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch("/api/route-institution/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 이전 질문과 그때 안내한 제도를 함께 보낸다. 이게 없으면 "그럼 얼마나
        // 되나요" 같은 되묻기가 앞 맥락을 잃는다. 답변 본문은 보내지 않는다 —
        // 길기만 하고 서버가 이미 검증해 내려준 것이라 다시 볼 이유가 없다.
        body: JSON.stringify({
          query: trimmed.slice(0, MAX_QUERY_LENGTH),
          history: historyFrom(turns),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(String(response.status));

      // 범위 밖 등은 스트림이 아니라 그냥 JSON으로 온다.
      const isStream = response.headers
        .get("Content-Type")
        ?.includes("x-ndjson");
      if (!isStream || !response.body) {
        const data = (await response.json()) as RouteResponse;
        setTurns((prev) => [
          ...prev,
          {
            role: "bot",
            claims: [],
            slugs: [],
            needsMoreInfo: false,
            droppedCount: 0,
            outOfScope: Boolean(data.outOfScope),
          },
        ]);
        return;
      }

      // 빈 답변 칸을 먼저 만들고, 검증을 통과한 문장이 도착하는 대로 채운다.
      // 서버가 대조한 것만 보내므로 화면에 뜨는 문장은 전부 근거가 확인된 것이다.
      let index = -1;
      setTurns((prev) => {
        index = prev.length;
        return [
          ...prev,
          {
            role: "bot",
            claims: [],
            slugs: [],
            needsMoreInfo: false,
            droppedCount: 0,
            outOfScope: false,
          },
        ];
      });

      const patch = (fn: (t: BotTurn) => BotTurn) =>
        setTurns((prev) =>
          prev.map((t, i) => (i === index && t.role === "bot" ? fn(t) : t)),
        );

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(line) as StreamEvent;
          } catch {
            continue; // 잘린 줄은 다음 조각과 합쳐진다
          }
          if (event.type === "meta") {
            patch((t) => ({
              ...t,
              slugs: (event.candidates ?? []).filter((s) => bySlug(s)),
              asOfDate: event.asOfDate,
              provider: event.provider,
              model: event.model,
            }));
          } else if (event.type === "claim" && event.claim) {
            patch((t) => ({ ...t, claims: [...t.claims, event.claim!] }));
          } else if (event.type === "done") {
            patch((t) => ({
              ...t,
              droppedCount: event.droppedCount ?? 0,
              annexes: event.annexes ?? [],
            }));
          }
        }
      }
    } catch (error) {
      // 사용자가 직접 취소한 것은 오류가 아니다. 질문만 남기고 조용히 끝낸다.
      const aborted = error instanceof DOMException && error.name === "AbortError";
      setTurns((prev) => [
        ...prev,
        aborted
          ? { role: "error", text: "질문을 취소했습니다." }
          : {
              role: "error",
              text: "지금은 제도 찾기를 쓸 수 없습니다. 아래 제도 대장에서 직접 찾아보세요.",
            },
      ]);
    } finally {
      abortRef.current = null;
      setPending(false);
    }
  }

  return (
    <>
      {/* 열려 있을 때는 감춘다. 패널 우상단 ×가 닫기를 맡고, 그대로 두면
          입력창의 '보내기' 버튼과 영역이 겹친다. */}
      {open ? null : (
        <button
          type="button"
          className={styles.launcher}
          aria-expanded={false}
          aria-controls="chat-sidebar-panel"
          onClick={() => setOpen(true)}
        >
          제도 찾기
        </button>
      )}

      <div
        id="chat-sidebar-panel"
        ref={panelRef}
        className={`${styles.panel} ${open ? styles.panelOpen : ""}`}
        role="dialog"
        aria-modal="false"
        aria-label="제도 찾기"
        hidden={!open}
      >
        <header className={styles.head}>
          <span className={styles.title}>제도 찾기</span>
          <span className={styles.tag}>검증된 {index.length}개에서만 안내</span>
          {turns.length > 0 ? (
            <button
              type="button"
              className={styles.reset}
              onClick={reset}
              title="이전 대화를 지우고 새로 시작합니다"
            >
              새 대화
            </button>
          ) : null}
          <button
            type="button"
            className={styles.close}
            onClick={() => setOpen(false)}
            aria-label="제도 찾기 닫기"
          >
            ×
          </button>
        </header>

        <div className={styles.thread}>
          {turns.length === 0 ? <EmptyState /> : null}

          {turns.map((turn, i) => (
            <TurnView key={i} turn={turn} bySlug={bySlug} />
          ))}

          {pending ? (
            <p className={styles.pending}>
              제도를 찾는 중…{" "}
              <button type="button" className={styles.cancel} onClick={cancel}>
                취소
              </button>
            </p>
          ) : null}
          <div ref={threadEndRef} />
        </div>

        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            void ask(draft);
          }}
        >
          <label className="sr-only" htmlFor="chat-input">
            상황 설명
          </label>
          <textarea
            id="chat-input"
            ref={inputRef}
            rows={2}
            maxLength={MAX_QUERY_LENGTH}
            value={draft}
            placeholder="상황을 그대로 적어보세요"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(draft);
              }
            }}
          />
          {pending ? (
            <button type="button" onClick={cancel}>
              취소
            </button>
          ) : (
            <button type="submit" disabled={!draft.trim()}>
              보내기
            </button>
          )}
        </form>

        {/* 보내기 전에 보여야 의미가 있는 경고다. 답변에 붙이면 이미 전송된 뒤다.
            한 문단에 몰아넣으면 안 읽히므로 항목으로 쪼갠다. */}
        <ul className={styles.notes}>
          <li>
            답변은 <b>검증된 조문 원문</b>에서만 나옵니다. 근거가 대조되지 않은 문장은
            표시하지 않습니다.
          </li>
          <li>
            입력 내용은 <b>외부 AI 서비스로 전송</b>됩니다. 무료 등급은 입력·출력이 모델
            개선에 쓰일 수 있습니다.
          </li>
          <li>
            개인정보나 <b>공개되지 않은 조달 건의 구체적 정보는 넣지 마세요.</b>
          </li>
          <li>
            법률 자문이나 공식 해석이 아닙니다. 판단 전에 <b>조문 링크에서 원문을
            확인</b>하세요.
          </li>
        </ul>
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div className={styles.empty}>
      <p>
        제도 이름을 모르셔도 됩니다. <b>상황을 그대로</b> 적으시면 해당하는 제도로
        안내합니다.
      </p>
    </div>
  );
}

/**
 * 어느 AI가 답했는지 밝힌다. 폴백 구조라 질문마다 달라질 수 있고, 무료 서비스는
 * 입력이 학습에 쓰일 수 있어 사용자가 알아야 한다. 유료 API(Anthropic)는 약관상
 * 학습에 쓰지 않으므로 구분해서 적는다.
 */
function providerLabel(provider: string, model?: string) {
  const known: Record<string, { name: string; collects: boolean }> = {
    gemini: { name: "Google Gemini", collects: true },
    nvidia: { name: "NVIDIA NIM", collects: true },
    anthropic: { name: "Anthropic Claude", collects: false },
  };
  const info = known[provider] ?? { name: provider, collects: true };
  const suffix = info.collects
    ? "무료 등급 — 입력이 모델 개선에 쓰일 수 있음"
    : "유료 API — 입력을 학습에 쓰지 않음";
  return `이 답변: ${info.name}${model ? ` (${model})` : ""} · ${suffix}`;
}

/** 인용 툴팁. "제26조"만으로는 법률인지 시행령인지 알 수 없어 함께 밝힌다. */
function citeTitle(claim: VerifiedClaim) {
  return [
    claim.law,
    claim.articleNo,
    claim.title ? `(${claim.title})` : "",
    claim.kind ? `· ${claim.kind}` : "",
    claim.effectiveOn ? `· 시행 ${claim.effectiveOn}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function TurnView({
  turn,
  bySlug,
}: {
  turn: Turn;
  bySlug: (slug: string) => ChatIndexEntry | undefined;
}) {
  if (turn.role === "user") {
    return <p className={styles.userMsg}>{turn.text}</p>;
  }

  if (turn.role === "error") {
    return <p className={styles.errorMsg}>{turn.text}</p>;
  }

  return (
    <div className={styles.botMsg}>
      {turn.outOfScope ? (
        <p className={styles.reason}>
          이 사이트가 다루는 공공조달·계약 제도의 범위 밖으로 보입니다. 조달 업무
          상황으로 다시 적어주시면 해당 제도로 안내하겠습니다.
        </p>
      ) : null}

      {/* 문장마다 근거 조문을 붙인다. 각 문장은 인용구가 조문 원문에 실재하는지
          서버에서 대조를 통과한 것만 내려온다. 링크로 원문까지 갈 수 있게 해
          사용자가 직접 확인할 수 있도록 한다. */}
      {turn.claims.map((claim, i) => (
        <p key={i} className={styles.reason}>
          {claim.text}
          {/* 같은 조문이 연달아 나오면 인용을 한 번만 보인다. 문장마다 같은
              조문번호가 붙으면 읽는 흐름이 끊기고 형식적으로 보인다. */}
          {turn.claims[i - 1]?.article === claim.article ? null : (
            <>
              {" "}
          {claim.url ? (
            <a
              className={styles.cite}
              href={claim.url}
              target="_blank"
              rel="noopener noreferrer"
              title={citeTitle(claim)}
            >
              {claim.articleNo}
            </a>
          ) : (
            <span className={styles.cite} title={citeTitle(claim)}>
              {claim.articleNo}
            </span>
          )}
            </>
          )}
        </p>
      ))}

      {turn.claims.length > 0 && turn.asOfDate ? (
        <p className={styles.asOf}>
          조문 기준일 {turn.asOfDate} — 이후 개정분은 반영되어 있지 않습니다.
          시행 중인 내용인지는 조문 링크에서 확인하세요.
        </p>
      ) : null}

      {/* 근거 있는 문장을 못 만든 경우. 조문에 없는 내용을 지어내지 않았다는 뜻이라
          검증은 제대로 돈 것이지만, 사용자에게는 답이 없는 화면이다. 어디에
          있는지라도 알려준다. */}
      {turn.claims.length === 0 && !turn.outOfScope && turn.slugs.length > 0 ? (
        <p className={styles.notice}>
          {turn.annexes && turn.annexes.length > 0
            ? "이 내용은 조문이 아니라 별표에 정해져 있습니다. 이 사이트는 별표 본문을 갖고 있지 않아, 아래 원문에서 확인하셔야 합니다."
            : "검증된 조문에서 이 질문에 답할 근거를 찾지 못했습니다. 아래 제도 페이지에서 직접 확인해 주세요."}
        </p>
      ) : null}

      {turn.annexes && turn.annexes.length > 0 ? (
        <div className={styles.annexBox}>
          <p className={styles.recLabel}>관련 별표</p>
          {turn.annexes.map((a) => (
            <a
              key={`${a.law}${a.annex}`}
              className={styles.annexLink}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <b>
                {a.law} {a.annex}
              </b>
              <span>{a.title}</span>
            </a>
          ))}
        </div>
      ) : null}

      {turn.provider ? (
        <p className={styles.provider}>
          {providerLabel(turn.provider, turn.model)}
        </p>
      ) : null}

      {turn.droppedCount > 0 ? (
        <p className={styles.dropped}>
          근거 조문과 대조되지 않은 문장 {turn.droppedCount}건은 표시하지 않았습니다.
        </p>
      ) : null}


      {turn.slugs.length > 0 ? (
        <>
          <p className={styles.recLabel}>
            해당할 수 있는 제도 {turn.slugs.length}건
          </p>
          {turn.slugs.map((slug) => {
            const entry = bySlug(slug);
            if (!entry) return null;
            return (
              <Link
                key={slug}
                href={`/model/${slug}/`}
                className={styles.card}
                prefetch={false}
              >
                <span className={styles.cardTop}>
                  <span className={styles.cardName}>{entry.name}</span>
                  {entry.verified ? (
                    <span className={`${styles.badge} ${styles.badgeOk}`}>
                      조문 대조 완료
                    </span>
                  ) : (
                    <span className={`${styles.badge} ${styles.badgeReview}`}>
                      재검증 대상
                    </span>
                  )}
                  <span className={`${styles.badge} ${styles.badgeCat}`}>
                    {entry.category}
                  </span>
                </span>
                <span className={styles.cardDesc}>{entry.oneLiner}</span>
                <span className={styles.cardCta}>흐름도 보기 →</span>
              </Link>
            );
          })}
        </>
      ) : (
        <p className={styles.notice}>
          이 상황에 맞는 제도를 찾지 못했습니다. 제도 대장에서 직접 찾아보시거나, 상황을
          다르게 설명해 주세요.
        </p>
      )}
    </div>
  );
}
