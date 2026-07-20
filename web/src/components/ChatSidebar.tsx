"use client";

// 제도 찾기 사이드바.
//
// 이 컴포넌트는 답을 쓰지 않는다. 사용자의 상황 설명을 받아 /api/route-institution 에
// 넘기고, 돌아온 slug로 검증된 제도 카드를 렌더링할 뿐이다. 모델이 만든 문장이 답이
// 되면 법령 해석을 하는 셈이 되므로(README의 면책 범위를 벗어난다), 화면에 보이는
// 제도 정보는 전부 로컬 데이터에서 가져온다.

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

interface RouteResponse {
  candidates: string[];
  reason: string;
  needsMoreInfo: boolean;
}

type Turn =
  | { role: "user"; text: string }
  | { role: "bot"; reason: string; slugs: string[]; needsMoreInfo: boolean }
  | { role: "error"; text: string };

const MAX_QUERY_LENGTH = 500;

export default function ChatSidebar({ index }: { index: ChatIndexEntry[] }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const bySlug = useCallback(
    (slug: string) => index.find((entry) => entry.slug === slug),
    [index],
  );

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [turns, pending]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending) return;

    setTurns((prev) => [...prev, { role: "user", text: trimmed }]);
    setDraft("");
    setPending(true);

    try {
      const response = await fetch("/api/route-institution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed.slice(0, MAX_QUERY_LENGTH) }),
      });
      if (!response.ok) throw new Error(String(response.status));

      const data = (await response.json()) as RouteResponse;
      // 모르는 slug가 오면 버린다. 없는 제도를 카드로 만들지 않기 위한 방어.
      const slugs = (data.candidates ?? []).filter((slug) => bySlug(slug));

      setTurns((prev) => [
        ...prev,
        {
          role: "bot",
          reason: data.reason ?? "",
          slugs,
          needsMoreInfo: Boolean(data.needsMoreInfo),
        },
      ]);
    } catch {
      setTurns((prev) => [
        ...prev,
        {
          role: "error",
          text: "지금은 제도 찾기를 쓸 수 없습니다. 아래 제도 대장에서 직접 찾아보세요.",
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.launcher}
        aria-expanded={open}
        aria-controls="chat-sidebar-panel"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "닫기" : "제도 찾기"}
      </button>

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
          {turns.length === 0 ? <EmptyState onPick={ask} /> : null}

          {turns.map((turn, i) => (
            <TurnView key={i} turn={turn} bySlug={bySlug} />
          ))}

          {pending ? <p className={styles.pending}>제도를 찾는 중…</p> : null}
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
          <button type="submit" disabled={pending || !draft.trim()}>
            보내기
          </button>
        </form>

        <p className={styles.disclaim}>
          해당 제도 페이지로 연결할 뿐이며, 개별 사건에 대한 법률 자문이나 공식 해석을
          대신하지 않습니다.
        </p>
      </div>
    </>
  );
}

const EXAMPLES = [
  "사무실 의자 30개 사야 하는데요",
  "업체가 못 하겠다고 합니다",
  "납품기한을 넘겼는데 어떻게 되나요",
];

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className={styles.empty}>
      <p>
        제도 이름을 모르셔도 됩니다. <b>상황을 그대로</b> 적으시면 해당하는 제도로
        안내합니다.
      </p>
      <ul className={styles.examples}>
        {EXAMPLES.map((example) => (
          <li key={example}>
            <button type="button" onClick={() => onPick(example)}>
              {example}
            </button>
          </li>
        ))}
      </ul>
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
      {turn.reason ? <p className={styles.reason}>{turn.reason}</p> : null}

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
