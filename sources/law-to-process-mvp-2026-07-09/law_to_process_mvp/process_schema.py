from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field

Status = Literal["done", "current", "risk", "delayed", "waiting", "gateway", "loop", "stopped"]
NodeType = Literal["event", "task", "gateway", "data", "notice", "system"]
EdgeType = Literal["sequence", "message", "loop", "condition"]


class LegalBasis(BaseModel):
    law: str
    article: Optional[str] = None
    text: str


class ProcessNode(BaseModel):
    id: str
    name: str
    lane: str
    stage: str
    type: NodeType = "task"
    actor: Optional[str] = None
    receiver: Optional[str] = None
    action: Optional[str] = None
    object: Optional[str] = None
    input_documents: list[str] = Field(default_factory=list)
    output_documents: list[str] = Field(default_factory=list)
    deadline: Optional[str] = None
    condition: Optional[str] = None
    status: Status = "waiting"
    progress: int = 0
    blocker: Optional[str] = None
    confidence: float = 0.5
    legal_basis: list[LegalBasis] = Field(default_factory=list)


class ProcessEdge(BaseModel):
    id: str
    source: str
    target: str
    type: EdgeType = "sequence"
    label: Optional[str] = None


class ProcessModel(BaseModel):
    institution_name: str
    law_name: str
    lanes: list[str]
    stages: list[str]
    nodes: list[ProcessNode]
    edges: list[ProcessEdge]
    warnings: list[str] = Field(default_factory=list)
