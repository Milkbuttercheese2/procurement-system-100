import { Suspense } from "react";
import { getInstitutionSummaries, getCategoryOrder } from "@/lib/data";
import RegistryCatalog from "@/components/RegistryCatalog";
import SiteHero from "@/components/SiteHero";

export default function HomePage() {
  const institutions = getInstitutionSummaries();
  const categoryOrder = getCategoryOrder();
  const asOfDate = institutions.reduce(
    (latest, institution) =>
      institution.asOfDate > latest ? institution.asOfDate : latest,
    "",
  );

  return (
    <>
      <SiteHero institutionCount={institutions.length} asOfDate={asOfDate} />
      <Suspense fallback={<CatalogFallback />}>
        <RegistryCatalog
          institutions={institutions}
          categoryOrder={categoryOrder}
        />
      </Suspense>
    </>
  );
}

function CatalogFallback() {
  return (
    <section aria-label="제도 대장 불러오는 중">
      <div className="explorer-loading">
        제도 카탈로그를 불러오는 중입니다.
      </div>
    </section>
  );
}
