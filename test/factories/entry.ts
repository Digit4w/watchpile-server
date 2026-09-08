import type { Entry } from '../../src/features/entries/entries.entity.js'

export function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 1,
    userId: 1,
    mediaType: 'tv',
    title: 'Severance',
    status: 'watching',
    rating: null,
    notes: null,
    progress: 0,
    total: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  }
}
