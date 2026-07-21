import type { Metadata } from "next";
import { getInstitutionSummaries } from "@/lib/data";

export const metadata: Metadata = {
  title: "공유 이미지",
  robots: { index: false, follow: false },
};

const INSTITUTIONS = getInstitutionSummaries();
const MODEL_COUNT = INSTITUTIONS.length;
const NODE_COUNT = INSTITUTIONS.reduce(
  (sum, institution) => sum + institution.processNodeCount,
  0,
);
const VERIFIED_REFERENCE_COUNT = INSTITUTIONS.reduce(
  (sum, institution) => sum + institution.verifiedReferences,
  0,
);
const SOURCE_COUNT = INSTITUTIONS.reduce(
  (sum, institution) => sum + institution.sourceCount,
  0,
);

const formatCount = (value: number) => value.toLocaleString("ko-KR");

export default function OgCardPage() {
  return (
    <main className="og-card-page">
      <div className="og-card-brand">
        <span aria-hidden="true" />
        법령 기준 업무 흐름도
      </div>
      <h1>그 많던 조달은 어떻게 했을까</h1>
      <p>법령부터 실제 업무 흐름까지, 한 장으로 읽는 공공조달 카탈로그</p>

      <section className="og-card-metrics">
        <div>
          <strong>{formatCount(MODEL_COUNT)}</strong>
          <span>조달 제도</span>
        </div>
        <div>
          <strong>{formatCount(NODE_COUNT)}</strong>
          <span>업무 노드</span>
        </div>
        <div>
          <strong>{formatCount(VERIFIED_REFERENCE_COUNT)}</strong>
          <span>확인 조문</span>
        </div>
        <div>
          <strong>{formatCount(SOURCE_COUNT)}</strong>
          <span>공식 원문</span>
        </div>
      </section>

      <section className="og-card-flow" aria-label="구조도 구성">
        <div><span>01</span><strong>절차</strong></div>
        <i aria-hidden="true" />
        <div><span>02</span><strong>법적 근거</strong></div>
        <i aria-hidden="true" />
        <div><span>03</span><strong>적용 대상</strong></div>
        <i aria-hidden="true" />
        <div><span>04</span><strong>제출서류</strong></div>
        <i aria-hidden="true" />
        <div><span>05</span><strong>유의사항</strong></div>
      </section>

      <footer>how-did-they-do-all-that-procurement.dali-n-narumi.workers.dev</footer>
    </main>
  );
}
