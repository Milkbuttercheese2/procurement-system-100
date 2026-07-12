import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProcessLaneGroups } from "../src/lib/process-layout.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.dirname(SCRIPT_DIR);
const REPO_DIR = path.dirname(WEB_DIR);
const DATA_DIR = path.join(WEB_DIR, "data", "institutions");
const MANIFEST_PATH = path.join(REPO_DIR, "docs", "institutions-100-manifest.json");
const FIELD_QUEUE_PATH = path.join(REPO_DIR, "docs", "field-verification-queue.json");

const NODE_STATUSES = new Set(["done", "current", "waiting", "risk", "loop"]);
const NODE_TYPES = new Set(["task", "gateway", "notice", "system"]);
const EDGE_TYPES = new Set(["sequence", "message", "loop"]);
const LEGAL_KINDS = new Set([
  "법률",
  "대통령령",
  "총리령",
  "부령",
  "행정안전부령",
  "대법원규칙",
  "감사원규칙",
  "행정규칙",
  "고시·지침",
  "조례",
  "조례·규칙",
]);
const VERIFICATION_STATUSES = new Set(["source-linked", "article-verified", "needs-review"]);
const SOURCE_TYPES = new Set(["statute", "admin-rule", "treaty"]);
const UNRESOLVED_REASON_CODES = new Set([
  "local-scope",
  "institution-scope",
  "internal-rule",
  "external-official-document",
  "title-needs-confirmation",
]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const errors = [];

function fail(scope, message) {
  errors.push(`${scope}: ${message}`);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(path.relative(REPO_DIR, filePath), `JSON 파싱 실패 (${error.message})`);
    return null;
  }
}

const files = fs.readdirSync(DATA_DIR).filter((file) => file.endsWith(".json")).sort();
const institutions = files
  .map((file) => ({ file, data: readJson(path.join(DATA_DIR, file)) }))
  .filter(({ data }) => data !== null);
const manifest = readJson(MANIFEST_PATH) ?? [];
const fieldQueue = readJson(FIELD_QUEUE_PATH);

if (!Array.isArray(manifest) || manifest.length === 0) {
  fail("manifest", "항목이 1개 이상이어야 합니다");
}
if (files.length !== manifest.length) {
  fail("institutions", `JSON 파일 수 ${files.length}개와 manifest ${manifest.length}개가 다릅니다`);
}

const priorities = new Set();
const slugs = new Set();
const manifestBySlug = new Map();
for (const entry of Array.isArray(manifest) ? manifest : []) {
  if (!entry.slug) fail("manifest", "slug가 없는 항목이 있습니다");
  if (!entry.category) fail(`manifest/${entry.slug ?? "unknown"}`, "category가 없습니다");
  if (manifestBySlug.has(entry.slug)) fail(`manifest/${entry.slug}`, "slug가 중복됩니다");
  if (priorities.has(entry.priority)) fail(`manifest/${entry.slug}`, `priority ${entry.priority}가 중복됩니다`);
  manifestBySlug.set(entry.slug, entry);
  priorities.add(entry.priority);
}

for (let priority = 1; priority <= manifest.length; priority += 1) {
  if (!priorities.has(priority)) fail("manifest", `priority ${priority}가 없습니다`);
}

for (const { file, data: institution } of institutions) {
  const scope = `data/institutions/${file}`;
  const expectedSlug = file.replace(/\.json$/, "");
  if (institution.slug !== expectedSlug) fail(scope, `slug는 파일명과 같은 ${expectedSlug}여야 합니다`);
  if (slugs.has(institution.slug)) fail(scope, `slug ${institution.slug}가 중복됩니다`);
  slugs.add(institution.slug);

  const manifestEntry = manifestBySlug.get(institution.slug);
  if (!manifestEntry) {
    fail(scope, "manifest 항목이 없습니다");
  } else {
    if (manifestEntry.priority !== institution.priority) fail(scope, "manifest와 priority가 다릅니다");
    if (manifestEntry.name !== institution.name) fail(scope, "manifest와 name이 다릅니다");
    if (manifestEntry.type !== institution.type) fail(scope, "manifest와 type이 다릅니다");
  }

  if (institution.status !== "full") fail(scope, `현재 공개 데이터의 status는 full이어야 합니다 (${institution.status})`);
  if (!institution.asOfDate) fail(scope, "asOfDate가 없습니다");
  if (!Array.isArray(institution.fieldVerification)) fail(scope, "fieldVerification이 배열이 아닙니다");

  const canvas = institution.canvas;
  if (!canvas || typeof canvas !== "object") {
    fail(scope, "canvas가 없습니다");
  } else {
    if (!canvas.stakeholders?.trim()) fail(scope, "canvas.stakeholders가 없습니다");
    if (!canvas.applicability?.trim()) fail(scope, "canvas.applicability가 없습니다");
    if (!Array.isArray(canvas.legalBasis) || canvas.legalBasis.length === 0) {
      fail(scope, "canvas.legalBasis가 없습니다");
    }
    if (!Array.isArray(canvas.procedure) || canvas.procedure.length === 0) {
      fail(scope, "canvas.procedure가 없습니다");
    }
    if (!Array.isArray(canvas.bottlenecks)) fail(scope, "canvas.bottlenecks가 배열이 아닙니다");
    if (!Array.isArray(canvas.procedurePurposes) || canvas.procedurePurposes.length === 0) {
      fail(scope, "canvas.procedurePurposes가 없습니다");
    } else {
      for (const item of canvas.procedurePurposes) {
        if (!item.step?.trim() || !item.purpose?.trim()) {
          fail(scope, "canvas.procedurePurposes 항목에는 step·purpose가 필요합니다");
        }
      }
    }
    if (!Array.isArray(canvas.partyTasks) || canvas.partyTasks.length === 0) {
      fail(scope, "canvas.partyTasks가 없습니다");
    } else {
      for (const party of canvas.partyTasks) {
        if (!party.party?.trim() || !Array.isArray(party.tasks) || party.tasks.length === 0) {
          fail(scope, "canvas.partyTasks 항목에는 party·tasks가 필요합니다");
        }
      }
    }
    if (!Array.isArray(canvas.documentsByParty) || canvas.documentsByParty.length === 0) {
      fail(scope, "canvas.documentsByParty가 없습니다");
    } else {
      for (const party of canvas.documentsByParty) {
        if (!party.party?.trim() || !Array.isArray(party.documents) || party.documents.length === 0) {
          fail(scope, "canvas.documentsByParty 항목에는 party·documents가 필요합니다");
        }
      }
    }
    for (const legacyField of ["purpose", "authorities", "moneyFlow", "docsFlow", "reformPoints"]) {
      if (canvas[legacyField] !== undefined) {
        fail(scope, `canvas.${legacyField}는 더 이상 사용하지 않습니다`);
      }
    }
  }

  for (const basis of institution.canvas?.legalBasis ?? []) {
    if (!LEGAL_KINDS.has(basis.kind)) fail(scope, `지원하지 않는 법적 근거 종류입니다 (${basis.kind})`);
  }

  if (!institution.verification) {
    fail(scope, "verification이 없습니다");
  } else {
    const verification = institution.verification;
    if (!VERIFICATION_STATUSES.has(verification.status)) {
      fail(scope, `지원하지 않는 verification status입니다 (${verification.status})`);
    }
    if (!ISO_DATE.test(verification.verifiedAt ?? "")) fail(scope, "verification.verifiedAt은 YYYY-MM-DD 형식이어야 합니다");
    if (!verification.method?.trim()) fail(scope, "verification.method가 없습니다");
    if (!verification.scope?.trim()) fail(scope, "verification.scope가 없습니다");
    if (verification.notes !== undefined && !Array.isArray(verification.notes)) {
      fail(scope, "verification.notes는 배열이어야 합니다");
    }
    if (!Array.isArray(verification.sources) || verification.sources.length === 0) {
      fail(scope, "verification.sources가 없습니다");
    } else {
      const sourceLaws = new Set();
      for (const source of verification.sources) {
        const sourceScope = `${scope}#source:${source.law ?? "unknown"}`;
        const sourceType = source.sourceType ?? "statute";
        if (sourceLaws.has(source.law)) fail(sourceScope, "법령 출처가 중복됩니다");
        sourceLaws.add(source.law);
        if (!LEGAL_KINDS.has(source.kind)) fail(sourceScope, `지원하지 않는 kind입니다 (${source.kind})`);
        if (!SOURCE_TYPES.has(sourceType)) fail(sourceScope, `지원하지 않는 sourceType입니다 (${sourceType})`);
        if (sourceType === "statute") {
          if (!/^\d{6}$/.test(source.lawId ?? "")) fail(sourceScope, "법령 lawId는 6자리 숫자여야 합니다");
          if (!/^\d+$/.test(source.mst ?? "")) fail(sourceScope, "법령 mst는 숫자여야 합니다");
          if (!ISO_DATE.test(source.promulgatedOn ?? "")) fail(sourceScope, "법령 promulgatedOn은 YYYY-MM-DD 형식이어야 합니다");
          if (!ISO_DATE.test(source.effectiveOn ?? "")) fail(sourceScope, "법령 effectiveOn은 YYYY-MM-DD 형식이어야 합니다");
        }
        if (sourceType === "admin-rule") {
          if (!/^\d+$/.test(source.adminRuleId ?? "")) fail(sourceScope, "행정규칙 adminRuleId는 숫자여야 합니다");
          if (!/^\d+$/.test(source.adminRuleSerial ?? "")) fail(sourceScope, "행정규칙 adminRuleSerial은 숫자여야 합니다");
          if (!ISO_DATE.test(source.promulgatedOn ?? "")) fail(sourceScope, "행정규칙 promulgatedOn은 YYYY-MM-DD 형식이어야 합니다");
        }
        if (sourceType === "treaty") {
          if (!/^\d+$/.test(source.treatyId ?? "")) fail(sourceScope, "조약 treatyId는 숫자여야 합니다");
          if (!/^\d+$/.test(source.treatyNumber ?? "")) fail(sourceScope, "조약 treatyNumber는 숫자여야 합니다");
          if (!ISO_DATE.test(source.effectiveOn ?? "")) fail(sourceScope, "조약 effectiveOn은 YYYY-MM-DD 형식이어야 합니다");
        }
        if (!source.officialUrl?.startsWith("https://law.go.kr/")) {
          fail(sourceScope, "officialUrl은 국가법령정보센터 HTTPS URL이어야 합니다");
        }
      }

      const unresolvedLaws = new Set();
      for (const item of verification.unresolved ?? []) {
        const unresolvedScope = `${scope}#unresolved:${item.law ?? "unknown"}`;
        if (sourceLaws.has(item.law) || unresolvedLaws.has(item.law)) {
          fail(unresolvedScope, "출처 또는 미해결 항목이 중복됩니다");
        }
        unresolvedLaws.add(item.law);
        if (!LEGAL_KINDS.has(item.kind)) fail(unresolvedScope, `지원하지 않는 kind입니다 (${item.kind})`);
        if (!UNRESOLVED_REASON_CODES.has(item.reasonCode)) {
          fail(unresolvedScope, `지원하지 않는 reasonCode입니다 (${item.reasonCode})`);
        }
        if (!item.reason?.trim()) fail(unresolvedScope, "reason이 없습니다");
        if (!item.nextStep?.trim()) fail(unresolvedScope, "nextStep이 없습니다");
      }

      const articleVerification = verification.articleVerification;
      if (!articleVerification) {
        fail(scope, "verification.articleVerification이 없습니다");
      } else {
        const articleScope = `${scope}#articleVerification`;
        if (!ISO_DATE.test(articleVerification.checkedAt ?? "")) {
          fail(articleScope, "checkedAt은 YYYY-MM-DD 형식이어야 합니다");
        }
        if (!articleVerification.method?.trim()) fail(articleScope, "method가 없습니다");
        for (const key of [
          "citationEntries",
          "explicitCitationEntries",
          "articleReferences",
          "verifiedReferences",
          "missingReferences",
          "uncheckableReferences",
        ]) {
          if (!Number.isInteger(articleVerification[key]) || articleVerification[key] < 0) {
            fail(articleScope, `${key}는 0 이상의 정수여야 합니다`);
          }
        }
        if (articleVerification.explicitCitationEntries > articleVerification.citationEntries) {
          fail(articleScope, "explicitCitationEntries가 citationEntries보다 큽니다");
        }
        if (
          articleVerification.articleReferences !==
          articleVerification.verifiedReferences +
            articleVerification.missingReferences +
            articleVerification.uncheckableReferences
        ) {
          fail(articleScope, "조문 검증 결과 합계가 articleReferences와 다릅니다");
        }
      }

      for (const basis of institution.canvas?.legalBasis ?? []) {
        if (!sourceLaws.has(basis.law) && !unresolvedLaws.has(basis.law)) {
          fail(scope, `검증 출처나 미해결 목록에 ${basis.law}이(가) 없습니다`);
        }
      }
      if (verification.status === "source-linked" && unresolvedLaws.size > 0) {
        fail(scope, "source-linked 상태에는 unresolved 항목이 없어야 합니다");
      }
      const articleIssues =
        (articleVerification?.missingReferences ?? 0) +
        (articleVerification?.uncheckableReferences ?? 0);
      if (verification.status === "article-verified" && (unresolvedLaws.size > 0 || articleIssues > 0)) {
        fail(scope, "article-verified 상태에는 미해결 출처나 조문 문제가 없어야 합니다");
      }
      if (verification.status === "needs-review" && unresolvedLaws.size === 0 && articleIssues === 0) {
        fail(scope, "needs-review 상태에는 미해결 출처나 조문 문제가 있어야 합니다");
      }
    }
  }

  const process = institution.process;
  if (!process) {
    fail(scope, "process가 없습니다");
    continue;
  }

  const portraitGroups = buildProcessLaneGroups(process.lanes, institution.slug);
  const groupedLanes = portraitGroups.flatMap((group) => group.lanes ?? []);
  if (portraitGroups.length !== Math.min(4, process.lanes.length)) {
    fail(scope, `세로형 레이아웃 묶음 수가 올바르지 않습니다 (${portraitGroups.length})`);
  }
  if (JSON.stringify(groupedLanes) !== JSON.stringify(process.lanes)) {
    fail(scope, "세로형 레이아웃의 행위자 레인 순서·구성이 원본과 다릅니다");
  }
  for (const group of portraitGroups) {
    if (!group.id?.trim() || !group.title?.trim() || !group.accent?.trim()) {
      fail(scope, "세로형 레이아웃 묶음의 id·title·accent가 누락됐습니다");
    }
  }

  const lanes = new Set(process.lanes ?? []);
  const stages = new Set(process.stages ?? []);
  const nodeIds = new Set();
  let currentCount = 0;

  for (const node of process.nodes ?? []) {
    const nodeScope = `${scope}#${node.id ?? "unknown"}`;
    if (!node.id) fail(nodeScope, "id가 없습니다");
    if (nodeIds.has(node.id)) fail(nodeScope, "node id가 중복됩니다");
    nodeIds.add(node.id);
    if (!lanes.has(node.lane)) fail(nodeScope, `정의되지 않은 lane입니다 (${node.lane})`);
    if (!stages.has(node.stage)) fail(nodeScope, `정의되지 않은 stage입니다 (${node.stage})`);
    if (!NODE_TYPES.has(node.type)) fail(nodeScope, `지원하지 않는 type입니다 (${node.type})`);
    if (!NODE_STATUSES.has(node.status)) fail(nodeScope, `지원하지 않는 status입니다 (${node.status})`);
    if (node.status === "current") currentCount += 1;
    if (node.progress !== undefined && (node.progress < 0 || node.progress > 100)) {
      fail(nodeScope, `progress 범위는 0~100입니다 (${node.progress})`);
    }
    if (node.confidence !== undefined && (node.confidence < 0 || node.confidence > 1)) {
      fail(nodeScope, `confidence 범위는 0~1입니다 (${node.confidence})`);
    }
  }

  if (currentCount !== 1) fail(scope, `current 노드는 정확히 1개여야 하지만 ${currentCount}개입니다`);

  const edgeIds = new Set();
  const adjacentNodes = new Map((process.nodes ?? []).map((node) => [node.id, new Set()]));
  const outgoingEdges = new Map((process.nodes ?? []).map((node) => [node.id, []]));
  for (const edge of process.edges ?? []) {
    const edgeScope = `${scope}#${edge.id ?? "unknown"}`;
    if (!edge.id) fail(edgeScope, "id가 없습니다");
    if (edgeIds.has(edge.id)) fail(edgeScope, "edge id가 중복됩니다");
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source)) fail(edgeScope, `source 노드가 없습니다 (${edge.source})`);
    if (!nodeIds.has(edge.target)) fail(edgeScope, `target 노드가 없습니다 (${edge.target})`);
    if (!EDGE_TYPES.has(edge.type)) fail(edgeScope, `지원하지 않는 type입니다 (${edge.type})`);
    adjacentNodes.get(edge.source)?.add(edge.target);
    adjacentNodes.get(edge.target)?.add(edge.source);
    outgoingEdges.get(edge.source)?.push(edge);
  }

  for (const node of process.nodes ?? []) {
    if (!/(이의신청|재?심사청구)$/u.test(node.name ?? "")) continue;
    if ((outgoingEdges.get(node.id) ?? []).some((edge) => edge.type === "loop")) {
      fail(
        `${scope}#${node.id}`,
        "불복 신청 노드는 심사·결정 전에 원처분으로 직접 회귀할 수 없습니다",
      );
    }
  }

  if (nodeIds.size > 0) {
    const firstNode = [...nodeIds][0];
    const visited = new Set([firstNode]);
    const queue = [firstNode];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const nodeId = queue[cursor];
      for (const neighbor of adjacentNodes.get(nodeId) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    if (visited.size !== nodeIds.size) {
      const disconnected = [...nodeIds].filter((nodeId) => !visited.has(nodeId));
      fail(scope, `업무구조도에 고립된 노드가 있습니다 (${disconnected.join(", ")})`);
    }
  }
}

if (fieldQueue) {
  const expectedFieldCount = institutions.reduce(
    (sum, { data }) => sum + data.fieldVerification.length,
    0,
  );
  const queueEntries = Array.isArray(fieldQueue.entries) ? fieldQueue.entries : [];
  if (fieldQueue.total !== expectedFieldCount || queueEntries.length !== expectedFieldCount) {
    fail(
      "field-verification-queue",
      `항목 수가 원본 ${expectedFieldCount}건과 일치하지 않습니다 (${fieldQueue.total}/${queueEntries.length})`,
    );
  }
  const queueIds = new Set();
  for (const entry of queueEntries) {
    if (queueIds.has(entry.id)) fail("field-verification-queue", `id ${entry.id}가 중복됩니다`);
    queueIds.add(entry.id);
    if (!slugs.has(entry.slug)) fail("field-verification-queue", `slug ${entry.slug}가 없습니다`);
    if (!entry.item?.trim()) fail(`field-verification-queue/${entry.id}`, "item이 없습니다");
    if (!entry.suggestedEvidence?.trim()) {
      fail(`field-verification-queue/${entry.id}`, "suggestedEvidence가 없습니다");
    }
  }
}

if (errors.length > 0) {
  console.error(`데이터 검증 실패: ${errors.length}건`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const nodeCount = institutions.reduce((sum, { data }) => sum + data.process.nodes.length, 0);
const edgeCount = institutions.reduce((sum, { data }) => sum + data.process.edges.length, 0);
console.log(`데이터 검증 성공: 제도 ${institutions.length}개, 노드 ${nodeCount}개, 연결 ${edgeCount}개`);
