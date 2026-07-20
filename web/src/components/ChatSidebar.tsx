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
const OPEN_STORAGE_KEY = "chat-sidebar-open";
const TURNS_STORAGE_KEY = "chat-sidebar-turns";
const PANEL_WIDTH = 400;

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

  const bySlug = useCallback(
    (slug: string) => index.find((entry) => entry.slug === slug),
    [index],
  );

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // 패널이 열리면 본문을 왼쪽으로 밀어낸다(덮지 않는다). 폭을 깎는 대신 남는
  // 폭에 맞춰 같은 비율로 축소해서 가로 비율을 유지한다 — 실제 축소는
  // globals.css의 .site-shell 규칙이, 배율 계산은 여기가 맡는다.
  useEffect(() => {
    document.body.classList.toggle("chat-open", open);
    if (!open) return;

    const applyScale = () => {
      const vw = window.innerWidth;
      const scale = vw > 900 ? Math.max((vw - PANEL_WIDTH) / vw, 0.5) : 1;
      document.body.style.setProperty("--chat-scale", String(scale));
    };
    applyScale();
    window.addEventListener("resize", applyScale);
    return () => window.removeEventListener("resize", applyScale);
  }, [open]);

  useEffect(
    () => () => {
      document.body.classList.remove("chat-open");
      document.body.style.removeProperty("--chat-scale");
    },
    [],
  );

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [turns, pending]);

  // Esc로 닫던 동작은 뺐다. 이 패널은 모달이 아니라 계속 켜두고 쓰는 도구여서,
  // 입력 중 Esc가 눌려 대화가 사라지는 편이 손해가 크다. 닫기는 × 버튼만.

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending) return;

    setTurns((prev) => [...prev, { role: "user", text: trimmed }]);
    setDraft("");
    setPending(true);

    try {
      // 끝의 슬래시는 필수다. next.config의 trailingSlash 때문에 슬래시가 없으면
      // 308로 되돌아오고, POST 본문이 한 번 더 실려 가는 낭비가 생긴다.
      const response = await fetch("/api/route-institution/", {
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
