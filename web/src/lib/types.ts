export interface LegalBasis {
  law: string;
  articles?: string;
  kind: "법률" | "대통령령" | "부령" | "고시·지침" | "조례";
}

export interface Authority {
  name: string;
  role: string;
}

export interface Canvas {
  purpose: string;
  stakeholders: string;
  legalBasis: LegalBasis[];
  authorities: Authority[];
  procedure: string[];
  moneyFlow: string;
  docsFlow: string;
  bottlenecks: string[];
  reformPoints: string[];
}

export interface ProcessNodeLegalBasis {
  law: string;
  article: string;
  text?: string;
}

export type NodeStatus = "done" | "current" | "waiting" | "risk" | "loop";
export type NodeType = "task" | "gateway" | "notice" | "system";
export type EdgeType = "sequence" | "message" | "loop";

export interface ProcessNode {
  id: string;
  name: string;
  lane: string;
  stage: string;
  type: NodeType | string;
  status: NodeStatus | string;
  progress?: number;
  actor: string;
  action?: string;
  output_documents?: string[];
  deadline?: string;
  blocker?: string | null;
  confidence?: number;
  legal_basis?: ProcessNodeLegalBasis[];
}

export interface ProcessEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string | null;
}

export interface ProcessModel {
  institution_name?: string;
  law_name?: string;
  lanes: string[];
  stages: string[];
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  warnings?: string[];
}

export interface Institution {
  slug: string;
  name: string;
  oneLiner: string;
  type: string;
  priority: number;
  whyFirst: string;
  asOfDate: string;
  status: "full" | "canvas";
  canvas: Canvas;
  related: string[];
  fieldVerification: string[];
  process?: ProcessModel;
}
