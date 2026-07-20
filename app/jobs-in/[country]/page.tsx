// app/jobs-in/[country]/page.tsx
// Next.js 16 App Router — statically generated programmatic SEO pages.
// Drop into the active repo (Micro-SaaS-Starter-Kit) and adjust the import path
// to wherever you place seo-data.json (e.g. @/lib/seo-data.json or ../../../lib).
//
// This page is a SERVER COMPONENT (no "use client") so content renders in HTML
// for Google. Each page is unique (600-900 words assembled from the data file).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import seo from "@/lib/seo-data.json"; // <-- adjust path if needed
import { RescueCtaBlock } from "@/components/rescue-cta-block";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const SITE = seo._meta.site;
const countries = seo.countries;

type Params = { country: string };

function getCountry(slug: string) {
  return countries.find((c) => c.slug === slug);
}

// Pre-generate every country page at build time (SSG).
export function generateStaticParams() {
  return countries.map((c) => ({ country: c.slug }));
}

export async function generateMetadata(
  { params }: { params: Promise<Params> }
): Promise<Metadata> {
  const { country } = await params;
  const c = getCountry(country);
  if (!c) return {};
  const title = `Apply to Jobs in ${c.name} from Abroad (2026)`;
  const description = `Applying for jobs in ${c.name}? Learn the job boards, resume format and visa routes that work — and auto-apply to ${c.name} jobs with AI. Free tier available.`;
  const url = `${SITE}/jobs-in/${c.slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: "ResumeAI-Bot", type: "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { country } = await params;
  const c = getCountry(country);
  if (!c) notFound();

  const url = `${SITE}/jobs-in/${c.slug}`;
  const faq = [
    {
      q: `Do I need to speak the local language to get a job in ${c.name}?`,
      a: c.language,
    },
    {
      q: `Which job boards should I use for ${c.name}?`,
      a: `The boards that matter most are ${c.boards.join(", ")}. ResumeAI-Bot covers the major ones automatically.`,
    },
    {
      q: `Is my data safe with ResumeAI-Bot?`,
      a: `Yes. We never sell your data and you control what we send. See our data-safety FAQ for exactly what we store.`,
    },
    {
      q: `How many countries does ResumeAI-Bot support?`,
      a: `50+, including ${c.name}. You can target several at once.`,
    },
  ];

  // FAQPage + Article structured data for rich results.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: `How to Apply for Jobs in ${c.name} from Abroad (2026)`,
        about: `Job applications in ${c.name}`,
        author: { "@type": "Organization", name: "ResumeAI-Bot" },
        publisher: { "@type": "Organization", name: "ResumeAI-Bot" },
        mainEntityOfPage: url,
      },
      {
        "@type": "FAQPage",
        mainEntity: faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <>
      <SiteHeader />
      <article style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1rem", lineHeight: 1.7 }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <h1>How to Apply for Jobs in {c.name} from Abroad (2026 Guide + Auto-Apply)</h1>

      <p>
        {c.name} offers strong opportunities for skilled foreigners, especially in{" "}
        {c.sectors.slice(0, 3).join(", ")}{c.sectors.length > 3 ? " and more" : ""}. But applying
        from abroad comes with hurdles most guides skip: resume conventions differ, and the job
        boards that actually matter aren&apos;t always the ones you&apos;d expect. Here&apos;s what
        works in {c.name} — and how to apply at the volume that actually lands interviews.
      </p>

      <h2>Which job boards to use in {c.name}</h2>
      <p>
        Beyond the global giants, {c.name} relies on {c.boards.join(", ")}. Spreading applications
        across several boards — rather than relying on one — is what separates candidates who get
        interviews from those who don&apos;t. ResumeAI-Bot applies across the major boards for you,
        so you cover more ground without the manual grind.
      </p>

      <h2>Resume format for {c.name}</h2>
      <p>{c.resumeNotes} Above all, tailor your keywords to each role so you pass the applicant
        tracking system (ATS) — which is exactly what our AI does on every application.</p>

      <h2>Visa and work-permit routes</h2>
      <p>{c.visa} A practical tip: having applications already in flight before you arrive is a
        major advantage, because many employers move faster with candidates who are clearly ready.</p>

      <h2>Language</h2>
      <p>{c.language}</p>

      <h2>The volume problem (and how to solve it)</h2>
      <p>
        The single biggest mistake people make when applying to {c.name} from abroad is
        under-applying. Landing interviews in a foreign market is a numbers game: you want dozens of
        tailored applications out, not five. Doing that by hand is exhausting and slow. ResumeAI-Bot
        automates it — building a {c.name}-tuned resume and auto-applying to matching roles so you
        get more shots on goal with less effort.
      </p>

      <h2>Apply to {c.name} jobs automatically</h2>
      <p>
        Start free — {seo._meta.freeTier}. Upgrade when you see the interviews come in. Every paid
        plan includes a {seo._meta.guarantee}, so trying it is risk-free.
      </p>
      <p>
        <Link href="/?ref=seo-jobs-in" style={{ fontWeight: 600 }}>
          Start applying to {c.name} jobs free →
        </Link>
      </p>

      <RescueCtaBlock context={`a ${c.name} job`} refTag="seo-jobs-in" />

      <h2>Frequently asked questions</h2>
      {faq.map((f) => (
        <div key={f.q}>
          <h3>{f.q}</h3>
          <p>{f.a}</p>
        </div>
      ))}

      <hr style={{ margin: "2rem 0" }} />
      <p style={{ fontSize: 14 }}>
        Related:{" "}
        <Link href="/alternatives/sonara">Best Sonara alternative</Link> ·{" "}
        <Link href="/compare">Compare auto-apply tools</Link> ·{" "}
        {countries
          .filter((x) => x.region === c.region && x.slug !== c.slug)
          .slice(0, 4)
          .map((x) => (
            <Link key={x.slug} href={`/jobs-in/${x.slug}`} style={{ marginRight: 8 }}>
              Jobs in {x.name}
            </Link>
          ))}
      </p>
    </article>
      <SiteFooter />
    </>
  );
}
