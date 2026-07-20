// 제도 요약본(InstitutionSummary 배열) 생성.
//
// lib/data.ts는 process.cwd() 기준으로 data/institutions/*.json 을 런타임에 읽는다.
// 로컬·정적 빌드에서는 문제없지만 Cloudflare Worker에는 파일시스템이 없어 빈 배열이
// 돌아오고, 그 결과 제도 목록이 통째로 비어 보인다.
//
// 그래서 목록에 필요한 요약 필드만 빌드 타임에 뽑아 파일로 만들고, lib/data.ts가
// 이것을 정적 import 한다. 제도 원본 전체(4.4MB)를 번들에 넣으면 Worker 상한
// (무료 3 MiB)을 넘기 때문에 요약본만 넣는다.
//
// ⚠️ 아래 필드 계산은 src/lib/data.ts 의 toInstitutionSummary() 와 정확히 같아야 한다.
//    그쪽을 고치면 여기도 함께 고칠 것.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(WEB_DIR, "data", "institutions");
const MANIFEST_PATH = path.join(WEB_DIR, "..", "docs", "institutions-100-manifest.json");
const OUT_FILE = path.join(WEB_DIR, "data", "summaries.json");

// getAllInstitutions()의 category 보정과 동일하게, 매니페스트로 빈 category를 채운다.
const categoryBySlug = new Map();
if (fs.existsSync(MANIFEST_PATH)) {
  try {
    for (const entry of JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))) {
      if (entry.slug && entry.category) categoryBySlug.set(entry.slug, entry.category);
    }
  } catch {
    // 매니페스트가 깨져도 제도 파일의 category로 대체된다.
  }
}

const summaries = fs
  .readdirSync(DATA_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => {
    const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
    const category = d.category ?? categoryBySlug.get(d.slug) ?? "기타";
    const article = d.verification?.articleVerification;
    const nodes = d.process?.nodes ?? [];

    return {
      slug: d.slug,
      name: d.name,
      oneLiner: d.oneLiner,
      type: d.type,
      priority: d.priority,
      category,
      asOfDate: d.asOfDate,
      processNodeCount: nodes.length,
      processStageCount: d.process?.stages?.length ?? 0,
      processLaneCount: d.process?.lanes?.length ?? 0,
      processGatewayCount: nodes.filter((node) => node.type === "gateway").length,
      legalBasisCount: d.canvas.legalBasis.length,
      fieldVerificationCount: d.fieldVerification.length,
      bottleneckCount: d.canvas.bottlenecks.length,
      verificationStatus: d.verification?.status,
      verifiedReferences: article?.verifiedReferences ?? 0,
      articleReferences: article?.articleReferences ?? 0,
      sourceCount: d.verification?.sources?.length ?? 0,
      laws: d.canvas.legalBasis.map((basis) => basis.law),
    };
  })
  .sort((a, b) => a.priority - b.priority);

fs.writeFileSync(OUT_FILE, JSON.stringify(summaries) + "\n");
console.log(
  `제도 요약본 생성: ${summaries.length}개, ${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)}KB → data/summaries.json`,
);

// 카테고리 표시 순서. getCategoryOrder()도 매니페스트를 런타임에 읽어서 Worker에서
// 빈 배열이 되고, 그러면 목록이 분류 없이 한 덩어리로 렌더링된다(실제로 그랬다).
const categoryOrder = [];
const seen = new Set();
if (fs.existsSync(MANIFEST_PATH)) {
  for (const entry of JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))) {
    if (entry.category && !seen.has(entry.category)) {
      seen.add(entry.category);
      categoryOrder.push(entry.category);
    }
  }
}
const ORDER_FILE = path.join(WEB_DIR, "data", "category-order.json");
fs.writeFileSync(ORDER_FILE, JSON.stringify(categoryOrder) + "\n");
console.log(`카테고리 순서 생성: ${categoryOrder.length}개 → data/category-order.json`);

// 현장 검증 대장(/verification 페이지). 같은 이유로 디스크 대신 번들에 심는다.
const QUEUE_SRC = path.join(WEB_DIR, "..", "docs", "field-verification-queue.json");
const QUEUE_OUT = path.join(WEB_DIR, "data", "field-verification-queue.json");
if (fs.existsSync(QUEUE_SRC)) {
  fs.copyFileSync(QUEUE_SRC, QUEUE_OUT);
  console.log(
    `현장 검증 대장 복사: ${(fs.statSync(QUEUE_OUT).size / 1024).toFixed(1)}KB → data/field-verification-queue.json`,
  );
}
