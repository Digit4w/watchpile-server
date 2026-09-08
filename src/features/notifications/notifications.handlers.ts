import type { AppRouteHandler } from '../../lib/types.js'
import { reconcileInstanceConditions } from './notifications.instance-conditions.js'
import type { NotificationKind } from './notifications.kinds.js'
import type {
  DismissRoute,
  ListRoute,
  MarkReadRoute,
  UnreadCountRoute,
} from './notifications.routes.js'
import * as store from './notifications.store.js'

/**
 * `params` é JSON numa coluna de texto, e JSON quebrado não pode derrubar a
 * lista inteira: uma linha ilegível vira `{}` e a frase do cliente aparece sem
 * interpolação, em vez de a tela toda dar 500. Falha nossa não vira tela
 * quebrada quando há uma resposta parcial honesta (design system, seção 8).
 */
function parseParams(raw: string): Record<string, string | number> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string | number] =>
          typeof entry[1] === 'string' || typeof entry[1] === 'number',
      ),
    )
  } catch {
    return {}
  }
}

function toPublic(row: store.Row) {
  return {
    id: row.id,
    audience: row.audience,
    severity: row.severity,
    kind: row.kind as NotificationKind,
    params: parseParams(row.params),
    createdAt: row.createdAt.toISOString(),
    read: row.readAt !== null,
    dismissed: row.dismissedAt !== null,
  }
}

/**
 * Reconcilia as condições de instância antes de responder — mesma forma do
 * cache de arte (brief, 3.10): uma rota, sem job e sem varredura.
 *
 * **Só pra admin**, porque só ele vê notificação de instância (brief, 3.9), e
 * fazer a conta pra quem não vai receber nada seria trabalho pra ninguém.
 */
function reconcileIfAdmin(user: { isAdmin: boolean }): void {
  if (user.isAdmin) {
    reconcileInstanceConditions()
  }
}

export const list: AppRouteHandler<ListRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  reconcileIfAdmin(user)

  const { include, audience, limit, cursor } = c.req.valid('query')
  const { rows, nextCursor } = store.listFor(user, {
    include,
    audience,
    limit,
    cursor,
  })

  return c.json({ notifications: rows.map(toPublic), nextCursor }, 200)
}

/**
 * O selo do sino reconcilia junto, e não só a lista: é ELE que fica na tela o
 * tempo todo, enquanto o painel abre de vez em quando. Reconciliar só na lista
 * faria a condição nascer apenas para quem abrisse o painel — que é justamente
 * quem não precisava do sino pra descobrir.
 */
export const unreadCount: AppRouteHandler<UnreadCountRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  reconcileIfAdmin(user)

  return c.json(store.unreadFor(user), 200)
}

/**
 * Devolve o contador já recalculado, em vez de um `204`: o gesto que chama isto
 * é fechar o painel, e o selo do sino muda no mesmo instante. Uma segunda
 * requisição pro número deixaria o selo aceso por um quadro depois de a pessoa
 * ter lido tudo — que é o intervalo entre duas consultas que o design system
 * já registrou como defeito (seção 8, décima segunda leva).
 */
export const markRead: AppRouteHandler<MarkReadRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  store.markRead(user, c.req.valid('json').ids)
  return c.json(store.unreadFor(user), 200)
}

export const dismiss: AppRouteHandler<DismissRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  /**
   * 404 e não 403 pra notificação de outra pessoa: distinguir os dois contaria
   * que aquele id existe. E 404 também pra uma já dispensada — dispensar duas
   * vezes não é um segundo fato, mas responder 200 diria que houve escrita.
   */
  if (!store.dismiss(user, c.req.valid('param').id)) {
    return c.json({ message: 'No such notification' }, 404)
  }

  return c.json({ message: 'Dismissed' }, 200)
}
