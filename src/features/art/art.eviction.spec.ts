import { describe, expect, it } from 'vitest'
import { type CachedArt, evictionPlan } from './art.eviction.js'

function input(id: number, bytes: number, lastUsedAt: number): CachedArt {
  return { id, bytes, lastUsedAt }
}

describe('evictionPlan', () => {
  it('discards nothing when the incoming art still fits', () => {
    expect(
      evictionPlan({
        entries: [input(1, 40, 100), input(2, 40, 200)],
        incoming: 20,
        ceiling: 200,
      }),
    ).toEqual([])
  })

  /**
   * O que chega entra na conta. Sem isso o cache passaria do teto por uma arte
   * a cada gravação — pouco, mas sempre, e teto que só vale às vezes não é
   * teto.
   */
  it('counts the incoming art, not only what is already stored', () => {
    expect(
      evictionPlan({
        entries: [input(1, 90, 100)],
        incoming: 20,
        ceiling: 100,
      }),
    ).toEqual([1])
  })

  it('discards the least recently USED, not the oldest', () => {
    const entries = [
      // criada primeiro, mas usada agora há pouco
      input(1, 50, 900),
      // criada depois, e esquecida
      input(2, 50, 100),
    ]

    expect(evictionPlan({ entries, incoming: 50, ceiling: 100 })).toEqual([2])
  })

  it('keeps discarding until the surplus is gone', () => {
    const entries = [input(1, 30, 100), input(2, 30, 200), input(3, 30, 300)]

    expect(evictionPlan({ entries, incoming: 60, ceiling: 100 })).toEqual([
      1, 2,
    ])
  })

  /**
   * O carimbo tem resolução de segundo, então empate é caso comum e não borda
   * rara. Sem desempate, o mesmo cache produziria planos diferentes.
   */
  it('breaks a tie on last use by id, so the plan is deterministic', () => {
    const entries = [input(7, 40, 500), input(3, 40, 500), input(5, 40, 500)]

    expect(evictionPlan({ entries, incoming: 40, ceiling: 120 })).toEqual([3])
  })

  it('empties the cache when a single incoming art is bigger than the ceiling', () => {
    const entries = [input(1, 40, 100), input(2, 40, 200)]

    // Não é caso teórico: teto apertado mais pôster grande. Sai tudo, e o
    // arquivo novo entra assim mesmo — quem pediu a arte precisa dela agora.
    expect(evictionPlan({ entries, incoming: 500, ceiling: 100 })).toEqual([
      1, 2,
    ])
  })

  it('takes an empty cache without arithmetic on nothing', () => {
    expect(evictionPlan({ entries: [], incoming: 40, ceiling: 100 })).toEqual(
      [],
    )
  })
})
