# law-to-process MVP Import Notes

## Source

- Received via Telegram document attachment on 2026-07-09.
- Original file: `/Users/seohoseong/.openclaw/media/inbound/law_to_process_mvp---456c8e4a-1cbb-4c7b-84ed-5d1a1dc9c5ef.zip`
- SHA256: `e000bff4f6fd40534e4eaf2e9427a738a31003373b2d704ecb845dc41d3e78f5`

## What It Is

This is a runnable FastAPI prototype that turns legal text into a status-aware swimlane process model.

Core pieces:

- `process_schema.py`: Pydantic model for lanes, stages, nodes, edges, legal basis, and status.
- `extractor.py`: rule-based Korean legal-text extractor for actors, actions, documents, deadlines, receivers, stages, and loop edges.
- `law_api.py`: law.go.kr DRF client for law search/detail and text flattening.
- `app.py`: FastAPI server exposing `/`, `/sample`, `/api/law/search`, `/api/law/detail`, `/api/process/extract`.
- `data/sample_eia.json`: environmental-impact-assessment sample model.
- `static/index.html`: standalone status-aware swimlane board UI.

## Verification

- Created a local `.venv` and installed `requirements.txt`.
- `py_compile` passed for `app.py`, `extractor.py`, `law_api.py`, and `process_schema.py`.
- Ran `uvicorn app:app --host 127.0.0.1 --port 8017`.
- `GET /` returned `200 text/html`.
- `GET /sample` now returns a JSON object with 9 lanes, 8 stages, 18 nodes, and 20 edges.
- `POST /api/process/extract` returned extracted process nodes for a small 환경영향평가법 text sample.
- Browser QA with Puppeteer confirmed 18 rendered nodes, node selection, and the 보완 발생 시나리오 interaction.
- Mobile QA confirmed page-level horizontal overflow is fixed; the swimlane board remains horizontally scrollable inside its board container.

## Local Fixes Applied

- Fixed `/sample` in `app.py` so it returns parsed JSON instead of a JSON string.
- Added an inline favicon to `static/index.html` to remove the browser favicon 404.
- Constrained the board layout so wide swimlane content scrolls inside `.board-shell` instead of widening the whole page on mobile.

## Role In The 제도100 Project

Use this as the internal/interactive generator behind the public site:

1. Public homepage: explain the concept and show curated first 10 제도.
2. Public sample page: publish a polished 환경영향평가 page using this swimlane board style.
3. Internal production tool: paste 법률/시행령/시행규칙 text or call law.go.kr, then generate first-draft process models.
4. Editorial workflow: human review fixes stage order, missing actors, legal basis, and real-world bottleneck labels.
