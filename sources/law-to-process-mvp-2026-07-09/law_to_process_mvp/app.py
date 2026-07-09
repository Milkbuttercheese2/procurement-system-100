from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from extractor import extract_process
from law_api import LawApiError, fetch_law_detail, flatten_law_text, search_laws

APP_DIR = Path(__file__).resolve().parent

app = FastAPI(title="Law-to-Process MVP", version="0.1.0")


class ExtractRequest(BaseModel):
    institution_name: str = "제도명 미상"
    law_name: str = "법령명 미상"
    text: str


class SearchRequest(BaseModel):
    query: str
    oc: Optional[str] = None
    display: int = 10


class DetailRequest(BaseModel):
    law_id: Optional[str] = None
    mst: Optional[str] = None
    ef_yd: Optional[str] = None
    oc: Optional[str] = None


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return (APP_DIR / "static" / "index.html").read_text(encoding="utf-8")


@app.get("/sample")
def sample() -> Any:
    return json.loads((APP_DIR / "data" / "sample_eia.json").read_text(encoding="utf-8"))


@app.post("/api/law/search")
def api_search(req: SearchRequest) -> Any:
    try:
        return search_laws(req.query, oc=req.oc, display=req.display)
    except (LawApiError, Exception) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/law/detail")
def api_detail(req: DetailRequest) -> Any:
    try:
        detail = fetch_law_detail(law_id=req.law_id, mst=req.mst, ef_yd=req.ef_yd, oc=req.oc)
        return {"detail": detail, "flattened_text": flatten_law_text(detail)}
    except (LawApiError, Exception) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/process/extract")
def api_extract(req: ExtractRequest) -> Any:
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="분석할 조문 텍스트가 필요합니다.")
    return extract_process(req.institution_name, req.law_name, req.text).model_dump()
