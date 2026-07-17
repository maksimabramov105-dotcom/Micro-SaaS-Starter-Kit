// app/auto-apply/[board]/page.tsx — Next.js 16 App Router
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import seo from "@/lib/seo-data.json"; // <-- adjust path

const SITE = seo._meta.site;
const boards = seo.jobBoards;
type Params = { board: string };
const get = (slug: string) => boards.find((b) => b.slug === slug);

export function generateStaticParams() {
  return boards.map((b) => ({ board: b.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { board } = await params;
  const b = get(board);
  if (!b) return {};
  const title = `Auto-Apply to Jobs on ${b.name} with AI (2026) — ResumeAI-Bot`;
  const description = `Automatically apply to ${b.name} jobs with an AI-tailored resume. ResumeAI-Bot covers ${b.name} and 50+ countries. Free tier + 30-day money-back guarantee.`;
  const url = `${SITE}/auto-apply/${b.slug}`;
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, siteName: "ResumeAI-Bot", type: "article" }, twitter: { card: "summary_large_image", title, description } };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { board } = await params;
  const b = get(board);
  if (!b) notFound();
  const url = `${SITE}/auto-apply/${b.slug}`;
  const faq = [
    { q: `Can I auto-apply to ${b.name} jobs?`, a: `Yes. ResumeAI-Bot tailors your resume per role and applies to matching ${b.name} listings for you.` },
    { q: `Is auto-applying to ${b.name} safe?`, a: `We apply on your behalf using the information you approve, and we never sell your data. See our data-safety FAQ.` },
    { q: `Is ${b.name} included for free?`, a: b.tier === "Free" ? `Yes — ${b.name} is included on the free plan.` : `${b.name} is available on the Pro plan; the free plan includes Adzuna and RemoteOK.` },
  ];
  const jsonLd = { "@context": "https://schema.org", "@graph": [
    { "@type": "Article", headline: `Auto-Apply to ${b.name} Jobs with AI`, mainEntityOfPage: url, author: { "@type": "Organization", name: "ResumeAI-Bot" }, publisher: { "@type": "Organization", name: "ResumeAI-Bot" } },
    { "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ]};
  return (
    <article style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1rem", lineHeight: 1.7 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <h1>Auto-Apply to Jobs on {b.name} with AI (2026)</h1>
      <p>{b.note} Applying manually to {b.name} listings one by one is slow — ResumeAI-Bot does it for you, tailoring your resume to each role so you stay relevant while covering far more ground.</p>
      <h2>How it works</h2>
      <p>Connect your profile, set your target roles and countries, and ResumeAI-Bot finds matching {b.name} listings, generates a per-role resume, and applies. You stay in control of what gets sent.</p>
      <h2>Why volume + targeting wins</h2>
      <p>Interviews are a numbers game. A tailored resume sent to dozens of {b.name} roles beats a perfect one sent to five. Automation lets you do both: high volume <em>and</em> per-role tailoring.</p>
      <h2>Start free</h2>
      <p>{seo._meta.freeTier}. Paid plans add a {seo._meta.guarantee}.</p>
      <p><Link href="/?ref=seo-board" style={{ fontWeight: 600 }}>Auto-apply to {b.name} jobs free →</Link></p>
      <RescueCtaBlock context={`a ${b.name} posting`} refTag="seo-board" />

      <h2>Frequently asked questions</h2>
      {faq.map((f) => (<div key={f.q}><h3>{f.q}</h3><p>{f.a}</p></div>))}
      <hr style={{ margin: "2rem 0" }} />
      <p style={{ fontSize: 14 }}>More: {boards.filter((x) => x.slug !== b.slug).slice(0, 5).map((x) => (<Link key={x.slug} href={`/auto-apply/${x.slug}`} style={{ marginRight: 8 }}>Auto-apply {x.name}</Link>))}</p>
    </article>
  );
}
