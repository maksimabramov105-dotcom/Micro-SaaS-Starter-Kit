/**
 * /dashboard/admin/flags
 *
 * Admin UI for feature flags and A/B experiment status.
 * Gated to role === 'admin' (same as /dashboard/admin).
 * Uses Server Actions for toggle/update — no separate API routes needed.
 */

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getAllFlags, setFlag, invalidateFlagCache } from '@/lib/flags'
import { getExperimentStats } from '@/lib/experiments'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// ── Server Actions ────────────────────────────────────────────────────────────

async function toggleFlag(formData: FormData) {
  'use server'
  const key = formData.get('key') as string
  const enabled = formData.get('enabled') === '1'
  const rolloutPct = Math.max(0, Math.min(100, Number(formData.get('rolloutPct')) || 0))
  await setFlag(key, !enabled, rolloutPct)
  revalidatePath('/dashboard/admin/flags')
}

async function updateRollout(formData: FormData) {
  'use server'
  const key = formData.get('key') as string
  const enabled = formData.get('enabled') === '1'
  const rolloutPct = Math.max(0, Math.min(100, Number(formData.get('rolloutPct')) || 0))
  await setFlag(key, enabled, rolloutPct)
  revalidatePath('/dashboard/admin/flags')
}

async function bustCache() {
  'use server'
  invalidateFlagCache()
  revalidatePath('/dashboard/admin/flags')
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function FlagsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user || session.user.role !== 'admin') redirect('/dashboard')

  const [flags, expStats] = await Promise.all([
    getAllFlags(),
    getExperimentStats(),
  ])

  return (
    <div className="container mx-auto max-w-5xl py-8 px-4 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Feature Flags & Experiments</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Changes take effect within 5 min (TTL cache). Use "Bust cache" for instant effect.
          </p>
        </div>
        <form action={bustCache}>
          <button
            type="submit"
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            Bust cache
          </button>
        </form>
      </div>

      {/* ── Feature Flags ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Feature Flags</CardTitle>
          <CardDescription>Toggle features on/off and set gradual rollout %.</CardDescription>
        </CardHeader>
        <CardContent>
          {flags.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No flags found. Run{' '}
              <code className="rounded bg-muted px-1 text-xs">npm run db:seed-experiments</code>.
            </p>
          ) : (
            <div className="divide-y">
              {flags.map((flag) => (
                <div key={flag.key} className="flex items-center gap-4 py-3">
                  {/* Toggle */}
                  <form action={toggleFlag}>
                    <input type="hidden" name="key" value={flag.key} />
                    <input type="hidden" name="enabled" value={flag.enabled ? '1' : '0'} />
                    <input type="hidden" name="rolloutPct" value={flag.rolloutPct} />
                    <button
                      type="submit"
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        flag.enabled ? 'bg-primary' : 'bg-muted-foreground/30'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          flag.enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </form>

                  {/* Label */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono font-medium truncate">{flag.key}</p>
                    {flag.description && (
                      <p className="text-xs text-muted-foreground truncate">{flag.description}</p>
                    )}
                  </div>

                  {/* Rollout % */}
                  <form action={updateRollout} className="flex items-center gap-2">
                    <input type="hidden" name="key" value={flag.key} />
                    <input type="hidden" name="enabled" value={flag.enabled ? '1' : '0'} />
                    <input
                      type="number"
                      name="rolloutPct"
                      min={0}
                      max={100}
                      defaultValue={flag.rolloutPct}
                      className="w-16 rounded border px-2 py-1 text-sm text-right"
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                    <button
                      type="submit"
                      className="rounded border px-2 py-1 text-xs hover:bg-muted transition-colors"
                    >
                      Save
                    </button>
                  </form>

                  <Badge variant={flag.enabled ? 'default' : 'secondary'}>
                    {flag.enabled ? 'ON' : 'OFF'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Experiments ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Experiments</CardTitle>
          <CardDescription>
            Assignment counts per variant. Run the results script for significance testing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {expStats.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No experiments found. Run{' '}
              <code className="rounded bg-muted px-1 text-xs">npm run db:seed-experiments</code>.
            </p>
          ) : (
            <div className="divide-y">
              {expStats.map(({ experiment: exp, variantCounts, total }) => (
                <div key={exp.key} className="py-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-mono font-medium">{exp.key}</span>
                    <Badge variant={exp.active ? 'default' : 'secondary'}>
                      {exp.active ? 'active' : 'ended'}
                    </Badge>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {total.toLocaleString()} total assignments
                    </span>
                  </div>
                  {exp.description && (
                    <p className="text-xs text-muted-foreground mb-2">{exp.description}</p>
                  )}
                  <div className="flex gap-3 flex-wrap">
                    {exp.variants.map((v: string, i: number) => {
                      const count = variantCounts[v] ?? 0
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0
                      return (
                        <div
                          key={v}
                          className="rounded-lg border px-3 py-2 text-center min-w-[100px]"
                        >
                          <p className="text-xs text-muted-foreground font-mono">{v}</p>
                          <p className="text-xl font-bold">{count.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">
                            {pct}% · target {exp.weights[i]}%
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        To analyze conversion significance:{' '}
        <code className="rounded bg-muted px-1">
          npx tsx scripts/experiment_results.ts &lt;experiment_key&gt;
        </code>
      </p>
    </div>
  )
}
