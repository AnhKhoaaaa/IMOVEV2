import '@testing-library/jest-dom'
import { vi } from 'vitest'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (q) => ({
    matches: false, media: q, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

global.ResizeObserver = vi.fn(() => ({
  observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(),
}))

// jsdom doesn't implement Element.scrollTo — stub it so auto-scroll effects (e.g. the chat
// transcript scrolling on new messages) don't throw during tests.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {}
}
