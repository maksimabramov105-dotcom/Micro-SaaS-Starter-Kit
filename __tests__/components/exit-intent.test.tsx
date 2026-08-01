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

beforeEach(() => {
  localStorage.clear()
  desktop()
  global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
})

it('stays hidden until the pointer leaves through the top', () => {
  render(<ExitIntent source="ats-check" />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  leaveViaTop()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('ignores the pointer leaving sideways or downward', () => {
  // Moving toward the dock or another window is not an exit signal.
  render(<ExitIntent source="ats-check" />)
  fireEvent.mouseOut(document, { clientY: 400, relatedTarget: null })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('ignores a mouseout that is really a move between elements', () => {
  render(<ExitIntent source="ats-check" />)
  fireEvent.mouseOut(document, { clientY: 0, relatedTarget: document.createElement('div') })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('never fires twice for the same visitor', () => {
  const first = render(<ExitIntent source="ats-check" />)
  leaveViaTop()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  first.unmount()

  render(<ExitIntent source="ats-check" />)
  leaveViaTop()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('records "seen" when it opens, not when it is dismissed', () => {
  // Otherwise closing the tab mid-modal resurrects it on the next visit.
  render(<ExitIntent source="ats-check" />)
  leaveViaTop()
  expect(localStorage.getItem('rai_exit_intent_seen')).toBe('1')
})

it('never fires on touch devices', () => {
  touch()
  render(<ExitIntent source="ats-check" />)
  leaveViaTop()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('stays silent when localStorage is unavailable', () => {
  // Without a readable flag we cannot honour "once", so we do not show it at all.
  const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  render(<ExitIntent source="ats-check" />)
  leaveViaTop()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  spy.mockRestore()
})

it('does not arm at all when disabled', () => {
  render(<ExitIntent source="ats-check" enabled={false} />)
  leaveViaTop()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(localStorage.getItem('rai_exit_intent_seen')).toBeNull()
})

describe('the way out is real', () => {
  it('has a labelled close button that actually closes', () => {
    render(<ExitIntent source="ats-check" />)
    leaveViaTop()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on Escape', () => {
    render(<ExitIntent source="ats-check" />)
    leaveViaTop()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on a backdrop click', () => {
    render(<ExitIntent source="ats-check" />)
    leaveViaTop()
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not re-ask after being dismissed', () => {
    render(<ExitIntent source="ats-check" />)
    leaveViaTop()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    leaveViaTop()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('carries no countdown or scarcity language', () => {
    render(<ExitIntent source="ats-check" />)
    leaveViaTop()
    const text = screen.getByRole('dialog').textContent ?? ''
    expect(text).not.toMatch(/hurry|expires|last chance|only \d+ left|don't miss|act now/i)
  })
})

describe('capture', () => {
  it('posts the address with its source and confirms', async () => {
    render(<ExitIntent source="ats-check-exit" />)
    leaveViaTop()
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'a@b.co' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send it/i }))

    await waitFor(() => expect(screen.getByText(/check your inbox/i)).toBeInTheDocument())
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('/api/lead')
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.co', source: 'ats-check-exit' })
  })

  it('tells the visitor nothing is lost when the post fails', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: false })
    render(<ExitIntent source="ats-check" />)
    leaveViaTop()
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'a@b.co' } })
    fireEvent.click(screen.getByRole('button', { name: /send it/i }))
    await waitFor(() => expect(screen.getByText(/nothing is lost/i)).toBeInTheDocument())
  })
})
