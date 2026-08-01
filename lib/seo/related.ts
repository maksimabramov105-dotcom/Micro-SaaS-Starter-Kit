/**
 * lib/seo/related.ts — pick the "related pages" block for a generated page.
 *
 * WHY THIS EXISTS: every template did `list.filter(notMe).slice(0, 6)`, which
 * always returns the FIRST six siblings in list order. So the alphabetically
 * earliest pages collected every sibling link and everyone else got none —
 * 135 of 168 /apply-to pages (80%) had exactly one inbound internal link, the
 * hub. A page reachable only from the sitemap and one hub gets crawled late and
 * ranks poorly, which defeats the point of generating it.
 *
 * A rotating window fixes the distribution without any randomness: page i links
 * the `count` items that follow it, wrapping at the end. Every item therefore
 * appears in exactly `count` other pages' blocks — uniform by construction, and
 * deterministic, so the same page always renders the same links and the build
 * output stays stable.
 */

/**
 * The `count` items following `index`, wrapping around, excluding the item at
 * `index` itself. Returns everything else when the list is smaller than count+1.
 */
export function relatedWindow<T>(items: readonly T[], index: number, count: number): T[] {
  const n = items.length
  if (n <= 1) return []
  const take = Math.min(count, n - 1)
  const out: T[] = []
  for (let step = 1; step <= take; step++) {
    out.push(items[(index + step) % n])
  }
  return out
}

/**
 * Same, keyed by a slug rather than an index — convenient at call sites that
 * only hold the current item.
 *
 * An unknown slug falls back to index 0 rather than throwing: a missing related
 * block is a small SEO loss, a 500 on a public page is not.
 */
export function relatedBySlug<T extends { slug: string }>(
  items: readonly T[],
  slug: string,
  count: number,
): T[] {
  const i = items.findIndex((x) => x.slug === slug)
  return relatedWindow(items, i < 0 ? 0 : i, count)
}
