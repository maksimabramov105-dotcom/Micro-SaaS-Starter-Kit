// app/[profession]-resume/page.tsx  (or app/resume/[profession]/page.tsx)
// Next.js 16 App Router. If you use app/resume/[profession]/page.tsx, change the
// param key below from `professionResume` to `profession` and strip the suffix.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import seo from "@/lib/seo-data.json"; // <-- adjust path

const SITE = seo._meta.site;
const professions = seo.professions;

// Using a /resume/[profession] route is cleaner. Example assumes that:
//   app/resume/[profession]/page.tsx  ->  /resume/software-engineer
type Params = { profession: string };
const get = (slug: string) => professions.find((p) => p.slug === slug);

export function generateStaticParams() {
  return professions.map((p) => ({ profession: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { profession } = await params;
  const p = get(profession);
  if (!p) return {};
  const title = `${p.name} Resume: AI Builder + Auto-Apply (2026) — ResumeAI-Bot`;
  const description = `Build an ATS-ready ${p.name} resume with AI and auto-apply to ${p.name} jobs in 50+ countries. Free tier + 30-day money-back guarantee.`;
  const url = `${SITE}/resume/${p.slug}`;
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, siteName: "ResumeAI-Bot", type: "article" }, twitter: { card: "summary_large_image", title, description } };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { profession } = await params;
  const p = get(profession);
  if (!p) notFound();
  const url = `${SITE}/resume/${p.slug}`;
  const faq = [
    { q: `What should a ${p.name} resume include?`, a: `${p.note} Include keywords like ${p.keywords.join(", ")} so it passes ATS screens.` },
    { q: `Can AI write my ${p.name} resume?`, a: `Yes — ResumeAI-Bot generates an ATS-optimized ${p.name} resume tailored to each role you apply to.` },
    { q: `Can I auto-apply to ${p.name} jobs abroad?`, a: `Yes, across 50+ countries. Start free with 3 applications/day.` },
  ];
  const jsonLd = { "@context": "https://schema.org", "@graph": [
    { "@type": "Article", headline: `${p.name} Resume + Auto-Apply`, mainEntityOfPage: url, author: { "@type": "Organization", name: "ResumeAI-Bot" }, publisher: { "@type": "Organization", name: "ResumeAI-Bot" } },
    { "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ]};
  return (
    <article style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1rem", lineHeight: 1.7 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <h1>{p.name} Resume: AI Builder + Auto-Apply (2026)</h1>
      <p>A strong {p.name} resume gets past the ATS and onto a human&apos;s desk. {p.note}</p>
      <h2>Keywords that matter for a {p.name}</h2>
      <p>Recruiters and ATS systems look for: {p.keywords.join(", ")}. ResumeAI-Bot weaves the right
        keywords into a tailored resume for every role automatically.</p>
      <h2>Build it with AI, then apply at scale</h2>
      <p>Don&apos;t hand-write a new resume for every posting. ResumeAI-Bot builds an ATS-ready {p.name}
        resume and auto-applies to matching jobs in 50+ countries — so you get more interviews with
        far less effort.</p>
      <h2>Start free</h2>
      <p>{seo._meta.freeTier}. Paid plans include a {seo._meta.guarantee}.</p>
      <p><Link href="/?ref=seo-profession" style={{ fontWeight: 600 }}>Build your {p.name} resume free →</Link></p>
      <h2>Frequently asked questions</h2>
      {faq.map((f) => (<div key={f.q}><h3>{f.q}</h3><p>{f.a}</p></div>))}
      <hr style={{ margin: "2rem 0" }} />
      <p style={{ fontSize: 14 }}>More roles: {professions.filter((x) => x.slug !== p.slug).slice(0, 6).map((x) => (<Link key={x.slug} href={`/resume/${x.slug}`} style={{ marginRight: 8 }}>{x.name}</Link>))}</p>
    </article>
  );
}
