import { eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { hiddenMediaTypes } from '../../db/schema/hidden-media-types.js'
import { mediaTypes } from '../../db/schema/media-types.js'
import type { AppRouteHandler } from '../../lib/types.js'
import type {
  GetMediaTypesRoute,
  GetSearchSourcesRoute,
  SetMediaTypesRoute,
  SetSearchSourceRoute,
} from './preferences.routes.js'
import {
  clearSearchSource,
  searchSourcesOf,
  serves,
  setSearchSource as storeSearchSource,
} from './preferences.search-sources.js'

function hiddenOf(userId: number): string[] {
  return db
    .select({ slug: hiddenMediaTypes.mediaTypeSlug })
    .from(hiddenMediaTypes)
    .where(eq(hiddenMediaTypes.userId, userId))
    .all()
    .map((row) => row.slug)
    .sort()
}

export const getMediaTypes: AppRouteHandler<GetMediaTypesRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  return c.json({ hidden: hiddenOf(user.id) }, 200)
}

/**
 * Guarda a escolha inteira de uma vez: apaga o que havia e grava o que veio.
 *
 * **Substituir e não remendar** porque a tela é a lista toda — não há gesto que
 * mexa num tipo sem que a pessoa esteja olhando pros outros —, e porque assim
 * dois toggles em sequência não podem se cruzar numa ordem que deixe o banco
 * dizendo o que ninguém escolheu.
 */
export const setMediaTypes: AppRouteHandler<SetMediaTypesRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const hidden = [...new Set(c.req.valid('json').hidden)]

  const known = db
    .select({ slug: mediaTypes.slug })
    .from(mediaTypes)
    .all()
    .map((row) => row.slug)

  /**
   * Slug desconhecido é 400, e a checagem vem ANTES da escrita — mesma régua de
   * `POST /api/setup/instance` e de `POST /api/entries` com `pileIds`. A frase
   * não interpola o slug: chave não entra em copy de tela (design system, seção
   * 8, oitava leva).
   */
  if (hidden.some((slug) => !known.includes(slug))) {
    return c.json({ message: 'Unknown media type in the selection' }, 400)
  }

  /**
   * **Esconder TUDO é recusado**, e não por simetria com o wizard: sem nenhum
   * tipo visível a folha de criar obra fica sem o que oferecer e a busca fica
   * sem escopo — o app viraria um beco de onde só se sai voltando a esta tela.
   * É a mesma exigência de "pelo menos um" do passo de instância (brief, 3.9),
   * pelo mesmo motivo, e a tela anuncia a recusa antes do clique deixando o
   * último toggle ligado desabilitado (design system, seção 5).
   */
  if (known.length > 0 && hidden.length >= known.length) {
    return c.json({ message: 'Keep at least one media type visible' }, 400)
  }

  db.transaction((tx) => {
    tx.delete(hiddenMediaTypes)
      .where(eq(hiddenMediaTypes.userId, user.id))
      .run()

    if (hidden.length > 0) {
      tx.insert(hiddenMediaTypes)
        .values(
          hidden.map((slug) => ({ userId: user.id, mediaTypeSlug: slug })),
        )
        .run()
    }
  })

  return c.json({ hidden: [...hidden].sort() }, 200)
}

/**
 * A fonte preferida de cada tipo — o mapa inteiro, pra tela desenhar o valor
 * atual do seletor antes de a primeira busca voltar.
 *
 * **Ler o mapa não é reimplementar a escolha.** Quem decide quem responde uma
 * busca é `chooseSearchProvider`, no servidor, e a resposta traz o provedor que
 * de fato atendeu — a tela já prefere esse (`data.provider.slug`). Isto aqui
 * responde outra pergunta, que só a tela tem: *o que o seletor mostra enquanto
 * ninguém buscou nada?*
 */
export const getSearchSources: AppRouteHandler<GetSearchSourcesRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  return c.json({ sources: searchSourcesOf(user.id) }, 200)
}

/**
 * Escolhe a fonte de UM tipo, ou desfaz a escolha com `provider: null`.
 *
 * A ordem das guardas é a mesma de `GET /api/search`, e é decisão: **tipo que
 * não existe é 404, provedor que não serve o tipo é 400**. Sem a distinção, um
 * slug com erro de digitação se leria como "esse provedor não serve isso", e
 * quem escreveu iria procurar a associação em vez do erro.
 */
export const setSearchSource: AppRouteHandler<SetSearchSourceRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { mediaType } = c.req.valid('param')
  const { provider } = c.req.valid('json')

  const exists = db
    .select({ slug: mediaTypes.slug })
    .from(mediaTypes)
    .where(eq(mediaTypes.slug, mediaType))
    .get()

  if (!exists) {
    return c.json({ message: 'No media type with that slug' }, 404)
  }

  if (provider === null) {
    clearSearchSource(user.id, mediaType)
    return c.json({ sources: searchSourcesOf(user.id) }, 200)
  }

  /**
   * A frase não interpola o slug do provedor: chave não entra em copy de tela
   * (design system, seção 8, oitava leva). Quem sabe o NOME dele é a tela, que
   * já tem a lista de fontes daquele tipo na mão pra desenhar o seletor.
   */
  if (!serves(mediaType, provider)) {
    return c.json(
      { message: 'That provider does not serve that media type' },
      400,
    )
  }

  storeSearchSource(user.id, mediaType, provider)
  return c.json({ sources: searchSourcesOf(user.id) }, 200)
}
