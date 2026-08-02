/**
 * Exit-intent capture (T3).
 *
 * Exit-intent is the most abused pattern on the web, so the constraints ARE the
 * feature and they are what these tests pin down: once per visitor ever, desktop
 * only, a real close button, and no second ask. If it stops earning its place on
 * those terms it should be deleted rather than loosened — so a change that
 * loosens them should fail here first.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ExitIntent } from '@/components/exit-intent'

/** Simulate the pointer leaving through the top edge of the viewport. */
function leaveViaTop() {
  fireEvent.mouseOut(document, { clientY: 0, relatedTarget: null })
}

const desktop = () => {
  window.matchMedia = ((q: string) => ({
    matches: q.includes('hover: hover'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia
}

const touch = () => {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia
}

/**
 * The capture itself belongs to the caller now — the modal hands the address to
 * onCapture instead of posting /api/lead, because /api/lead recorded a row and
 * sent nothing while this modal said "check your inbox".
 */
let capture: jest.Mock

const show = (props: Partial<React.ComponentProps<typeof ExitIntent>> = {}) =>
  render(<ExitIntent source="ats-check" onCapture={capture} {...props} />)

/** Fill the address and tick consent — the two things a real capture needs. */
function fillAndSubmit(email = 'a@b.co', { withConsent = true } = {}) {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: email } })
  if (withConsent) fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: /send it/i }))
}

/** Analytics beacons fired at /api/analytics/event, by name. */
const beacons = () =>
  (global.fetch as jest.Mock).mock.calls
    .filter(([url]) => url === '/api/analytics/event')
    .map(([, init]) => JSON.parse(init.body).event)

beforeEach(() => {
  localStorage.clear()
  desktop()
  capture = jest.fn().mockResolvedValue(true)
  global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
})

it('stays hidden until the pointer leaves through the top', () => {
  show()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  leaveViaTop()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('ignores the pointer leaving sideways or downward', () => {
  // Moving toward the dock or another window is not an exit signal.
  show()
  fireEvent.mouseOut(document, { clientY: 400, relatedTarget: null })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('ignores a mouseout that is really a move between elements', () => {
  show()
  fireEvent.mouseOut(document, { clientY: 0, relatedTarget: document.createElement('div') })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('never fires twice for the same visitor', () => {
  const first = show()
  leaveViaTop()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  first.unmount()

  show()
  leaveViaTop()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('records "seen" when it opens, not when it is dismissed', () => {
  // Otherwise closing the tab mid-modal resurrects it on the next visit.
  show()
  leaveViaTop()
  expect(localStorage.getItem('rai_exit_intent_seen')).toBe('1')
})

it('never fires on touch devices', () => {
  touch()
  show()
  leaveViaTop()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('stays silent when localStorage is unavailable', () => {
  // Without a readable flag we cannot honour "once", so we do not show it at all.
  const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  show()
  leaveViaTop()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  spy.mockRestore()
})

it('does not arm at all when disabled', () => {
  show({ enabled: false })
  leaveViaTop()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(localStorage.getItem('rai_exit_intent_seen')).toBeNull()
})

describe('the way out is real', () => {
  it('has a labelled close button that actually closes', () => {
    show()
    leaveViaTop()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on Escape', () => {
    show()
    leaveViaTop()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on a backdrop click', () => {
    show()
    leaveViaTop()
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not re-ask after being dismissed', () => {
    show()
    leaveViaTop()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    leaveViaTop()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('carries no countdown or scarcity language', () => {
    show()
    leaveViaTop()
    const text = screen.getByRole('dialog').textContent ?? ''
    expect(text).not.toMatch(/hurry|expires|last chance|only \d+ left|don't miss|act now/i)
  })
})

describe('capture', () => {
  it('hands the address to the caller rather than posting a lead endpoint', async () => {
    show({ source: 'ats-check-exit' })
    leaveViaTop()
    fillAndSubmit('a@b.co')

    await waitFor(() => expect(capture).toHaveBeenCalledWith('a@b.co'))
    // The old path. It stored a row, sent nothing, and skipped the suppression
    // list — while this modal promised the report was on its way.
    const posted = (global.fetch as jest.Mock).mock.calls.map(([url]) => url)
    expect(posted).not.toContain('/api/lead')
  })

  it('only says the report is coming when the capture says it is', async () => {
    show()
    leaveViaTop()
    fillAndSubmit()
    await waitFor(() => expect(screen.getByText(/on its way/i)).toBeInTheDocument())
  })

  it('does not claim delivery when the capture fails', async () => {
    capture.mockResolvedValue(false)
    show()
    leaveViaTop()
    fillAndSubmit()
    await waitFor(() => expect(screen.getByText(/nothing is lost/i)).toBeInTheDocument())
    expect(screen.queryByText(/on its way/i)).not.toBeInTheDocument()
  })

  it('survives a capture that throws', async () => {
    capture.mockRejectedValue(new Error('network'))
    show()
    leaveViaTop()
    fillAndSubmit()
    await waitFor(() => expect(screen.getByText(/nothing is lost/i)).toBeInTheDocument())
  })

  it('requires explicit consent, exactly as the on-page form does', async () => {
    show()
    leaveViaTop()
    expect(screen.getByRole('button', { name: /send it/i })).toBeDisabled()
    fillAndSubmit('a@b.co', { withConsent: false })
    expect(capture).not.toHaveBeenCalled()
  })

  it('consent is opt-in — never pre-ticked', () => {
    show()
    leaveViaTop()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })
})

describe('measurement', () => {
  it('records being shown, so the capture rate has a denominator', () => {
    show({ source: 'ats-check-exit' })
    leaveViaTop()
    expect(beacons()).toContain('exit_intent_shown')
  })

  it('records a capture only after one actually happened', async () => {
    show()
    leaveViaTop()
    expect(beacons()).not.toContain('exit_intent_captured')
    fillAndSubmit()
    await waitFor(() => expect(beacons()).toContain('exit_intent_captured'))
  })

  it('does not record a capture that failed', async () => {
    capture.mockResolvedValue(false)
    show()
    leaveViaTop()
    fillAndSubmit()
    await waitFor(() => expect(screen.getByText(/nothing is lost/i)).toBeInTheDocument())
    expect(beacons()).not.toContain('exit_intent_captured')
  })

  it('a blocked analytics beacon never breaks the modal', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValue(new Error('blocked'))
    show()
    leaveViaTop()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fillAndSubmit()
    await waitFor(() => expect(screen.getByText(/on its way/i)).toBeInTheDocument())
  })
})
