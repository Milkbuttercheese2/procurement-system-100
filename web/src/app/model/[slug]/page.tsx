import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAllSlugs, getInstitution } from "@/lib/data";
import type { Institution } from "@/lib/types";
import ProcessBoard from "@/components/ProcessBoard";

// ── Static export params ──────────────────────────────────────────────────────

export async function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export const dynamicParams = false;

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const institution = getInstitution(slug);
  if (!institution) return { title: "제도 100" };
  return {
    title: `${institution.name} — 한 장으로 끝내는 대한민국 제도 100`,
    description: institution.oneLiner,
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ModelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const institution = getInstitution(slug);
  if (!institution) notFound();

  return (
    <div style={{ background: "var(--color-canvas)" }}>
      <InstitutionHeader institution={institution} />
      <InstitutionCenter institution={institution} />
      <InstitutionBottom institution={institution} />
    </div>
  );
}

// ── Header Band ───────────────────────────────────────────────────────────────

function InstitutionHeader({ institution }: { institution: Institution }) {
  return (
    <section
      style={{
        background: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
        padding: "48px 24px 36px",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* Breadcrumb */}
        <div
          style={{
            fontSize: 13,
            color: "var(--color-faint)",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <a
            href="/"
            style={{
              color: "var(--color-faint)",
              textDecoration: "none",
            }}
          >
            제도 100
          </a>
          {institution.category && (
            <>
              <span>›</span>
              <a
                href="/#institutions"
                style={{
                  color: "var(--color-faint)",
                  textDecoration: "none",
                }}
              >
                {institution.category}
              </a>
            </>
          )}
          <span>›</span>
          <span style={{ color: "var(--color-muted)" }}>{institution.name}</span>
        </div>

        {/* Badges row */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 16,
          }}
        >
          <TypeBadge>{institution.type}</TypeBadge>
          <StatusBadge status={institution.status} />
          <span
            style={{
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              color: "var(--color-faint)",
              padding: "3px 8px",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
            }}
          >
            법령 기준일: {institution.asOfDate}
          </span>
        </div>

        {/* Title + one-liner */}
        <h1
          style={{
            fontSize: "clamp(28px, 5vw, 48px)",
            fontWeight: 720,
            lineHeight: 1.05,
            letterSpacing: "-0.01em",
            color: "var(--color-ink)",
            marginBottom: 12,
          }}
        >
          {institution.name}
        </h1>
        <p
          style={{
            fontSize: 17,
            color: "var(--color-muted)",
            lineHeight: 1.7,
            maxWidth: 720,
            marginBottom: 24,
          }}
        >
          {institution.oneLiner}
        </p>

        {/* Legal basis chips */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            overflowX: "auto",
          }}
        >
          {institution.canvas.legalBasis.map((lb, i) => (
            <LegalChip key={i} law={lb.law} articles={lb.articles} kind={lb.kind} />
          ))}
        </div>
      </div>
    </section>
  );
}

function TypeBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        padding: "3px 10px",
        borderRadius: 6,
        background: "var(--color-surface-muted)",
        color: "var(--color-muted)",
        border: "1px solid var(--color-border)",
      }}
    >
      {children}
    </span>
  );
}

function StatusBadge({ status }: { status: "full" | "canvas" }) {
  return status === "full" ? (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: 6,
        background: "var(--color-accent-soft)",
        color: "var(--color-accent-dark)",
      }}
    >
      업무구조도 포함
    </span>
  ) : (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: 6,
        background: "var(--color-surface-muted)",
        color: "var(--color-faint)",
      }}
    >
      구조도 준비 중
    </span>
  );
}

function LegalChip({
  law,
  articles,
  kind,
}: {
  law: string;
  articles?: string;
  kind: string;
}) {
  const kindColor: Record<string, { bg: string; text: string }> = {
    법률: { bg: "#eef8f3", text: "#087452" },
    대통령령: { bg: "#f5f7f6", text: "#5d6b63" },
    부령: { bg: "#f5f7f6", text: "#5d6b63" },
    "고시·지침": { bg: "#fef6e7", text: "#c78116" },
    조례: { bg: "#fef6e7", text: "#c78116" },
  };
  const c = kindColor[kind] ?? { bg: "#f5f7f6", text: "#5d6b63" };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        background: c.bg,
        borderRadius: 6,
        border: "1px solid rgba(0,0,0,0.06)",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: c.text,
        }}
      >
        {kind}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#111714" }}>
        {law}
      </span>
      {articles && (
        <span
          style={{
            fontSize: 12,
            color: "#5d6b63",
            fontFamily: "var(--font-mono)",
          }}
        >
          {articles}
        </span>
      )}
    </div>
  );
}

// ── Center — Process Board or Stepper ─────────────────────────────────────────

function InstitutionCenter({ institution }: { institution: Institution }) {
  return (
    <section style={{ padding: "40px 24px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {institution.status === "full" && institution.process ? (
          <FullProcessSection process={institution.process} />
        ) : (
          <CanvasStepperSection institution={institution} />
        )}
      </div>
    </section>
  );
}

function FullProcessSection({
  process,
}: {
  process: NonNullable<Institution["process"]>;
}) {
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2
          style={{
            fontSize: 22,
            fontWeight: 680,
            color: "var(--color-ink)",
            marginBottom: 4,
          }}
        >
          상태 인식형 업무구조도
        </h2>
        <p style={{ fontSize: 14, color: "var(--color-muted)" }}>
          게이트 타임라인과 노드를 클릭하면 법적 근거·산출물·병목을 볼 수 있습니다.
        </p>
      </div>
      <div
        style={{
          background: "var(--color-surface)",
          borderRadius: 18,
          border: "1px solid var(--color-border)",
          padding: "28px 24px",
          boxShadow: "0 16px 48px rgba(16,33,24,.05)",
        }}
      >
        <ProcessBoard process={process} compact={false} />
      </div>

      {/* Warnings */}
      {process.warnings && process.warnings.length > 0 && (
        <div
          style={{
            marginTop: 16,
            padding: "12px 16px",
            background: "#fef6e7",
            borderRadius: 8,
            fontSize: 13,
            color: "#c78116",
          }}
        >
          <strong>주의:</strong> {process.warnings.join(" / ")}
        </div>
      )}
    </div>
  );
}

function CanvasStepperSection({ institution }: { institution: Institution }) {
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2
          style={{
            fontSize: 22,
            fontWeight: 680,
            color: "var(--color-ink)",
            marginBottom: 4,
          }}
        >
          절차 개요
        </h2>
        <p style={{ fontSize: 14, color: "var(--color-muted)" }}>
          대표 흐름 단계입니다. 상태 인식형 업무구조도는 추후 추가됩니다.
        </p>
      </div>
      <div
        style={{
          background: "var(--color-surface)",
          borderRadius: 18,
          border: "1px solid var(--color-border)",
          padding: "28px 24px",
        }}
      >
        <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {institution.canvas.procedure.map((step, i) => {
            const isLast = i === institution.canvas.procedure.length - 1;
            return (
              <li
                key={i}
                style={{
                  display: "flex",
                  gap: 16,
                  paddingBottom: isLast ? 0 : 20,
                  position: "relative",
                }}
              >
                {/* Step number + connector */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: "var(--color-accent-soft)",
                      border: "1.5px solid var(--color-accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--color-accent-dark)",
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </div>
                  {!isLast && (
                    <div
                      style={{
                        width: 1,
                        flex: 1,
                        background: "var(--color-border)",
                        marginTop: 6,
                        minHeight: 16,
                      }}
                    />
                  )}
                </div>
                {/* Step text */}
                <div
                  style={{
                    fontSize: 15,
                    color: "var(--color-text)",
                    lineHeight: 1.6,
                    paddingTop: 4,
                  }}
                >
                  {step}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

// ── Bottom 2-col Grid ─────────────────────────────────────────────────────────

function InstitutionBottom({ institution }: { institution: Institution }) {
  const { canvas } = institution;

  return (
    <section
      style={{
        padding: "0 24px 72px",
        borderTop: "1px solid var(--color-border)",
        background: "var(--color-surface-muted)",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", paddingTop: 40 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: 16,
          }}
        >
          {/* Purpose */}
          <CanvasPanel title="제도의 목적">
            <p style={bodyStyle}>{canvas.purpose}</p>
          </CanvasPanel>

          {/* Stakeholders */}
          <CanvasPanel title="이해관계자">
            <p style={bodyStyle}>{canvas.stakeholders}</p>
          </CanvasPanel>

          {/* Authorities */}
          <CanvasPanel title="권한 구조">
            <ul style={{ ...listStyle }}>
              {canvas.authorities.map((a, i) => (
                <li key={i} style={listItemStyle}>
                  <strong style={{ color: "var(--color-ink)", fontWeight: 600 }}>
                    {a.name}
                  </strong>
                  <br />
                  <span style={{ fontSize: 13, color: "var(--color-muted)" }}>
                    {a.role}
                  </span>
                </li>
              ))}
            </ul>
          </CanvasPanel>

          {/* Money flow */}
          <CanvasPanel title="돈의 흐름">
            <p style={bodyStyle}>{canvas.moneyFlow}</p>
          </CanvasPanel>

          {/* Docs flow */}
          <CanvasPanel title="문서·데이터 흐름">
            <p style={bodyStyle}>{canvas.docsFlow}</p>
          </CanvasPanel>

          {/* Bottlenecks */}
          <CanvasPanel title="병목과 쟁점" accent="warning">
            <ul style={{ ...listStyle, paddingLeft: 0 }}>
              {canvas.bottlenecks.map((b, i) => (
                <li
                  key={i}
                  style={{
                    ...listItemStyle,
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      color: "var(--color-warning)",
                      marginTop: 2,
                    }}
                  >
                    ▲
                  </span>
                  <span style={{ fontSize: 14, color: "var(--color-text)" }}>
                    {b}
                  </span>
                </li>
              ))}
            </ul>
          </CanvasPanel>

          {/* Reform points */}
          <CanvasPanel title="개혁 포인트">
            <ul style={{ ...listStyle, paddingLeft: 0 }}>
              {canvas.reformPoints.map((r, i) => (
                <li
                  key={i}
                  style={{
                    ...listItemStyle,
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      color: "var(--color-accent)",
                      marginTop: 2,
                    }}
                  >
                    ▸
                  </span>
                  <span style={{ fontSize: 14, color: "var(--color-text)" }}>
                    {r}
                  </span>
                </li>
              ))}
            </ul>
          </CanvasPanel>

          {/* Related */}
          {institution.related.length > 0 && (
            <CanvasPanel title="관련 제도">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {institution.related.map((rel, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: 13,
                      padding: "4px 10px",
                      background: "var(--color-surface-muted)",
                      color: "var(--color-muted)",
                      borderRadius: 9999,
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    {rel}
                  </span>
                ))}
              </div>
            </CanvasPanel>
          )}

          {/* Field verification */}
          {institution.fieldVerification.length > 0 && (
            <CanvasPanel title="현장 검증 필요" accent="warning">
              <ul style={{ ...listStyle, paddingLeft: 0 }}>
                {institution.fieldVerification.map((fv, i) => (
                  <li
                    key={i}
                    style={{
                      ...listItemStyle,
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        color: "var(--color-warning)",
                        marginTop: 2,
                      }}
                    >
                      ⚠
                    </span>
                    <span style={{ fontSize: 14, color: "var(--color-text)" }}>
                      {fv}
                    </span>
                  </li>
                ))}
              </ul>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-faint)",
                  marginTop: 12,
                  fontStyle: "italic",
                }}
              >
                법령상 구조와 실제 운영 사이의 차이를 확인이 필요한 항목입니다.
              </p>
            </CanvasPanel>
          )}
        </div>

        {/* As-of date notice */}
        <div
          style={{
            marginTop: 40,
            padding: "16px 20px",
            background: "var(--color-surface)",
            borderRadius: 10,
            border: "1px solid var(--color-border)",
            fontSize: 13,
            color: "var(--color-muted)",
          }}
        >
          <strong style={{ color: "var(--color-ink)" }}>법령 기준일:</strong>{" "}
          {institution.asOfDate} · 이 페이지는 법률 자문이 아닌 참고자료입니다.
          오류·제보:{" "}
          <a
            href="mailto:ghtjd10855@gmail.com"
            style={{ color: "var(--color-accent-dark)" }}
          >
            ghtjd10855@gmail.com
          </a>
        </div>
      </div>
    </section>
  );
}

// Shared panel styles
function CanvasPanel({
  title,
  accent,
  children,
}: {
  title: string;
  accent?: "warning";
  children: React.ReactNode;
}) {
  const accentColor =
    accent === "warning" ? "var(--color-warning)" : "var(--color-border-strong)";

  return (
    <div
      style={{
        background: "var(--color-surface)",
        borderRadius: 12,
        border: "1px solid var(--color-border)",
        padding: "20px",
        borderTop: `3px solid ${accentColor}`,
      }}
    >
      <h3
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: accent === "warning" ? "var(--color-warning)" : "var(--color-faint)",
          marginBottom: 14,
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

const bodyStyle: React.CSSProperties = {
  fontSize: 14,
  color: "var(--color-text)",
  lineHeight: 1.75,
  margin: 0,
};

const listStyle: React.CSSProperties = {
  padding: 0,
  margin: 0,
  listStyle: "none",
};

const listItemStyle: React.CSSProperties = {
  paddingBottom: 10,
  marginBottom: 10,
  borderBottom: "1px solid var(--color-border)",
  lineHeight: 1.55,
};
