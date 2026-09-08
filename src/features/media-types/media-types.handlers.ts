import { and, count, eq, inArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { mediaTypeProviders } from '../../db/schema/media-type-providers.js'
import { mediaTypeNames, mediaTypes } from '../../db/schema/media-types.js'
import type { AppRouteHandler } from '../../lib/types.js'
import type { MediaTypePublic } from './media-types.public.js'
import { effectiveProviderOf, instanceLanguage } from './media-types.query.js'
import { type NameMap, resolveName } from './media-types.resolve.js'
import type {
  CreateRoute,
  ListRoute,
  RemoveRoute,
  TemplatesRoute,
  UpdateRoute,
} from './media-types.routes.js'
import { uniqueSlug } from './media-types.slug.js'
import { MEDIA_TYPE_TEMPLATES } from './media-types.templates.js'

/**
 * Monta a forma pública de um ou mais tipos.
 *
 * Faz as três leituras de uma vez — tipos, nomes e contagem — em vez de uma por
 * tipo. Com seis linhas a diferença é invisível, mas o número de tipos é aberto
 * desde 31/08/2026 (brief, 3.12) e um `N+1` aqui cresceria junto com o
 * vocabulário do servidor.
 */
function toPublic(
  slugs: string[] | undefined,
  viewerLocale: string | undefined,
): MediaTypePublic[] {
  const types = slugs
    ? db.select().from(mediaTypes).where(inArray(mediaTypes.slug, slugs)).all()
    : db.select().from(mediaTypes).all()

  if (types.length === 0) {
    return []
  }

  const ids = types.map((t) => t.id)

  // Ordenado por locale para que "o primeiro preenchido" (degrau 3 da queda)
  // seja estável entre duas chamadas — `Object.values` segue a ordem de
  // inserção, então a ordem da consulta vira a ordem do desempate.
  const names = db
    .select()
    .from(mediaTypeNames)
    .where(inArray(mediaTypeNames.mediaTypeId, ids))
    .orderBy(mediaTypeNames.locale)
    .all()

  const counts = db
    .select({ slug: entries.mediaType, total: count() })
    .from(entries)
    .groupBy(entries.mediaType)
    .all()

  // Uma consulta pra junção, não uma por tipo: o número de tipos é aberto
  // (brief, 3.12) e um `N+1` aqui cresceria junto com o vocabulário.
  const joins = db.select().from(mediaTypeProviders).all()

  const byType = new Map<number, NameMap>()
  for (const row of names) {
    const map = byType.get(row.mediaTypeId) ?? {}
    map[row.locale] = {
      name: row.name,
      plural: row.plural,
      progressUnit: row.progressUnit,
    }
    byType.set(row.mediaTypeId, map)
  }

  const instance = instanceLanguage()

  return types.map((type) => {
    const names = byType.get(type.id) ?? {}
    const resolved = resolveName(names, viewerLocale, instance)

    const providers = joins
      .filter((a) => a.mediaTypeSlug === type.slug)
      .map((a) => a.providerSlug)

    return {
      slug: type.slug,
      icon: type.icon,
      countsProgress: type.countsProgress,
      providers: providers,
      effectiveProvider: effectiveProviderOf(
        type.defaultProviderSlug,
        providers,
      ),
      entryCount: counts.find((c) => c.slug === type.slug)?.total ?? 0,
      // O `??` nunca deveria disparar: a escrita exige um idioma e o degrau 3
      // pega o resto. Ele existe porque um banco editado à mão não tem essa
      // garantia, e responder com `undefined` seria pior que responder o slug.
      name: resolved?.name ?? type.slug,
      plural: resolved?.plural ?? type.slug,
      progressUnit: resolved?.progressUnit ?? null,
      names,
    }
  })
}

function writeNames(mediaTypeId: number, names: NameMap): void {
  db.delete(mediaTypeNames)
    .where(eq(mediaTypeNames.mediaTypeId, mediaTypeId))
    .run()

  for (const [locale, value] of Object.entries(names)) {
    db.insert(mediaTypeNames)
      .values({ mediaTypeId, locale, ...value })
      .run()
  }
}

/**
 * A LISTA é de todo mundo, não só do admin.
 *
 * `/library` desenha os chips de tipo, a carta desenha o selo e a folha de obra
 * desenha o seletor — todas precisam do vocabulário. **O que é do admin é
 * escrever**, e é nas três rotas de escrita que a guarda entra (brief, 3.9).
 */
export const list: AppRouteHandler<ListRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { locale } = c.req.valid('query')
  return c.json(toPublic(undefined, locale), 200)
}

/**
 * Os templates embarcados, com `installed` resolvido contra o que este servidor
 * já tem.
 *
 * A comparação é por SLUG e não por nome: o admin pode ter renomeado "Movie"
 * para "Filme" e o tipo continua sendo `movie` — o slug é imutável justamente
 * pra sustentar comparações assim (`media-types.slug.ts`).
 *
 * Uma consulta só, e nenhum `N+1`: os slugs instalados vêm num `Set` e os seis
 * templates o consultam.
 */
export const templates: AppRouteHandler<TemplatesRoute> = (c) => {
  const installed = new Set(
    db
      .select({ slug: mediaTypes.slug })
      .from(mediaTypes)
      .all()
      .map((t) => t.slug),
  )

  return c.json(
    MEDIA_TYPE_TEMPLATES.map((template) => ({
      ...template,
      installed: installed.has(template.slug),
    })),
    200,
  )
}

export const create: AppRouteHandler<CreateRoute> = (c) => {
  const body = c.req.valid('json')

  const used = db
    .select({ slug: mediaTypes.slug })
    .from(mediaTypes)
    .all()
    .map((t) => t.slug)

  // Do PRIMEIRO nome preenchido, e nunca recalculado depois — ver
  // `media-types.slug.ts`.
  //
  // `NameMapSchema` recusa mapa vazio, então o `??` é inalcançável por esta
  // rota. Ele fica explícito em vez de um `!` porque o tipo do índice não
  // carrega essa garantia, e a asserção esconderia de quem lê DE ONDE vem a
  // certeza — que é do refine do schema, não daqui.
  const [first] = Object.values(body.names)
  const slug = uniqueSlug(first?.name ?? 'type', used)

  const created = db
    .insert(mediaTypes)
    .values({ slug, icon: body.icon, countsProgress: body.countsProgress })
    .returning()
    .get()

  writeNames(created.id, body.names)

  return c.json(toPublic([slug], undefined)[0], 201)
}

export const update: AppRouteHandler<UpdateRoute> = (c) => {
  const { slug } = c.req.valid('param')
  const body = c.req.valid('json')

  const type = db
    .select()
    .from(mediaTypes)
    .where(eq(mediaTypes.slug, slug))
    .get()

  if (!type) {
    return c.json({ message: 'Media type not found' }, 404)
  }

  /**
   * O padrão tem que ser um provedor que SERVE este tipo.
   *
   * Sem a guarda, o admin grava "anime → openlibrary" e a busca passa a
   * consultar um catálogo que não tem anime — falha silenciosa que só aparece
   * como "não achei nada", que é justamente a mentira que o brief 3.10 manda
   * evitar. **A FK não cobre isso**: ela garante que o provedor existe, não que
   * ele sirva este tipo.
   */
  if (body.defaultProvider) {
    const serve = db
      .select()
      .from(mediaTypeProviders)
      .where(
        and(
          eq(mediaTypeProviders.mediaTypeSlug, slug),
          eq(mediaTypeProviders.providerSlug, body.defaultProvider),
        ),
      )
      .get()

    if (!serve) {
      return c.json(
        { message: `"${body.defaultProvider}" does not serve this media type` },
        400,
      )
    }
  }

  if (
    body.icon !== undefined ||
    body.countsProgress !== undefined ||
    body.defaultProvider !== undefined
  ) {
    db.update(mediaTypes)
      .set({
        ...(body.icon !== undefined && { icon: body.icon }),
        ...(body.countsProgress !== undefined && {
          countsProgress: body.countsProgress,
        }),
        // `null` limpa a escolha; ausente não mexe. A distinção é o que torna
        // desfazer possível — mesma forma do `PATCH` de credencial.
        ...(body.defaultProvider !== undefined && {
          defaultProviderSlug: body.defaultProvider ?? null,
        }),
        updatedAt: new Date(),
      })
      .where(eq(mediaTypes.id, type.id))
      .run()
  }

  // O mapa vem inteiro ou não vem: mandar um idioma só e mesclar deixaria sem
  // jeito de APAGAR uma tradução, e apagar é pedido legítimo.
  if (body.names !== undefined) {
    writeNames(type.id, body.names)
  }

  return c.json(toPublic([slug], undefined)[0], 200)
}

export const remove: AppRouteHandler<RemoveRoute> = (c) => {
  const { slug } = c.req.valid('param')

  const type = db
    .select()
    .from(mediaTypes)
    .where(eq(mediaTypes.slug, slug))
    .get()

  if (!type) {
    return c.json({ message: 'Media type not found' }, 404)
  }

  /**
   * A recusa é decisão de produto (brief, 3.12), e é checada AQUI e não deixada
   * pra chave estrangeira: a FK também recusa, mas como 500 e sem dizer quantas
   * obras seguram o tipo. A FK fica como rede — ela é o que garante que nenhum
   * caminho futuro apague obra alheia por engano.
   *
   * A contagem é de TODOS os usuários. Contar só as do admin diria "0 obras" com
   * duzentas obras de outra conta no mesmo servidor.
   */
  const inUse =
    db
      .select({ total: count() })
      .from(entries)
      .where(eq(entries.mediaType, slug))
      .get()?.total ?? 0

  if (inUse > 0) {
    return c.json(
      {
        message: 'Titles still use this type. Change their type first.',
        entryCount: inUse,
      },
      409,
    )
  }

  db.delete(mediaTypes).where(eq(mediaTypes.id, type.id)).run()

  return c.body(null, 204)
}
