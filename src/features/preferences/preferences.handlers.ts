import { eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { hiddenMediaTypes } from '../../db/schema/hidden-media-types.js'
import { mediaTypes } from '../../db/schema/media-types.js'
import type { AppRouteHandler } from '../../lib/types.js'
import type {
  GetMediaTypesRoute,
  SetMediaTypesRoute,
} from './preferences.routes.js'

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
