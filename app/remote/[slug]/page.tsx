// app/remote/[slug]/page.tsx
// Eligibility/remote-first programmatic landing pages (D3) — the wedge incumbents ignore.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import seo from "@/lib/seo-data.json";
import { REMOTE_GUIDES, getRemoteGuide } from "@/lib/remote-guides";

const SITE = seo._meta.site;

type Params = { slug: string };

export function generateStaticParams() {
  return REMOTE_GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { slug } = await params;
  const g = getRemoteGuide(slug);
  if (!g) return {};
  const url = `${SITE}/remote/${g.slug}`;
  return {
    title: g.title,
    description: g.description,
    alternates: { canonical: url },
    openGraph: { title: g.title, description: g.description, url, siteName: "ResumeAI-Bot", type: "article" },
    twitter: { card: "summary_large_image", title: g.title, description: g.description },
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const g = getRemoteGuide(slug);
  if (!g) notFound();
  const url = `${SITE}/remote/${g.slug}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Article", headline: g.h1, mainEntityOfPage: url, author: { "@type": "Organization", name: "ResumeAI-Bot" }, publisher: { "@type": "Organization", name: "ResumeAI-Bot" } },
      { "@type": "FAQPage", mainEntity: g.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    ],
  };

  return (
    <article style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1rem", lineHeight: 1.7 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <h1>{g.h1}</h1>
      <p>{g.intro}</p>

      <h2>Who it&apos;s for</h2>
      <p>{g.forWho}</p>

      <h2>How it works</h2>
      <ul>{g.points.map((p) => <li key={p}>{p}</li>)}</ul>

      <h2>Why ResumeAI-Bot</h2>
      <p>
        Other auto-apply tools blast postings and answer &ldquo;authorized to work? — yes&rdquo; for
        everyone, so applicants get silently rejected. ResumeAI-Bot is eligibility-aware: it only
        applies to roles you can actually take, answers screening questions honestly, tailors your
        resume per role, and captures employer replies in one inbox — confirming each submission via
        the employer&apos;s ATS.
      </p>
      <p><Link href="/?ref=seo-remote" style={{ fontWeight: 600 }}>Start free — 3 applications/day →</Link></p>

      <h2>Frequently asked questions</h2>
      {g.faqs.map((f) => (<div key={f.q}><h3>{f.q}</h3><p>{f.a}</p></div>))}

      <hr style={{ margin: "2rem 0" }} />
      <p style={{ fontSize: 14 }}>
        More:{" "}
        {REMOTE_GUIDES.filter((x) => x.slug !== g.slug).slice(0, 5).map((x) => (
          <Link key={x.slug} href={`/remote/${x.slug}`} style={{ marginRight: 8 }}>{x.h1}</Link>
        ))}
        · <Link href="/pricing">Pricing →</Link>
      </p>
    </article>
  );
}
