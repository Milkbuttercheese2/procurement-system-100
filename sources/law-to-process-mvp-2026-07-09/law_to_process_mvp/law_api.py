from __future__ import annotations

import os
from typing import Any

import requests

BASE = "https://www.law.go.kr/DRF"


class LawApiError(RuntimeError):
    pass


def _oc(oc: str | None = None) -> str:
    value = oc or os.getenv("LAW_OPEN_API_OC") or os.getenv("LAW_OC")
    if not value:
        raise LawApiError("LAW_OPEN_API_OC 환경변수 또는 oc 파라미터가 필요합니다.")
    return value


def search_laws(query: str, *, oc: str | None = None, display: int = 10) -> dict[str, Any]:
    params = {
        "OC": _oc(oc),
        "target": "eflaw",
        "type": "JSON",
        "query": query,
        "display": min(max(display, 1), 100),
        "page": 1,
    }
    r = requests.get(f"{BASE}/lawSearch.do", params=params, timeout=20)
    r.raise_for_status()
    return r.json()


def fetch_law_detail(*, law_id: str | None = None, mst: str | None = None, ef_yd: str | None = None, oc: str | None = None) -> dict[str, Any]:
    if not law_id and not mst:
        raise LawApiError("law_id 또는 mst 중 하나가 필요합니다.")
    params: dict[str, Any] = {
        "OC": _oc(oc),
        "target": "eflaw",
        "type": "JSON",
    }
    if law_id:
        params["ID"] = law_id
    else:
        params["MST"] = mst
        if ef_yd:
            params["efYd"] = ef_yd
    r = requests.get(f"{BASE}/lawService.do", params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def flatten_law_text(detail_json: dict[str, Any]) -> str:
    """Best-effort flattening for law.go.kr JSON detail responses."""
    chunks: list[str] = []

    def walk(obj: Any) -> None:
        if isinstance(obj, dict):
            title = obj.get("조문제목") or obj.get("조문번호") or ""
            content = obj.get("조문내용") or obj.get("항내용") or obj.get("호내용") or obj.get("목내용")
            if content:
                chunks.append(f"{title} {content}".strip())
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(detail_json)
    return "\n".join(dict.fromkeys(chunks))
