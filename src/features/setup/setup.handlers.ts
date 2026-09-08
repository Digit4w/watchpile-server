import { eq, notInArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { mediaTypes } from '../../db/schema/media-types.js'
import { settings } from '../../db/schema/settings.js'
import { users } from '../../db/schema/users.js'
import type { AppRouteHandler } from '../../lib/types.js'
import { hashPassword } from '../auth/auth.crypto.js'
import { createSession } from '../auth/auth.session.js'
import type {
  AccountRoute,
  InstanceRoute,
  StatusRoute,
} from './setup.routes.js'

/**
 * A linha de `settings` é criada preguiçosamente por `getSessionSecret`, que o
 * `sessionMiddleware` chama em toda requisição — então na prática ela existe
 * antes de qualquer handler rodar. A leitura ainda assim é defensiva, porque
 * depender da ordem de dois módulos que não se conhecem é o tipo de acordo que
 * um refactor desfaz sem avisar.
 */
function instanceConfiguredAt(): Date | null {
  return (
    db
      .select({ at: settings.instanceSetupAt })
      .from(settings)
      .where(eq(settings.id, 1))
      .get()?.at ?? null
  )
}

function hasUser(): boolean {
  return db.select({ id: users.id }).from(users).limit(1).get() !== undefined
}

export const status: AppRouteHandler<StatusRoute> = (c) => {
  if (!hasUser()) {
    return c.json({ pending: 'account' as const }, 200)
  }
  if (!instanceConfiguredAt()) {
    return c.json({ pending: 'instance' as const }, 200)
  }
  return c.json({ pending: null }, 200)
}

export const account: AppRouteHandler<AccountRoute> = async (c) => {
  if (hasUser()) {
    return c.json({ message: 'Setup already completed' }, 409)
  }

  const { username, password } = c.req.valid('json')
  const passwordHash = hashPassword(password)

  const created = db
    .insert(users)
    .values({ username, passwordHash, isAdmin: true })
    .returning({
      id: users.id,
      username: users.username,
      isAdmin: users.isAdmin,
    })
    .get()

  await createSession(c, created.id)

  return c.json(created, 201)
}

/**
 * O passo de instância: idioma-base e quais tipos a instalação mantém.
 *
 * **Ele APAGA, não semeia** (brief, 3.9). `0006_media_types.sql` insere os seis
 * incondicionalmente e migration não se reescreve, então num banco recém
 * migrado eles já estão lá — não há o que semear. Apagar é o que mantém intacto
 * o teste que congela `MEDIA_TYPE_TEMPLATES` contra um banco recém migrado.
 *
 * **Apagar é seguro aqui, e só aqui.** `DELETE /api/media-types/{slug}` recusa
 * tipo em uso, com a contagem; neste ponto da vida da instalação não existe
 * obra nenhuma, e a recusa não tem como disparar. Isso é uma propriedade do
 * momento, não uma licença: por isso o 409 abaixo é o que impede a rota de
 * virar um "apagar em massa" chamável depois.
 *
 * As três escritas vão numa transação só. Meio caminho aqui é uma instalação
 * com o idioma novo e os tipos velhos, sem nada dizendo qual metade valeu.
 */
export const instance: AppRouteHandler<InstanceRoute> = (c) => {
  if (instanceConfiguredAt()) {
    return c.json({ message: 'The instance is already configured' }, 409)
  }

  const { language, keep } = c.req.valid('json')

  const known = new Set(
    db
      .select({ slug: mediaTypes.slug })
      .from(mediaTypes)
      .all()
      .map((row) => row.slug),
  )

  /**
   * Slug desconhecido é 400, e a checagem vem ANTES da transação — a mesma
   * régua de `POST /api/entries` com `pileIds`: recusar antes de abrir a
   * transação é o que evita um rollback que não diz o que estava errado.
   *
   * A frase não interpola o slug: chave não entra em copy de tela, e frase
   * escrita no servidor continua sendo copy de tela (design system, seção 8,
   * oitava leva).
   */
  const unknown = keep.filter((slug) => !known.has(slug))
  if (unknown.length > 0) {
    return c.json({ message: 'Unknown media type in the selection' }, 400)
  }

  db.transaction((tx) => {
    tx.delete(mediaTypes).where(notInArray(mediaTypes.slug, keep)).run()

    /**
     * `.returning()` e não `.run()`, porque um `UPDATE` que não acha a linha
     * **não é erro em SQL** — ele acerta zero linha e volta feliz. Aqui isso
     * seria o pior desfecho possível: 204 na cara de quem configurou, com o
     * banco intacto e o wizard reaparecendo no próximo `status`.
     *
     * A linha existe sempre em produção — `sessionMiddleware` chama
     * `getSessionSecret`, que a cria —, e é justamente por ser garantida por um
     * módulo que não conhece este que a ausência dela vira 500 em vez de
     * silêncio: falha nossa não se disfarça de sucesso.
     */
    const saved = tx
      .update(settings)
      .set({ instanceLanguage: language, instanceSetupAt: new Date() })
      .where(eq(settings.id, 1))
      .returning({ id: settings.id })
      .get()

    if (!saved) {
      throw new Error('Settings row is missing — cannot record the setup')
    }
  })

  return c.body(null, 204)
}
