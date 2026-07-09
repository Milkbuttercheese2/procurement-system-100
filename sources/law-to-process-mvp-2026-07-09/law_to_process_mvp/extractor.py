from __future__ import annotations

import re
import uuid
from collections import defaultdict
from typing import Iterable

from process_schema import LegalBasis, ProcessEdge, ProcessModel, ProcessNode

DEFAULT_LANES = [
    "사업자/시행자",
    "평가대행자",
    "승인기관",
    "관할 지자체",
    "협의기관",
    "위원회/협의회",
    "전문검토기관/관계기관",
    "주민/이해관계자",
    "정보시스템",
]

DEFAULT_STAGES = [
    "G0 대상판정",
    "G1 착수·스코핑",
    "G2 조사·초안",
    "G3 공고·공람",
    "G4 의견수렴·본안",
    "G5 협의검토·보완",
    "G6 협의통보·승인",
    "G7 이행·사후관리",
]

ACTOR_TO_LANE = [
    (r"사업자|시행자|개발사업자", "사업자/시행자"),
    (r"평가대행자|환경영향평가업자", "평가대행자"),
    (r"승인기관|승인기관의 장|인가기관|허가기관", "승인기관"),
    (r"시장|군수|구청장|지방자치단체|시ㆍ군ㆍ구|시·군·구", "관할 지자체"),
    (r"협의기관|환경부장관|기후에너지환경부장관|유역환경청|지방환경청", "협의기관"),
    (r"협의회|위원회", "위원회/협의회"),
    (r"전문기관|한국환경연구원|관계 행정기관|해양수산부장관", "전문검토기관/관계기관"),
    (r"주민|이해관계자|의견을 제출", "주민/이해관계자"),
    (r"정보지원시스템|정보통신망|시스템", "정보시스템"),
]

ACTION_PATTERNS = [
    ("작성", r"작성"),
    ("제출", r"제출"),
    ("요청", r"요청|요구"),
    ("접수", r"접수"),
    ("검토", r"검토"),
    ("심의", r"심의"),
    ("협의", r"협의"),
    ("보완", r"보완"),
    ("반려", r"반려"),
    ("통보", r"통보|알려야"),
    ("공고", r"공고"),
    ("공람", r"공람"),
    ("의견수렴", r"의견\s*수렴|의견을\s*듣|의견을\s*수렴"),
    ("승인", r"승인|허가|인가|확정"),
    ("고시", r"고시"),
    ("조사", r"조사"),
    ("이행", r"이행"),
    ("공개", r"공개|게시"),
]

DOC_KEYWORDS = [
    "평가준비서", "환경영향평가서", "평가서", "평가서 초안", "약식평가서",
    "보완서", "협의내용", "협의내용 통보서", "사업계획", "의견서", "의견반영표",
    "사후환경영향조사서", "관리대장", "공고문", "공람대장", "심의결과", "검토의견",
]

STAGE_RULES = [
    ("G0 대상판정", r"대상|판정|사업의 종류|대상사업"),
    ("G1 착수·스코핑", r"평가준비서|평가항목|범위|방법|협의회|대안|스코핑"),
    ("G2 조사·초안", r"초안|현황조사|영향예측|저감방안|조사"),
    ("G3 공고·공람", r"공고|공람|열람|설명회|공청회"),
    ("G4 의견수렴·본안", r"의견|본안|반영|미반영"),
    ("G5 협의검토·보완", r"협의 요청|협의요청|검토|전문기관|보완|반려|재검토"),
    ("G6 협의통보·승인", r"협의내용|통보|승인(?!기관)|허가|인가|확정|고시"),
    ("G7 이행·사후관리", r"이행|사후|착공|준공|관리대장|조치명령|재협의|변경"),
]


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\u3000", " ")).strip()


def split_articles(text: str) -> list[tuple[str, str]]:
    """Return [(article_label, article_text)]."""
    raw = text.replace("\r", "\n")
    pattern = re.compile(r"(?=(제\d+조(?:의\d+)?(?:\([^\)]*\))?))")
    parts = pattern.split(raw)
    if len(parts) <= 1:
        return [("조문 미상", normalize_text(raw))]
    out: list[tuple[str, str]] = []
    i = 1
    while i < len(parts):
        label = parts[i].strip()
        body = parts[i + 1] if i + 1 < len(parts) else ""
        out.append((label, normalize_text(label + " " + body)))
        i += 2
    return out


def split_sentences(article_text: str) -> list[str]:
    # Korean legal sentences often end with 다. / 한다. / 있다. Keep it simple.
    chunks = re.split(r"(?<=[다음임함있])\.\s*|(?<=다)\s+(?=제|①|②|③|④|⑤|⑥|⑦|⑧|⑨|⑩|[가-힣]+는|[가-힣]+은)", article_text)
    return [normalize_text(c) for c in chunks if len(normalize_text(c)) >= 12]


def detect_lane(sentence: str) -> tuple[str, str | None]:
    for pat, lane in ACTOR_TO_LANE:
        m = re.search(pat, sentence)
        if m:
            return lane, m.group(0)
    return "사업자/시행자", None


def detect_action(sentence: str) -> str | None:
    for action, pat in ACTION_PATTERNS:
        if re.search(pat, sentence):
            return action
    return None


def detect_documents(sentence: str) -> list[str]:
    docs = [d for d in DOC_KEYWORDS if d in sentence]
    # Generic noun phrases ending in 서/서류/계획 may be docs, but avoid over-collection.
    for m in re.finditer(r"([가-힣A-Za-z0-9·ㆍ\-]{2,20}(?:서|서류|계획|계획서|결과|의견|공문))", sentence):
        token = m.group(1)
        if token not in docs and len(token) <= 20:
            docs.append(token)
    return docs[:6]


def detect_deadline(sentence: str) -> str | None:
    m = re.search(r"(\d+\s*(?:일|개월|년)\s*이내|\d+\s*(?:일|개월|년)\s*전까지|지체\s*없이|즉시)", sentence)
    return m.group(1).replace(" ", "") if m else None


def detect_receiver(sentence: str) -> str | None:
    m = re.search(r"([가-힣A-Za-z0-9·ㆍ\s]{2,25})(?:에게|에)\s*(?:제출|통보|요청|요구|송부)", sentence)
    if m:
        return normalize_text(m.group(1))
    return None


def detect_condition(sentence: str) -> str | None:
    patterns = [
        r"(.{0,25}경우)",
        r"(.{0,25}때)",
        r"(.{0,25}필요하다고 인정하는 경우)",
        r"(.{0,25}대통령령으로 정하는)",
    ]
    for pat in patterns:
        m = re.search(pat, sentence)
        if m:
            return normalize_text(m.group(1))
    return None


def detect_stage(sentence: str, action: str | None) -> str:
    for stage, pat in STAGE_RULES:
        if re.search(pat, sentence):
            return stage
    if action in {"공고", "공람"}:
        return "G3 공고·공람"
    if action in {"검토", "보완", "반려"}:
        return "G5 협의검토·보완"
    if action in {"통보", "승인", "고시"}:
        return "G6 협의통보·승인"
    return "G1 착수·스코핑"


def make_name(action: str | None, docs: list[str], sentence: str) -> str:
    if docs and action:
        return f"{docs[0]} {action}"
    if action:
        return f"{action} 업무"
    return sentence[:24] + ("…" if len(sentence) > 24 else "")


def node_type(action: str | None, condition: str | None) -> str:
    if action in {"보완", "반려"} or condition:
        return "gateway" if action in {"보완", "반려"} else "task"
    if action in {"공고", "공개"}:
        return "notice"
    return "task"


def confidence_score(action: str | None, actor: str | None, docs: list[str], deadline: str | None) -> float:
    score = 0.35
    if action:
        score += 0.25
    if actor:
        score += 0.2
    if docs:
        score += 0.15
    if deadline:
        score += 0.05
    return min(score, 0.95)


def extract_process(institution_name: str, law_name: str, text: str) -> ProcessModel:
    articles = split_articles(text)
    nodes: list[ProcessNode] = []
    warnings: list[str] = []
    seen_names: set[tuple[str, str, str]] = set()

    for article_label, article_text in articles:
        for sentence in split_sentences(article_text):
            action = detect_action(sentence)
            if not action:
                continue
            lane, actor = detect_lane(sentence)
            docs = detect_documents(sentence)
            deadline = detect_deadline(sentence)
            receiver = detect_receiver(sentence)
            condition = detect_condition(sentence)
            stage = detect_stage(sentence, action)
            name = make_name(action, docs, sentence)
            key = (lane, stage, name)
            if key in seen_names:
                continue
            seen_names.add(key)
            node_id = f"N{len(nodes)+1:03d}"
            status = "waiting"
            ntype = node_type(action, condition)
            if ntype == "gateway":
                status = "gateway"
            nodes.append(ProcessNode(
                id=node_id,
                name=name,
                lane=lane,
                stage=stage,
                type=ntype,
                actor=actor,
                receiver=receiver,
                action=action,
                object=docs[0] if docs else None,
                input_documents=[],
                output_documents=docs,
                deadline=deadline,
                condition=condition,
                status=status,
                progress=0,
                blocker=None,
                confidence=confidence_score(action, actor, docs, deadline),
                legal_basis=[LegalBasis(law=law_name, article=article_label, text=sentence[:500])]
            ))

    if not nodes:
        warnings.append("절차형 문장을 찾지 못했습니다. '작성/제출/검토/통보/승인/공고/보완' 등의 법령 문장이 포함되어야 합니다.")

    stage_index = {s: i for i, s in enumerate(DEFAULT_STAGES)}
    lane_index = {l: i for i, l in enumerate(DEFAULT_LANES)}
    nodes.sort(key=lambda n: (stage_index.get(n.stage, 999), lane_index.get(n.lane, 999), n.id))
    for i, n in enumerate(nodes, start=1):
        n.id = f"P{i:02d}"

    edges: list[ProcessEdge] = []
    # naive sequence by stage order; skip multiple nodes in same stage less aggressively.
    for i in range(len(nodes) - 1):
        edges.append(ProcessEdge(id=f"E{i+1:02d}", source=nodes[i].id, target=nodes[i+1].id, type="sequence"))
    # add loop edges from gateway-ish 보완 to previous submit/review node if possible.
    for n in nodes:
        if n.action in {"보완", "반려"}:
            prior = next((x for x in reversed(nodes[:nodes.index(n)]) if x.action in {"제출", "검토", "협의"}), None)
            if prior:
                edges.append(ProcessEdge(id=f"L{len(edges)+1:02d}", source=n.id, target=prior.id, type="loop", label="보완/재검토"))

    return ProcessModel(
        institution_name=institution_name,
        law_name=law_name,
        lanes=DEFAULT_LANES,
        stages=DEFAULT_STAGES,
        nodes=nodes,
        edges=edges,
        warnings=warnings,
    )
