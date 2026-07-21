import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getAllSlugs,
  getInstitution,
  getInstitutionSummaries,
} from "@/lib/data";
import InstitutionDetailView from "@/components/InstitutionDetailView";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://how-did-they-do-all-that-procurement.dali-n-narumi.workers.dev";

export async function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const institution = getInstitution(slug);
  if (!institution) return { title: "제도 100" };
  return {
    title: institution.name,
    description: institution.oneLiner,
    alternates: { canonical: `${SITE_URL}/model/${institution.slug}/` },
    openGraph: {
      title: `${institution.name} — 그 많던 조달은 어떻게 했을까`,
      description: institution.oneLiner,
      type: "article",
      url: `${SITE_URL}/model/${institution.slug}/`,
      images: [
        {
          url: `${SITE_URL}/og-default.png`,
          width: 1200,
          height: 630,
          alt: "그 많던 조달은 어떻게 했을까",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${institution.name} — 그 많던 조달은 어떻게 했을까`,
      description: institution.oneLiner,
      images: [`${SITE_URL}/og-default.png`],
    },
  };
}

export default async function ModelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const institution = getInstitution(slug);
  if (!institution) notFound();

  const institutions = getInstitutionSummaries();
  const relatedSlugs = new Map(
    institutions.map((item) => [item.name, item.slug]),
  );
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: institution.name,
    description: institution.oneLiner,
    dateModified: institution.asOfDate,
    inLanguage: "ko-KR",
    isPartOf: {
      "@type": "CollectionPage",
      name: "그 많던 조달은 어떻게 했을까",
      url: `${SITE_URL}/`,
    },
    about: institution.canvas.legalBasis.map((basis) => basis.law),
    url: `${SITE_URL}/model/${institution.slug}/`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <InstitutionDetailView
        institution={institution}
        institutions={institutions}
        relatedSlugs={relatedSlugs}
      />
    </>
  );
}
