import fs from "fs";
import path from "path";
// Worker에는 파일시스템이 없다. 런타임에 필요한 것은 전부 빌드 산출물로 심는다.
// → scripts/generate-summaries.mjs
import summaries from "../../data/summaries.json";
import categoryOrder from "../../data/category-order.json";
import fieldVerificationQueue from "../../data/field-verification-queue.json";
import type {
  FieldVerificationQueue,
  Institution,
  InstitutionSummary,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "institutions");
const MANIFEST_PATH = path.join(process.cwd(), "..", "docs", "institutions-100-manifest.json");
const FIELD_QUEUE_PATH = path.join(
  process.cwd(),
  "..",
  "docs",
  "field-verification-queue.json"
);

interface ManifestEntry {
  priority: number;
  slug: string;
  name: string;
  type: string;
  category: string;
}

function loadManifest(): ManifestEntry[] {
  if (!fs.existsSync(MANIFEST_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8")) as ManifestEntry[];
  } catch {
    return [];
  }
}

function buildCategoryMap(): Map<string, string> {
  const manifest = loadManifest();
  const map = new Map<string, string>();
  for (const entry of manifest) {
    if (entry.slug && entry.category) {
      map.set(entry.slug, entry.category);
    }
  }
  return map;
}

export function getCategoryOrder(): string[] {
  // 매니페스트를 런타임에 읽으면 Worker에서 빈 배열이 되고, 목록이 분류 없이
  // 한 덩어리로 렌더링된다. 빌드 타임 산출물을 쓴다.
  return categoryOrder as string[];
}

export function getAllInstitutions(): Institution[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  const categoryMap = buildCategoryMap();
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const institutions = files.map((file) => {
    const content = fs.readFileSync(path.join(DATA_DIR, file), "utf-8");
    const inst = JSON.parse(content) as Institution;
    if (!inst.category) {
      inst.category = categoryMap.get(inst.slug) ?? "기타";
    }
    return inst;
  });
  return institutions.sort((a, b) => a.priority - b.priority);
}

export function toInstitutionSummary(
  institution: Institution
): InstitutionSummary {
  const category = institution.category ?? "기타";
  const article = institution.verification?.articleVerification;
  const gatewayCount =
    institution.process?.nodes.filter((node) => node.type === "gateway").length ??
    0;

  return {
    slug: institution.slug,
    name: institution.name,
    oneLiner: institution.oneLiner,
    type: institution.type,
    priority: institution.priority,
    category,
    asOfDate: institution.asOfDate,
    processNodeCount: institution.process?.nodes.length ?? 0,
    processStageCount: institution.process?.stages.length ?? 0,
    processLaneCount: institution.process?.lanes.length ?? 0,
    processGatewayCount: gatewayCount,
    legalBasisCount: institution.canvas.legalBasis.length,
    fieldVerificationCount: institution.fieldVerification.length,
    bottleneckCount: institution.canvas.bottlenecks.length,
    verificationStatus: institution.verification?.status,
    verifiedReferences: article?.verifiedReferences ?? 0,
    articleReferences: article?.articleReferences ?? 0,
    sourceCount: institution.verification?.sources.length ?? 0,
    laws: institution.canvas.legalBasis.map((basis) => basis.law),
  };
}

export function getInstitutionSummaries(): InstitutionSummary[] {
  // 디스크를 읽지 않고 빌드 타임 산출물을 쓴다. Cloudflare Worker에는 파일시스템이
  // 없어 getAllInstitutions()가 빈 배열을 돌려주고, 그러면 제도 목록이 통째로 비어
  // 보인다(실제로 배포 후 그렇게 됐다).
  //
  // 요약본은 scripts/generate-summaries.mjs 가 prebuild 단계에서 만든다.
  // 그 스크립트의 필드 계산은 아래 toInstitutionSummary()와 같아야 한다.
  return summaries as InstitutionSummary[];
}

export function getInstitution(slug: string): Institution | null {
  const filePath = path.join(DATA_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  const categoryMap = buildCategoryMap();
  const content = fs.readFileSync(filePath, "utf-8");
  const inst = JSON.parse(content) as Institution;
  if (!inst.category) {
    inst.category = categoryMap.get(slug) ?? "기타";
  }
  return inst;
}

export function getAllSlugs(): string[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

export function getFieldVerificationQueue(): FieldVerificationQueue {
  // 같은 이유(Worker 파일시스템 없음)로 빌드 산출물을 쓴다. 원본은 docs/ 에 있고
  // generate-summaries.mjs 가 data/ 로 복사한다.
  return fieldVerificationQueue as unknown as FieldVerificationQueue;
}
