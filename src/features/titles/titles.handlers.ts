import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import type { AppRouteHandler } from '../../lib/types.js'
import { sourceOf } from '../entries/entries.source.js'
import { bindingFor, providerBySlug } from '../providers/providers.query.js'
import { fetchUnits } from '../providers/providers.units.js'
import { type ResolveOutcome, resolveTitle } from './titles.resolve.js'
import type {
  GetEntryDetailsRoute,
  GetEntryUnitsRoute,
  GetProviderTitleRoute,
  GetProviderUnitsRoute,
} from './titles.routes.js'

/**
 * A recusa virando resposta HTTP, **uma vez só para as duas rotas**.
 *
 * `not-found` sai da lista de recusas e vira 404: o provedor respondeu, e
 * respondeu que não tem. Isso é o não-encontrado da tela de detalhe (design
 * system, seção 6), e a saída dele é sair — não tentar de novo.
 */
function refusal(
  reason: Exclude<ResolveOutcome & { ok: false }, never>['reason'],
) {
  if (reason === 'not-found') {
    return {
      status: 404 as const,
      body: { message: 'The provider has no such title' },
    }
  }

  return {
    status: 503 as const,
    body: {
      message: 'The provider could not answer',
      reason,
    },
  }
}

export const getProviderTitle: AppRouteHandler<GetProviderTitleRoute> = async (
  c,
) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { provider: slug, externalId } = c.req.valid('param')
  const { type } = c.req.valid('query')
  const provider = providerBySlug(slug)

  /**
   * Provedor que este servidor não tem é 404, não 503: 503 mandaria esperar
   * por algo que nunca vai existir, e é a mesma leitura que a busca já faz.
   */
  if (!provider) {
    return c.json({ message: 'The provider has no such title' }, 404)
  }

  const result = await resolveTitle({
    provider,
    externalId,
    userId: user.id,
    mediaType: type,
  })

  if (!result.ok) {
    const { status, body } = refusal(result.reason)
    return status === 404 ? c.json(body, 404) : c.json(body as never, 503)
  }

  return c.json(result.details, 200)
}

export const getEntryDetails: AppRouteHandler<GetEntryDetailsRoute> = async (
  c,
) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')

  const entry = db
    .select({
      id: entries.id,
      mediaType: entries.mediaType,
      primaryProvider: entries.primaryProvider,
    })
    .from(entries)
    .where(and(eq(entries.id, id), eq(entries.userId, user.id)))
    .get()

  if (!entry) {
    return c.json({ message: 'The provider has no such title' }, 404)
  }

  const source = sourceOf(entry.id, entry.primaryProvider)

  /**
   * Obra digitada à mão não tem vínculo, e **isso não é falha**: a tela
   * continua desenhando tudo que `GET /api/entries/{id}` já deu — título,
   * progresso, status, nota, pilhas — e só não mostra sinopse nem ano, que
   * `entries` nunca guardou. É o segundo motivo pra "vincular obra existente a
   * um provedor" (brief, 3.10).
   *
   * Obra inexistente responde igual, pelo mesmo motivo da capa de pilha:
   * separar as duas contaria quais ids existem na conta de outra pessoa.
   */
  if (!source) {
    return c.json({ message: 'The provider has no such title' }, 404)
  }

  const provider = providerBySlug(source.provider)
  if (!provider) {
    return c.json({ message: 'The provider has no such title' }, 404)
  }

  const result = await resolveTitle({
    provider,
    externalId: source.externalId,
    userId: user.id,
    entryId: entry.id,
    // A obra sabe o próprio tipo; a rota do provedor precisa que perguntem.
    mediaType: entry.mediaType,
  })

  if (!result.ok) {
    const { status, body } = refusal(result.reason)
    return status === 404 ? c.json(body, 404) : c.json(body as never, 503)
  }

  return c.json(result.details, 200)
}

/**
 * As unidades, **um handler para os dois endereços** — como o detalhe.
 *
 * A diferença entre "obra do provedor" e "obra minha" cabe em como se chega ao
 * par (provedor, id externo, tipo); listar as unidades é o mesmo trabalho.
 */
async function respondUnits(
  source: { provider: string; externalId: string; mediaType: string },
  group: number | undefined,
) {
  const provider = providerBySlug(source.provider)
  const binding = bindingFor(source.mediaType, source.provider)

  if (!provider || !binding) {
    return { status: 404 as const, body: { message: 'No units to list' } }
  }

  const result = await fetchUnits({
    provider,
    binding,
    externalId: source.externalId,
    group: group ?? null,
  })

  if (!result.ok) {
    /**
     * **`no-units` e `not-found` são 404, e o resto é 503.** Filme não tem
     * episódio: a pergunta não faz sentido, e isso não é indisponibilidade de
     * ninguém. Já falta de chave é condição da instalação, que a tela sabe
     * explicar.
     */
    if (result.reason === 'no-units' || result.reason === 'not-found') {
      return { status: 404 as const, body: { message: 'No units to list' } }
    }
    return {
      status: 503 as const,
      body: {
        message: 'The provider could not answer',
        reason: result.reason,
      },
    }
  }

  return { status: 200 as const, body: { units: result.units } }
}

export const getProviderUnits: AppRouteHandler<GetProviderUnitsRoute> = async (
  c,
) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { provider, externalId } = c.req.valid('param')
  const { group, type } = c.req.valid('query')

  const { status, body } = await respondUnits(
    { provider, externalId, mediaType: type },
    group,
  )
  return c.json(body as never, status)
}

export const getEntryUnits: AppRouteHandler<GetEntryUnitsRoute> = async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')
  const { group } = c.req.valid('query')

  const entry = db
    .select({
      id: entries.id,
      mediaType: entries.mediaType,
      primaryProvider: entries.primaryProvider,
    })
    .from(entries)
    .where(and(eq(entries.id, id), eq(entries.userId, user.id)))
    .get()

  const source = entry ? sourceOf(entry.id, entry.primaryProvider) : null

  // Obra inexistente, de outra pessoa, ou sem vínculo: mesma resposta, pelo
  // mesmo motivo da capa de pilha — separar contaria o acervo alheio.
  if (!entry || !source) {
    return c.json({ message: 'No units to list' }, 404)
  }

  const { status, body } = await respondUnits(
    { ...source, mediaType: entry.mediaType },
    group,
  )
  return c.json(body as never, status)
}
