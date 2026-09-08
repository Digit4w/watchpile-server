import { describe, expect, it } from 'vitest'
import {
  POSITION_STEP,
  positionBetween,
  rebalancedPositions,
} from './piles.ordering.js'

describe('positionBetween', () => {
  it('starts an empty pile at zero', () => {
    expect(positionBetween(null, null)).toBe(0)
  })

  it('appends one step past the last item', () => {
    expect(positionBetween(4, null)).toBe(4 + POSITION_STEP)
  })

  it('prepends one step before the first item', () => {
    expect(positionBetween(0, null)).toBe(POSITION_STEP)
    expect(positionBetween(null, 0)).toBe(-POSITION_STEP)
  })

  it('bisects between two neighbours', () => {
    expect(positionBetween(0, 1)).toBe(0.5)
    expect(positionBetween(0, 0.5)).toBe(0.25)
  })

  it('bisects between negative neighbours', () => {
    expect(positionBetween(-2, -1)).toBe(-1.5)
  })

  it('reports exhaustion instead of colliding with a neighbour', () => {
    let before = 0
    const after = 1
    let steps = 0

    // arrastar sempre pro mesmo ponto bisseta o mesmo intervalo; perto de 1 o
    // double tem ~52 casas, então isto esgota em dezenas de voltas, não milhares
    for (let i = 0; i < 200; i++) {
      const next = positionBetween(before, after)
      if (next === null) {
        expect(steps).toBeGreaterThan(0)
        return
      }
      expect(next).toBeGreaterThan(before)
      expect(next).toBeLessThan(after)
      before = next
      steps++
    }

    throw new Error('positionBetween never reported exhaustion')
  })

  it('reports exhaustion for adjacent doubles', () => {
    const before = 1
    const after = 1 + Number.EPSILON / 2
    expect(positionBetween(before, after)).toBeNull()
  })
})

describe('rebalancedPositions', () => {
  it('renumbers in whole steps, keeping the given order', () => {
    expect(rebalancedPositions(4)).toEqual([0, 1, 2, 3])
  })

  it('handles an empty pile', () => {
    expect(rebalancedPositions(0)).toEqual([])
  })
})
