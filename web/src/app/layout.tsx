import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "한 장으로 끝내는 대한민국 제도 100",
  description:
    "기업에는 비즈니스 모델이 있듯이, 국가에는 제도 모델이 있다. 대한민국 주요 제도를 법령·조직·절차·예산·문서를 한 장 구조도로 보여드립니다.",
  keywords: "대한민국 제도, 환경영향평가, 예비타당성조사, 행정, 정책, 법령",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full">
      <body className="min-h-full flex flex-col" style={{ background: "var(--color-canvas)" }}>
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

function Header() {
  return (
    <header
      style={{
        background: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
        position: "sticky",
        top: 0,
        zIndex: 50,
        boxShadow: "0 1px 0 var(--color-border)",
      }}
    >
      <div
        style={{
          maxWidth: 1440,
          margin: "0 auto",
          padding: "0 24px",
          height: 56,
          display: "flex",
          alignItems: "center",
          gap: 32,
        }}
      >
        {/* Brand */}
        <Link
          href="/"
          style={{
            fontWeight: 720,
            fontSize: 15,
            color: "var(--color-ink)",
            textDecoration: "none",
            flexShrink: 0,
            letterSpacing: "-0.01em",
          }}
        >
          제도 100
        </Link>

        {/* Nav */}
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            overflowX: "auto",
            whiteSpace: "nowrap",
            flex: 1,
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          } as React.CSSProperties}
        >
          <NavLink href="/#institutions">제도 목록</NavLink>
          <NavLink href="/model/environmental-impact-assessment/">환경영향평가</NavLink>
        </nav>

        {/* CTA */}
        <Link
          href="/request/"
          style={{
            flexShrink: 0,
            padding: "6px 14px",
            borderRadius: 9999,
            background: "var(--color-ink)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
            transition: "background 140ms ease-out",
          }}
        >
          요청하기
        </Link>
      </div>
    </header>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      style={{
        padding: "6px 10px",
        fontSize: 14,
        color: "var(--color-muted)",
        textDecoration: "none",
        borderRadius: 6,
        transition: "color 140ms ease-out, background 140ms ease-out",
        fontWeight: 450,
      }}
    >
      {children}
    </Link>
  );
}

function Footer() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--color-border)",
        background: "var(--color-surface-muted)",
        padding: "40px 24px",
        marginTop: 80,
      }}
    >
      <div
        style={{
          maxWidth: 1440,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 32,
        }}
      >
        <div>
          <p
            style={{
              fontWeight: 720,
              fontSize: 14,
              color: "var(--color-ink)",
              marginBottom: 8,
            }}
          >
            한 장으로 끝내는 대한민국 제도 100
          </p>
          <p style={{ fontSize: 13, color: "var(--color-muted)", lineHeight: 1.7 }}>
            법령 기준일 기준으로 작성된 참고자료입니다.
            <br />
            법률 자문이나 공식 유권해석이 아닙니다.
          </p>
        </div>
        <div>
          <p
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: "var(--color-faint)",
              marginBottom: 8,
            }}
          >
            안내
          </p>
          <p style={{ fontSize: 13, color: "var(--color-muted)", lineHeight: 1.7 }}>
            각 제도 페이지에 법령 기준일을 표시합니다.
            <br />
            법령이 개정되면 내용이 달라질 수 있습니다.
            <br />
            오류·제보:{" "}
            <a
              href="mailto:ghtjd10855@gmail.com"
              style={{ color: "var(--color-accent-dark)", textDecoration: "none" }}
            >
              ghtjd10855@gmail.com
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
