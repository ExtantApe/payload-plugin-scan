// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { createRepeatFilter } from '../../src/client/useScanner.js'

describe('createRepeatFilter', () => {
  it('counts a code held in view once, whatever the window', () => {
    const f = createRepeatFilter(0)
    expect(f.accept(['A'], 0)).toEqual(['A'])
    expect(f.accept(['A'], 5000)).toEqual([])
    expect(f.accept([], 5100)).toEqual([])
    expect(f.accept(['A'], 5200)).toEqual(['A'])
  })

  it('suppresses a return inside repeatMs and accepts it after', () => {
    const f = createRepeatFilter(2500)
    expect(f.accept(['A', 'B'], 0)).toEqual(['A', 'B'])
    expect(f.accept([], 100)).toEqual([])
    expect(f.accept(['A'], 2000)).toEqual([])
    expect(f.accept([], 2100)).toEqual([])
    expect(f.accept(['A'], 4700)).toEqual(['A'])
    expect(f.accept(['A', 'A'], 4800)).toEqual([])
  })
})
