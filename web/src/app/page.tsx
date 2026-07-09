import Link from "next/link";
import { getAllInstitutions, getInstitution } from "@/lib/data";
import type { Institution } from "@/lib/types";
import ProcessBoard from "@/components/ProcessBoard";

export default function HomePage() {
  const institutions = getAllInstitutions();
  const eia = getInstitution("environmental-impact-assessment");

  return (
    <>
      <Hero />
      {eia?.process && <ProcessPreview process={eia.process} />}
      <InstitutionGrid institutions={institutions} />
    </>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section
      style={{
        background: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
        padding: "72px 24px 64px",
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        {/* Eyebrow */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            background: "var(--color-accent-soft)",
            borderRadius: 9999,
            marginBottom: 28,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--color-accent)",
            }}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--color-accent-dark)",
            }}
          >
            제도 모델 참고자료
          </span>
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: "clamp(32px, 6vw, 64px)",
            fontWeight: 720,
            lineHeight: 0.98,
            letterSpacing: "-0.01em",
            color: "var(--color-ink)",
            marginBottom: 28,
          }}
        >
          한 장으로 끝내는
          <br />
          대한민국 제도 100
        </h1>

        {/* Tagline */}
        <p
          style={{
            fontSize: "clamp(16px, 2vw, 20px)",
            fontWeight: 500,
            color: "var(--color-accent-dark)",
            marginBottom: 20,
            letterSpacing: "-0.005em",
          }}
        >
          기업에는 비즈니스 모델이 있듯이, 국가에는 제도 모델이 있다.
        </p>

        {/* Description */}
        <p
          style={{
            fontSize: 16,
            color: "var(--color-muted)",
            lineHeight: 1.75,
            maxWidth: 640,
            marginBottom: 36,
          }}
        >
          대한민국 주요 제도를 법령·조직·절차·예산·문서를 한 장 구조도로 정리합니다.
          누가 결정하고, 누가 집행하며, 어떤 서류와 예산이 오가는지,
          어디서 막히는지를 한눈에 파악할 수 있습니다.
          공무원·보좌진·연구자·기자·정책학생 모두를 위한 참고 자료입니다.
        </p>

        {/* CTAs */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link
            href="#institutions"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 22px",
              background: "var(--color-ink)",
              color: "#fff",
              borderRadius: 9999,
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 600,
              transition: "background 140ms ease-out",
            }}
          >
            제도 목록 보기
          </Link>
          <Link
            href="/request/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "10px 22px",
              background: "transparent",
              color: "var(--color-ink)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: 9999,
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 600,
              transition: "border-color 140ms ease-out, background 140ms ease-out",
            }}
          >
            다음 제도 요청하기
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── Process Preview ───────────────────────────────────────────────────────────

function ProcessPreview({ process }: { process: NonNullable<Institution["process"]> }) {
  return (
    <section
      style={{
        background: "var(--color-surface-tint)",
        borderBottom: "1px solid var(--color-border)",
        padding: "48px 24px",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* Section header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: 28,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                color: "var(--color-accent-dark)",
                marginBottom: 6,
              }}
            >
              상태 인식형 업무구조도 미리보기
            </div>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 680,
                color: "var(--color-ink)",
                margin: 0,
              }}
            >
              환경영향평가 — 현재 진행 상태
            </h2>
          </div>
          <Link
            href="/model/environmental-impact-assessment/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-accent-dark)",
              textDecoration: "none",
              padding: "8px 16px",
              border: "1px solid var(--color-accent)",
              borderRadius: 9999,
              background: "var(--color-surface)",
              transition: "background 140ms ease-out",
              whiteSpace: "nowrap",
            }}
          >
            전체 보기 →
          </Link>
        </div>

        {/* Compact board */}
        <div
          style={{
            background: "var(--color-surface)",
            borderRadius: 18,
            border: "1px solid var(--color-border)",
            padding: "20px 24px",
            boxShadow: "0 16px 48px rgba(16,33,24,.06)",
          }}
        >
          <ProcessBoard process={process} compact={true} />
        </div>
      </div>
    </section>
  );
}

// ── Institution Grid ──────────────────────────────────────────────────────────

function InstitutionGrid({ institutions }: { institutions: Institution[] }) {
  return (
    <section
      id="institutions"
      style={{ padding: "64px 24px" }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* Section header */}
        <div style={{ marginBottom: 36 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: "var(--color-faint)",
              marginBottom: 8,
            }}
          >
            제도 목록
          </div>
          <h2
            style={{
              fontSize: 28,
              fontWeight: 680,
              color: "var(--color-ink)",
              margin: 0,
            }}
          >
            공개된 제도 모델
          </h2>
          {institutions.length === 0 && (
            <p style={{ marginTop: 12, color: "var(--color-muted)", fontSize: 15 }}>
              현재 준비 중입니다. 아래 버튼으로 제도 제작을 요청해 주세요.
            </p>
          )}
        </div>

        {/* Grid */}
        {institutions.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 16,
            }}
          >
            {institutions.map((inst) => (
              <InstitutionCard key={inst.slug} institution={inst} />
            ))}
          </div>
        )}

        {/* Request CTA */}
        <div
          style={{
            marginTop: 48,
            padding: "32px",
            background: "var(--color-surface)",
            borderRadius: 18,
            border: "1px solid var(--color-border)",
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: 16,
              color: "var(--color-muted)",
              marginBottom: 16,
            }}
          >
            분석이 필요한 제도가 있으신가요? 다음 제작 순서에 반영합니다.
          </p>
          <Link
            href="/request/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "10px 24px",
              background: "var(--color-accent)",
              color: "#fff",
              borderRadius: 9999,
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            제도 제작 요청하기
          </Link>
        </div>
      </div>
    </section>
  );
}

function InstitutionCard({ institution }: { institution: Institution }) {
  const isCanvas = institution.status === "canvas";

  return (
    <Link
      href={`/model/${institution.slug}/`}
      className="card-link"
      style={{
        display: "block",
        textDecoration: "none",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "20px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Priority badge + type */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--color-faint)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
          }}
        >
          #{institution.priority.toString().padStart(2, "0")}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            padding: "2px 8px",
            borderRadius: 4,
            background: "var(--color-surface-muted)",
            color: "var(--color-muted)",
            border: "1px solid var(--color-border)",
          }}
        >
          {institution.type}
        </span>
        {isCanvas && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: "#f5f7f6",
              color: "#87938d",
              border: "1px solid #dde5df",
            }}
          >
            구조도 준비 중
          </span>
        )}
        {!isCanvas && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: "var(--color-accent-soft)",
              color: "var(--color-accent-dark)",
              border: "1px solid rgba(15,159,114,0.2)",
            }}
          >
            업무구조도 포함
          </span>
        )}
      </div>

      {/* Name */}
      <h3
        style={{
          fontSize: 18,
          fontWeight: 680,
          color: "var(--color-ink)",
          marginBottom: 8,
          lineHeight: 1.3,
        }}
      >
        {institution.name}
      </h3>

      {/* One-liner */}
      <p
        style={{
          fontSize: 13,
          color: "var(--color-muted)",
          lineHeight: 1.6,
          marginBottom: 12,
        }}
      >
        {institution.oneLiner}
      </p>

      {/* Why first */}
      <div
        style={{
          padding: "8px 10px",
          background: "var(--color-surface-muted)",
          borderRadius: 6,
          fontSize: 12,
          color: "var(--color-muted)",
          lineHeight: 1.5,
          marginBottom: 12,
          borderLeft: "2px solid var(--color-border-strong)",
        }}
      >
        {institution.whyFirst}
      </div>

      {/* As-of date */}
      <div
        style={{
          fontSize: 11,
          color: "var(--color-faint)",
          fontFamily: "var(--font-mono)",
        }}
      >
        법령 기준일: {institution.asOfDate}
      </div>
    </Link>
  );
}
