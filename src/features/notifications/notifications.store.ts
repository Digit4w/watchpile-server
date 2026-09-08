import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { notifications } from '../../db/schema/notifications.js'
import type { NotificationKind } from './notifications.kinds.js'

/**
 * Leitura e escrita da tabela. Fica separado dos handlers porque o
 * reconciliador de condições de instância (que não é rota) escreve pelas mesmas
 * funções — e porque duas contas da mesma coisa é como uma fica pra trás
 * (design system, seção 8).
 */

export type Severity = 'info' | 'warning' | 'danger'

/**
 * A ordem é a que colore o selo do sino: um erro somado a dois avisos não pode
 * virar um "3" neutro que esconde justamente o erro (design system, seção 5).
 */
const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warning: 1,
  danger: 2,
}

export function worstSeverity(list: Severity[]): Severity | null {
  return list.reduce<Severity | null>(
    (worst, s) =>
      worst === null || SEVERITY_RANK[s] > SEVERITY_RANK[worst] ? s : worst,
    null,
  )
}

/**
 * O que uma pessoa PODE ver: o que é dela, mais o da instalação se ela for
 * admin.
 *
 * **Não-admin não recebe a de instância, e isso é do brief 3.9**, não economia
 * de bytes: ela não pode resolver a condição, e sinal que a pessoa não consegue
 * apagar é ansiedade sem saída. Esconder no cliente não seria proteção — o
 * cliente é agnóstico e qualquer um fala HTTP com esta API.
 */
function visibleTo(user: { id: number; isAdmin: boolean }) {
  const mine = eq(notifications.userId, user.id)
  return user.isAdmin ? or(mine, eq(notifications.audience, 'instance')) : mine
}

export type Row = typeof notifications.$inferSelect

export function listFor(
  user: { id: number; isAdmin: boolean },
  opts: {
    include: 'open' | 'all'
    audience?: 'instance' | 'user'
    limit: number
    cursor?: number
  },
): { rows: Row[]; nextCursor: number | null } {
  const where = [visibleTo(user)]
  if (opts.include === 'open') {
    where.push(isNull(notifications.dismissedAt))
  }
  if (opts.audience) {
    where.push(eq(notifications.audience, opts.audience))
  }
  if (opts.cursor !== undefined) {
    where.push(lt(notifications.id, opts.cursor))
  }

  // Pede um a mais pra saber se há próxima página sem uma segunda consulta —
  // e o extra é descartado, nunca devolvido.
  const rows = db
    .select()
    .from(notifications)
    .where(and(...where))
    .orderBy(desc(notifications.id))
    .limit(opts.limit + 1)
    .all()

  const page = rows.slice(0, opts.limit)
  const last = page.at(-1)
  return {
    rows: page,
    nextCursor: rows.length > opts.limit && last ? last.id : null,
  }
}

/**
 * O contador do sino: quantos não lidos, e a pior severidade entre eles.
 *
 * **Conta o não lido, não o não dispensado.** São dois estados: o selo some
 * quando a pessoa leu; a linha só sai do painel quando ela dispensa.
 */
export function unreadFor(user: { id: number; isAdmin: boolean }): {
  count: number
  severity: Severity | null
} {
  const rows = db
    .select({ severity: notifications.severity })
    .from(notifications)
    .where(
      and(
        visibleTo(user),
        isNull(notifications.readAt),
        isNull(notifications.dismissedAt),
      ),
    )
    .all()

  return {
    count: rows.length,
    severity: worstSeverity(rows.map((r) => r.severity)),
  }
}

export function markRead(
  user: { id: number; isAdmin: boolean },
  ids: number[],
): void {
  if (ids.length === 0) {
    return
  }
  // `visibleTo` no WHERE e não uma checagem antes: marcar o que não se pode ver
  // precisa ser impossível, não improvável.
  db.update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        visibleTo(user),
        isNull(notifications.readAt),
        inArray(notifications.id, ids),
      ),
    )
    .run()
}

/** Devolve `false` quando não havia nada dispensável com aquele id pra esta pessoa. */
export function dismiss(
  user: { id: number; isAdmin: boolean },
  id: number,
): boolean {
  const done = db
    .update(notifications)
    .set({ dismissedAt: new Date() })
    .where(
      and(
        visibleTo(user),
        eq(notifications.id, id),
        isNull(notifications.dismissedAt),
      ),
    )
    .returning({ id: notifications.id })
    .all()

  return done.length > 0
}

/**
 * Cria a notificação **se ainda não houver uma aberta com a mesma chave**.
 *
 * Quem garante isso é o índice único parcial, não este `if`: duas requisições
 * concorrentes passariam as duas por um `SELECT` antes de qualquer `INSERT`. O
 * `onConflictDoNothing` é a forma de deixar o banco decidir.
 *
 * `dedupeKey` ausente é evento puro — "o import terminou" acontece de novo a
 * cada import, e dois imports são dois fatos.
 */
export function emit(input: {
  audience: 'instance' | 'user'
  userId?: number
  severity: Severity
  kind: NotificationKind
  params?: Record<string, string | number>
  dedupeKey?: string
}): void {
  db.insert(notifications)
    .values({
      audience: input.audience,
      userId: input.userId ?? null,
      severity: input.severity,
      kind: input.kind,
      params: JSON.stringify(input.params ?? {}),
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .run()
}

/** As chaves de notificação ABERTA num grupo — o que o reconciliador já disse. */
export function openKeys(prefix: string): string[] {
  return db
    .select({ key: notifications.dedupeKey })
    .from(notifications)
    .where(
      and(
        isNull(notifications.dismissedAt),
        sql`${notifications.dedupeKey} LIKE ${`${prefix}%`}`,
      ),
    )
    .all()
    .flatMap((row) => (row.key === null ? [] : [row.key]))
}

/**
 * Emite **uma vez na vida da instalação** — nem mesmo depois de dispensada.
 *
 * É a terceira cardinalidade, e ela existe porque as outras duas erram no fato
 * que não tem volta:
 *
 * | | Quando reemite |
 * | --- | --- |
 * | evento puro (`emit` sem chave) | sempre — dois imports são dois fatos |
 * | condição (`emit` com chave) | quando volta a ser verdade |
 * | **fato da instalação** (aqui) | **nunca** |
 *
 * O caso que a pediu é o teto do cache de arte. Ele **não zera**: uma vez
 * cheio, o cache fica cheio, porque o descarte LRU é a feature funcionando e
 * não um defeito. Tratá-lo como condição faria o aviso voltar no primeiro
 * descarte depois de cada dispensa — um sinal que a pessoa não consegue apagar,
 * que é o que o brief 3.9 recusa. Tratá-lo como evento puro seria um aviso por
 * pôster baixado.
 *
 * A corrida entre o `SELECT` e o `INSERT` é inofensiva aqui: o índice único
 * parcial ainda barra duas ABERTAS, e o pior caso é uma segunda linha no
 * histórico de um fato que aconteceu mesmo.
 */
export function emitOnce(input: {
  audience: 'instance' | 'user'
  userId?: number
  severity: Severity
  kind: NotificationKind
  params?: Record<string, string | number>
  dedupeKey: string
}): void {
  const already = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.dedupeKey, input.dedupeKey))
    .get()

  if (already) {
    return
  }

  emit(input)
}

/**
 * Dispensa toda notificação aberta cuja chave NÃO está na lista das que ainda
 * valem — é a "condição resolvida se dispensa sozinha" (design system, seção
 * 5).
 *
 * Não é conceito novo: dispensar significa "terminei com isto", e resolver a
 * condição É terminar com ela. Por isso escreve `dismissed_at`, o mesmo campo
 * que a pessoa escreveria, e a linha continua no histórico — o evento
 * aconteceu.
 *
 * `prefix` limita o alcance ao grupo que este reconciliador conhece. Sem ele,
 * um reconciliador dispensaria o aviso de outro só por não saber dele.
 */
export function dismissResolved(prefix: string, stillTrue: string[]): void {
  const open = db
    .select({ id: notifications.id, key: notifications.dedupeKey })
    .from(notifications)
    .where(
      and(
        isNull(notifications.dismissedAt),
        sql`${notifications.dedupeKey} LIKE ${`${prefix}%`}`,
      ),
    )
    .all()

  const stale = open
    .filter((row) => row.key !== null && !stillTrue.includes(row.key))
    .map((row) => row.id)

  if (stale.length === 0) {
    return
  }

  db.update(notifications)
    .set({ dismissedAt: new Date() })
    .where(inArray(notifications.id, stale))
    .run()
}
