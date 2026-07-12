import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data", "institutions");
const MANIFEST_PATH = path.join(ROOT, "..", "docs", "institutions-100-manifest.json");
const OUTPUT_DIR = path.join(ROOT, "public", "data");

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const categoryBySlug = new Map(
  manifest.map((entry) => [entry.slug, entry.category])
);
const searchIndex = {};
const comparisonIndex = {};

for (const file of fs.readdirSync(DATA_DIR).filter((name) => name.endsWith(".json"))) {
  const institution = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, file), "utf8")
  );
  const category = institution.category ?? categoryBySlug.get(institution.slug) ?? "기타";
  const processTerms = (institution.process?.nodes ?? []).flatMap((node) => [
    node.name,
    node.actor,
    node.action ?? "",
    node.blocker ?? "",
    ...(node.input_documents ?? []),
    ...(node.output_documents ?? []),
    ...(node.legal_basis ?? []).flatMap((basis) => [
      basis.law,
      basis.article,
      basis.text ?? "",
    ]),
  ]);
  const procedurePurposeTerms = institution.canvas.procedurePurposes.flatMap(
    (item) => [item.step, item.purpose]
  );
  const partyTaskTerms = institution.canvas.partyTasks.flatMap((party) => [
    party.party,
    ...party.tasks,
  ]);
  const documentTerms = institution.canvas.documentsByParty.flatMap((party) => [
    party.party,
    ...party.documents,
  ]);
  const legalBasisNames = institution.canvas.legalBasis.map((basis) => basis.law);
  const legalBasisTerms = institution.canvas.legalBasis.flatMap((basis) => [
    basis.law,
    basis.articles ?? "",
    basis.kind,
  ]);

  searchIndex[institution.slug] = [
    institution.name,
    institution.oneLiner,
    institution.type,
    category,
    institution.canvas.stakeholders,
    institution.canvas.applicability,
    ...procedurePurposeTerms,
    ...partyTaskTerms,
    ...documentTerms,
    ...legalBasisTerms,
    ...institution.canvas.bottlenecks,
    ...processTerms,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ko");

  const submittedDocuments = institution.canvas.documentsByParty
    .map((party) => `${party.party}: ${party.documents.join("·")}`)
    .join(" / ");

  comparisonIndex[institution.slug] = {
    slug: institution.slug,
    stakeholders: institution.canvas.stakeholders,
    partyNames: institution.canvas.partyTasks.map((party) => party.party),
    legalBasisNames,
    applicability: institution.canvas.applicability,
    submittedDocuments,
    keyBottlenecks: institution.canvas.bottlenecks.slice(0, 3),
  };
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(
  path.join(OUTPUT_DIR, "catalog-search.json"),
  JSON.stringify(searchIndex)
);
fs.writeFileSync(
  path.join(OUTPUT_DIR, "catalog-compare.json"),
  JSON.stringify(comparisonIndex)
);

console.log(
  `카탈로그 자산 생성: 검색 ${Object.keys(searchIndex).length}개, 비교 ${Object.keys(comparisonIndex).length}개`
);
