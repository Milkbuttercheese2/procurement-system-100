# korea100 데이터 계약 v1

웹(web/)의 콘텐츠(data/)와 UI(src/)가 공유하는 스키마. 이 문서가 단일 진실 원천이다.
근거: docs/one-page-template.md(9칸 캔버스), docs/pilot-environmental-impact-assessment-v1.md,
sources/law-to-process-mvp-2026-07-09/.../data/sample_eia.json(프로세스 그래프 원형).

## 파일 배치

- `web/data/institutions/{slug}.json` — 제도 1건 1파일 (아래 Institution)
- 로더(src/lib/data.ts)가 디렉터리 전체를 읽어 priority 순 정렬

## Institution 스키마

```ts
interface Institution {
  slug: string;          // 영문 케밥 (URL)
  name: string;          // "환경영향평가"
  oneLiner: string;      // 한 줄 요약
  type: string;          // "협의·평가형" 등 launch-10-v0.md의 유형
  priority: number;      // 1~10 (공개 순서)
  whyFirst: string;      // 왜 먼저 만드나
  asOfDate: string;      // 법령 기준일 "2025-10-23"
  status: "full" | "canvas";
  // full   = 9칸 캔버스 + 상태 인식형 프로세스 보드까지
  // canvas = 9칸 캔버스까지 (프로세스는 추후)

  canvas: {
    purpose: string;                 // 1. 무엇을 해결하나
    stakeholders: string;            // 2. 누구에게 영향을 주나
    legalBasis: Array<{              // 3. 법적 근거 (조문번호 필수 지향)
      law: string;                   //   "환경영향평가법"
      articles?: string;             //   "제24조, 제27~30조"
      kind: "법률" | "대통령령" | "부령" | "고시·지침" | "조례";
    }>;
    authorities: Array<{             // 4. 누가 권한을 갖나
      name: string; role: string;
    }>;
    procedure: string[];             // 5. 절차 대표 단계 (짧은 문장 6~10개)
    moneyFlow: string;               // 6. 돈의 흐름
    docsFlow: string;                // 7. 문서/데이터 흐름
    bottlenecks: string[];           // 8. 어디서 막히나
    reformPoints: string[];          // 9. 어떻게 바꿀 수 있나
  };
  related: string[];                 // 관련 제도 (이름 문자열, 내부 제도면 slug와 동일 명칭)
  fieldVerification: string[];       // "현장 검증 필요" 항목 명시 (없으면 [])

  process?: ProcessModel;            // status="full"일 때
}
```

## ProcessModel (상태 인식형 업무구조도 — sample_eia.json과 동일 골격)

```ts
interface ProcessModel {
  lanes: string[];    // 행위주체 레인
  stages: string[];   // "G0 대상판정" 형식 게이트
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  warnings?: string[];
}
// sample_eia.json 실데이터 어휘를 그대로 채택
interface ProcessEdge {
  id: string;
  source: string;           // node id
  target: string;
  type: "sequence" | "message" | "loop"; // loop = 보완·회귀 루프 (UI: 점선 회귀 표시)
  label?: string | null;
}
interface ProcessNode {
  id: string;               // "P01"
  name: string;
  lane: string;             // lanes 중 하나
  stage: string;            // stages 중 하나
  type: "task" | "gateway" | "notice" | "system";
  status: "done" | "current" | "waiting" | "risk" | "loop";
  // done=완료, current=현재 공 위치, waiting=대기, risk=병목 위험, loop=회귀 중
  progress?: number;        // 0~100
  actor: string;            // 현재 공 보유자
  action?: string;
  output_documents?: string[];
  deadline?: string;        // 법정/내부 기한 표현
  blocker?: string | null;  // 병목 설명
  confidence?: number;      // 0~1, 법령 근거 확신도. <0.8이면 UI가 "현장 검증 필요" 뱃지
  legal_basis?: Array<{ law: string; article: string }>;
}
```

## 작성 규칙 (one-page-template.md 요약)

- 법령명 + 조문번호를 붙인다. 법률→대통령령→부령 우선.
- 법령상 구조와 실제 운영 추정을 구분한다: 추정·관행 서술은 fieldVerification에 등재하고
  본문에서는 "(현장 검증 필요)"를 문장 끝에 붙인다.
- 문장은 짧게. 절차는 대표 흐름만, 예외는 bottlenecks/관련 제도로.
- asOfDate는 실제 확인한 법령 기준일. 확인 못 했으면 가장 보수적인 날짜 + fieldVerification 등재.

## UI 계약 (요약)

- `/` 홈: 히어로(제목·핵심문장) + EIA 프로세스 보드 미리보기 + 10개 제도 카드(유형·한줄·왜먼저)
- `/model/{slug}`: 한 장 레이아웃 — 상단(메타·법령), 중앙(procedure 또는 process 보드), 하단(돈·문서·병목·개혁·관련)
- status="full"은 상태 인식형 보드(게이트 타임라인 + 레인 그리드 + 노드 클릭 상세 drawer + 회귀 엣지 표시)
- 요청 폼(/request): PRD 5장 항목, MVP는 mailto/외부폼/localStorage 허용
- 모든 페이지에 법령 기준일 표시. 정적 export(GitHub Pages, basePath 대응 필수 — popfund와 동일 규칙:
  generateStaticParams에 encodeURIComponent 금지, robots/sitemap force-static, fetch는 basePath 헬퍼)
