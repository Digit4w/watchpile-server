import type { AppRouteHandler } from '../../lib/types.js'
import { artCacheUsage, clearArt } from '../art/art.store.js'
import {
  forgetEverything,
  providerCacheUsage,
} from '../providers/providers.cache.js'
import type {
  ClearArtCacheRoute,
  ClearProviderCacheRoute,
  UsageRoute,
} from './storage.routes.js'

/**
 * Os handlers não têm regra própria: eles leem as funções que já moram com
 * cada cache.
 *
 * **De propósito.** Quem sabe o que é uma entrada de `provider_cache` é
 * `providers.cache.ts`, e quem sabe onde os arquivos de arte estão é
 * `art.store.ts` — escrever a conta aqui seria uma segunda cópia dela, e a que
 * ficaria para trás no dia em que o descarte mudasse.
 *
 * A guarda de admin está no router, não aqui, porque vale para as três.
 */
export const usage: AppRouteHandler<UsageRoute> = (c) =>
  c.json(
    { providerCache: providerCacheUsage(), artCache: artCacheUsage() },
    200,
  )

export const clearProviderCache: AppRouteHandler<ClearProviderCacheRoute> = (
  c,
) => c.json({ cleared: forgetEverything() }, 200)

export const clearArtCache: AppRouteHandler<ClearArtCacheRoute> = (c) =>
  c.json({ cleared: clearArt() }, 200)
