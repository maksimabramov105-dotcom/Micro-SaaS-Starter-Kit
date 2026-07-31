import { exposureScript, variantScript, type AbConfig, type VariantSwaps } from '@/lib/ab'

/**
 * components/ab-script.tsx — the two inline scripts every client-assigned A/B
 * test needs. See lib/ab.ts for why they are inline strings and not React.
 *
 * Both render nothing at all when the test is off: no dead script tag, no
 * beacon, and no cookie set on a page that is not running an experiment.
 */

export function VariantScript({
  config,
  experimentKey,
  cookieName,
  swaps,
}: {
  config: AbConfig
  experimentKey: string
  cookieName: string
  swaps: VariantSwaps
}) {
  if (!config.active) return null
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: variantScript({ experimentKey, cookieName, pct: config.pct, swaps }),
      }}
    />
  )
}

export function ExposureBeacon({
  config,
  experimentKey,
  page,
}: {
  config: AbConfig
  experimentKey: string
  page: string
}) {
  if (!config.active) return null
  return (
    <script dangerouslySetInnerHTML={{ __html: exposureScript({ experimentKey, page }) }} />
  )
}
