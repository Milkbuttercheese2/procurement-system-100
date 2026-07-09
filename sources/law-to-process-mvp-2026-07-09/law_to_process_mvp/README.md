# Law-to-Process MVP

법령 조문을 읽어 **상태 인식형 Swimlane 업무프로세스 체계도** 초안을 생성하는 프로토타입입니다.

- 법령 API 수집: 법제처 OPEN API `lawSearch.do`, `lawService.do` 연동
- 조문 파싱: 조문/항/호/문장 분리
- 절차 추출: 주체, 행위, 문서, 기한, 조건, 수신자 추출
- 체계도 생성: BPMN 스타일 Swimlane + 상태/병목 레이어
- 검수: 각 카드 클릭 후 근거 조문, 산출물, 신뢰도 확인

> 주의: 이 MVP는 “법정 절차 체계도 초안”을 만드는 도구입니다. 실제 현상 업무구조도에는 내부 업무분장, 위임전결, 처리 로그, 담당자 검수가 추가되어야 합니다.

## 빠른 실행

```bash
cd law_to_process_mvp
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export LAW_OPEN_API_OC="발급받은_OC_키"
uvicorn app:app --reload
```

브라우저에서 열기:

```text
http://127.0.0.1:8000
```

인증키 없이도 `data/sample_eia.json` 기반 샘플 체계도는 볼 수 있습니다.

## API 예시

```bash
curl -X POST http://127.0.0.1:8000/api/process/extract \
  -H "Content-Type: application/json" \
  -d '{"institution_name":"환경영향평가", "law_name":"환경영향평가법", "text":"사업자는 평가서를 작성하여 승인기관의 장에게 제출하여야 한다."}'
```

## 파일 구성

```text
app.py                 FastAPI 서버
law_api.py             법제처 OPEN API 클라이언트
extractor.py           규칙 기반 조문 → 절차 추출 엔진
process_schema.py      내부 데이터 모델
data/sample_eia.json   환경영향평가 샘플 프로세스
static/index.html      단일 페이지 웹 UI
```

## 확장 방향

1. LLM 기반 추출 보조: 규칙 기반 추출 결과를 LLM이 보정
2. 하위법령 연결: “대통령령으로 정하는” 조문을 시행령·시행규칙에서 재탐색
3. BPMN XML Export: Camunda, bpmn.io, ProcessMind 등으로 내보내기
4. 상태관제: 프로젝트별 진행률, 경과일, 병목, 회귀횟수 저장
5. 담당자 검수 UI: 단계 병합, 순서 수정, 근거 조문 확인
