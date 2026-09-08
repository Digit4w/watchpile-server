import { describe, expect, it } from 'vitest'
import { orderForWidget } from './home-widgets.ordering.js'

function entry(id: number, createdAt: string) {
  return { id, createdAt: new Date(createdAt) }
}

const a = entry(1, '2026-08-01T00:00:00Z')
const b = entry(2, '2026-08-20T00:00:00Z')
const c = entry(3, '2026-08-10T00:00:00Z')

describe('orderForWidget', () => {
  it('falls back to created_at desc when nothing was dragged', () => {
    const ordered = orderForWidget([a, b, c], new Map())

    expect(ordered.map(({ id }) => id)).toEqual([2, 3, 1])
  })

  it('puts dragged items first, in the position they were dropped', () => {
    const ordered = orderForWidget([a, b, c], new Map([[1, 0]]))

    expect(ordered.map(({ id }) => id)).toEqual([1, 2, 3])
  })

  it('honours fractional positions between dragged items', () => {
    const ordered = orderForWidget(
      [a, b, c],
      new Map([
        [3, 0],
        [1, -0.5],
      ]),
    )

    expect(ordered.map(({ id }) => id)).toEqual([1, 3, 2])
  })

  it('keeps a curated item on top when another work gets progress', () => {
    const bumped = entry(2, '2026-09-01T00:00:00Z')
    const ordered = orderForWidget([a, bumped, c], new Map([[1, 0]]))

    expect(ordered.map(({ id }) => id)).toEqual([1, 2, 3])
  })

  /**
   * O caso que motivou a troca de `updated_at` por `created_at` (29/08/2026):
   * marcar progresso escreve na obra, e com `updated_at` ela pulava pra
   * primeira posição — a grade dançava debaixo do dedo de quem estava clicando
   * `+`. A ordem tem que ser a mesma antes e depois.
   */
  it('does not reorder when a work receives progress', () => {
    const before = orderForWidget([a, b, c], new Map())

    // progresso não toca em `created_at`; a obra é a mesma linha, reordenada
    // apenas se a chave de ordenação tivesse mudado
    const after = orderForWidget([c, a, b], new Map())

    expect(after.map(({ id }) => id)).toEqual(before.map(({ id }) => id))
  })

  it('breaks ties by id desc, so the seed does not depend on SQLite order', () => {
    const mesmo = '2026-08-05T00:00:00Z'
    const ordered = orderForWidget(
      [entry(7, mesmo), entry(9, mesmo), entry(8, mesmo)],
      new Map(),
    )

    expect(ordered.map(({ id }) => id)).toEqual([9, 8, 7])
  })

  it('ignores positions for entries the widget no longer shows', () => {
    const ordered = orderForWidget(
      [b, c],
      new Map([
        [1, 0],
        [3, 1],
      ]),
    )

    expect(ordered.map(({ id }) => id)).toEqual([3, 2])
  })

  it('handles an empty widget', () => {
    expect(orderForWidget([], new Map([[1, 0]]))).toEqual([])
  })
})
