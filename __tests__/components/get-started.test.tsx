/**
 * First-run panel (P4.2).
 *
 * The ways an onboarding checklist fails: it stays up after you have onboarded
 * (so people learn to scroll past it), it shows every CTA at once (so it answers
 * "what do I do?" with "pick one"), or it contains a step that can never become
 * the current one because a sibling marks itself done at the same time. All
 * three are tested here, plus the rule that we never link to a Chrome Web Store
 * listing that does not exist yet.
 */
import { render, screen } from '@testing-library/react'
import { GetStarted } from '@/components/get-started'

const base = { resumes: 0, applications: 0, campaigns: 0, extensionUrl: '' }
const STORE = 'https://chromewebstore.google.com/detail/abc'

/** The step CTA is the only emerald button; the fit-check link is always there. */
function currentCta() {
  return screen.getAllByRole('link').find((a) => a.textContent?.includes('→'))
}

describe('GetStarted', () => {
  it('renders nothing once the user has a resume and an application', () => {
    const { container } = render(<GetStarted {...base} resumes={1} applications={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('still shows while a resume exists but nothing has been applied to', () => {
    render(<GetStarted {...base} resumes={1} />)
    expect(screen.getByText(/Get your first tailored application out/)).toBeInTheDocument()
  })

  it('offers exactly one step CTA at a time', () => {
    render(<GetStarted {...base} />)
    expect(screen.getAllByRole('link').filter((a) => a.textContent?.includes('→'))).toHaveLength(1)
  })

  it('points a brand-new user at importing a resume first', () => {
    render(<GetStarted {...base} />)
    expect(currentCta()).toHaveAttribute('href', '/dashboard/resumes/new')
  })

  it('advances to setting up applying once a resume exists', () => {
    render(<GetStarted {...base} resumes={1} />)
    expect(currentCta()).toHaveAttribute('href', '/dashboard/campaigns/new')
  })

  it('advances to the ledger once a campaign is running but nothing has landed', () => {
    // This is the state that catches a step marked done by a sibling's
    // condition: every step must be reachable as the current one.
    render(<GetStarted {...base} resumes={1} campaigns={1} />)
    expect(currentCta()).toHaveAttribute('href', '/proof')
  })

  it('offers the extension instead once there is a listing to link to', () => {
    render(<GetStarted {...base} resumes={1} extensionUrl={STORE} />)
    expect(currentCta()).toHaveAttribute('href', STORE)
  })

  it('never mentions the extension while it is unpublished', () => {
    render(<GetStarted {...base} resumes={1} />)
    expect(screen.queryByText(/Chrome extension/)).not.toBeInTheDocument()
  })

  it('ticks completed steps rather than hiding them', () => {
    render(<GetStarted {...base} resumes={1} />)
    expect(screen.getByText('Add your resume')).toBeInTheDocument()
    expect(screen.getAllByText('✓').length).toBe(1)
  })

  it('always offers the free fit check, at every stage', () => {
    for (const props of [base, { ...base, resumes: 1 }, { ...base, resumes: 1, campaigns: 1 }]) {
      const { unmount } = render(<GetStarted {...props} />)
      expect(screen.getByText('free fit check')).toHaveAttribute('href', '/ats-check')
      unmount()
    }
  })

  it('sets the ATS-confirmation expectation before the user applies', () => {
    render(<GetStarted {...base} />)
    expect(
      screen.getByText(/only ever call one confirmed when the ATS says so/),
    ).toBeInTheDocument()
  })
})
