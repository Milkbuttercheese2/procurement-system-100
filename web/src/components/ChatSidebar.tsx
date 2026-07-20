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
  law: string;
  title: string;
  url?: string;
}

interface RouteResponse {
  candidates: string[];
  claims: VerifiedClaim[];
  needsMoreInfo: boolean;
  /** 근거 대조에 실패해 버려진 문장 수. 무엇이 빠졌는지는 내보내지 않는다. */
  droppedCount?: number;
  /** 조달 범위 밖 질문. 모델을 부르지 않고 돌려보낸 경우. */
  outOfScope?: boolean;
}

type Turn =
  | { role: "user"; text: string }
  | {
      role: "bot";
      claims: VerifiedClaim[];
      slugs: string[];
      needsMoreInfo: boolean;
      droppedCount: number;
      outOfScope: boolean;
    }
  | { role: "error"; text: string };

const MAX_QUERY_LENGTH = 500;
const OPEN_STORAGE_KEY = "chat-sidebar-open";
// 저장 형식이 바뀌면 키를 올린다. reason → answer로 필드명을 바꿨을 때, 예전
// 형식으로 저장돼 있던 대화가 복원되면서 turn.answer가 undefined가 되어 답변이
// 통째로 빈 칸으로 보였다. 옛 대화를 살리는 것보다 버리는 편이 낫다.
const TURNS_STORAGE_KEY = "chat-sidebar-turns-v2";

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
        body: JSON.stringify({ query: trimmed.slice(0, MAX_QUERY_LENGTH) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(String(response.status));

      const data = (await response.json()) as RouteResponse;
      // 모르는 slug가 오면 버린다. 없는 제도를 카드로 만들지 않기 위한 방어.
      const slugs = (data.candidates ?? []).filter((slug) => bySlug(slug));

      setTurns((prev) => [
        ...prev,
        {
          role: "bot",
          claims: Array.isArray(data.claims) ? data.claims : [],
          slugs,
          needsMoreInfo: Boolean(data.needsMoreInfo),
          droppedCount: data.droppedCount ?? 0,
          outOfScope: Boolean(data.outOfScope),
        },
      ]);
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

        <p className={styles.disclaim}>
          AI가 제도 요약을 근거로 정리한 안내입니다. 조문 원문은 제도 페이지에서 확인하세요
          — 개별 사건에 대한 법률 자문이나 공식 해석을 대신하지 않습니다.
        </p>
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
          {claim.text}{" "}
          {claim.url ? (
            <a
              className={styles.cite}
              href={claim.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`${claim.article}${claim.title ? ` (${claim.title})` : ""}`}
            >
              {claim.article}
            </a>
          ) : (
            <span className={styles.cite}>{claim.article}</span>
          )}
        </p>
      ))}

      {turn.droppedCount > 0 ? (
        <p className={styles.dropped}>
          근거 조문과 대조되지 않은 문장 {turn.droppedCount}건은 표시하지 않았습니다.
        </p>
      ) : null}

      {turn.needsMoreInfo ? (
        <p className={styles.notice}>
          상황을 조금 더 알려주시면 좁혀드릴 수 있습니다 — 물품인지 용역인지, 금액대가
          어느 정도인지 같은 것들이요.
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
