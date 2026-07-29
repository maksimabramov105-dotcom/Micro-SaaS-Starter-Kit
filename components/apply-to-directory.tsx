'use client'

/**
 * components/apply-to-directory.tsx — interactive company directory (G1).
 *
 * A client island imported by the server-rendered /apply-to hub. The full
 * company list is rendered on the server (crawlers get every link in the
 * HTML); this component adds a search box, an ATS filter, and sort-by-open-
 * roles on top of that same data. No data fetching happens here.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'

export interface DirectoryCompany {
  slug: string
  name: string
  ats: string
  atsName: string
  openRoles: number
}

type SortKey = 'roles' | 'name'

export function ApplyToDirectory({ companies }: { companies: DirectoryCompany[] }) {
  const [query, setQuery] = useState('')
  const [ats, setAts] = useState<string>('all')
  const [sort, setSort] = useState<SortKey>('roles')

  const atsOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of companies) if (!seen.has(c.ats)) seen.set(c.ats, c.atsName)
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [companies])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = companies.filter(
      (c) => (ats === 'all' || c.ats === ats) && (q === '' || c.name.toLowerCase().includes(q)),
    )
    filtered.sort((a, b) =>
      sort === 'roles' ? b.openRoles - a.openRoles || a.name.localeCompare(b.name) : a.name.localeCompare(b.name),
    )
    return filtered
  }, [companies, query, ats, sort])

  const btn = (active: boolean): React.CSSProperties => ({
    border: '1px solid #ccc',
    borderRadius: 999,
    padding: '0.25rem 0.75rem',
    fontSize: 14,
    cursor: 'pointer',
    background: active ? '#4f46e5' : '#fff',
    color: active ? '#fff' : '#333',
  })

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '1rem 0' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search companies…"
          aria-label="Search companies"
          style={{ flex: '1 1 220px', padding: '0.5rem 0.75rem', border: '1px solid #ccc', borderRadius: 8, fontSize: 15 }}
        />
        <button type="button" style={btn(sort === 'roles')} onClick={() => setSort('roles')}>
          Most open roles
        </button>
        <button type="button" style={btn(sort === 'name')} onClick={() => setSort('name')}>
          A–Z
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '1rem' }}>
        <button type="button" style={btn(ats === 'all')} onClick={() => setAts('all')}>
          All ATS
        </button>
        {atsOptions.map(([value, label]) => (
          <button key={value} type="button" style={btn(ats === value)} onClick={() => setAts(value)}>
            {label}
          </button>
        ))}
      </div>

      <p style={{ fontSize: 14, color: '#666' }}>
        {shown.length} {shown.length === 1 ? 'company' : 'companies'}
      </p>

      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 6 }}>
        {shown.map((c) => (
          <li key={c.slug} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <Link href={`/apply-to/${c.slug}`}>How to apply to {c.name}</Link>
            <span style={{ color: '#666', fontSize: 14, whiteSpace: 'nowrap' }}>
              {c.atsName} · {c.openRoles} open
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
