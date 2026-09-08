import { describe, expect, it } from 'vitest'
import { makeEntry } from '../../../test/factories/entry.js'
import { InMemoryEntriesRepository } from '../../../test/repositories/in-memory-entries-repository.js'
import { recordProgress } from './entries.use-cases.js'

const occurredAt = new Date('2026-08-28T12:00:00Z')

function command(overrides: Record<string, unknown> = {}) {
  return {
    entryId: 1,
    userId: 1,
    delta: 1,
    occurredAt,
    origin: 'manual' as const,
    ...overrides,
  }
}

describe('recordProgress', () => {
  it('advances the counter and appends one event', () => {
    const repository = new InMemoryEntriesRepository([makeEntry({ total: 9 })])

    const result = recordProgress(repository, command({ delta: 2 }))

    expect(result).toMatchObject({ ok: true, entry: { progress: 2 } })
    expect(repository.events).toMatchObject([
      { entryId: 1, type: 'progress_delta', delta: 2, origin: 'manual' },
    ])
  })

  it('keeps `occurred_at` separate from `created_at`', () => {
    const repository = new InMemoryEntriesRepository([makeEntry()])

    recordProgress(repository, command({ origin: 'import' }))

    const [event] = repository.events
    expect(event?.occurredAt).toEqual(occurredAt)
    expect(event?.createdAt).not.toEqual(occurredAt)
  })

  it('corrects with a negative delta instead of rewriting the log', () => {
    const repository = new InMemoryEntriesRepository([
      makeEntry({ progress: 3 }),
    ])

    recordProgress(repository, command({ delta: -1 }))

    expect(repository.entries[0]?.progress).toBe(2)
    expect(repository.events).toHaveLength(1)
    expect(repository.events[0]?.delta).toBe(-1)
  })

  it('refuses a delta that would push the counter below zero', () => {
    const repository = new InMemoryEntriesRepository([
      makeEntry({ progress: 1 }),
    ])

    const result = recordProgress(repository, command({ delta: -2 }))

    expect(result).toEqual({ ok: false, reason: 'progress-below-zero' })
    expect(repository.entries[0]?.progress).toBe(1)
    expect(repository.events).toHaveLength(0)
  })

  it('refuses a delta that would pass a known total', () => {
    const repository = new InMemoryEntriesRepository([
      makeEntry({ progress: 8, total: 9 }),
    ])

    const result = recordProgress(repository, command({ delta: 2 }))

    expect(result).toEqual({ ok: false, reason: 'progress-above-total' })
    expect(repository.events).toHaveLength(0)
  })

  it('allows landing exactly on a known total', () => {
    const repository = new InMemoryEntriesRepository([
      makeEntry({ progress: 8, total: 9 }),
    ])

    const result = recordProgress(repository, command({ delta: 1 }))

    expect(result).toMatchObject({ ok: true, entry: { progress: 9 } })
  })

  it('imposes no ceiling when the total is unknown', () => {
    const repository = new InMemoryEntriesRepository([
      makeEntry({ mediaType: 'manga', progress: 210, total: null }),
    ])

    const result = recordProgress(repository, command({ delta: 5 }))

    expect(result).toMatchObject({ ok: true, entry: { progress: 215 } })
  })

  it('does not find an entry owned by someone else', () => {
    const repository = new InMemoryEntriesRepository([makeEntry({ userId: 2 })])

    const result = recordProgress(repository, command())

    expect(result).toEqual({ ok: false, reason: 'entry-not-found' })
    expect(repository.events).toHaveLength(0)
  })
})
