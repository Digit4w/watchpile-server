import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { eventLog } from '../../db/schema/event-log.js'
import { externalIds } from '../../db/schema/external-ids.js'
import { mediaTypes } from '../../db/schema/media-types.js'
import { providers } from '../../db/schema/providers.js'
import type { ApplyItem, ApplyOutcome, ImportItem } from './import.types.js'

/**
 * A escrita de uma obra importada (brief, 3.12).
 *
 * É a metade que o executor não conhece: ele conta resultados e cede o event
 * loop; isto decide o que a obra vira. Separadas porque falham de jeitos
 * diferentes e se provam com testes diferentes.
 *
 * ── A conciliação, que é a decisão inteira do ciclo ─────────────────────────
 * **Casa pelo id que veio; o que não casa ENTRA assim mesmo.**
 *
 * O Yamtrack, medido em 06/09/2026, faz o contrário — `if idMal is None:
 * warning; return`, e a obra se perde com um aviso. Ele não tem escolha: anime
 * e mangá vivem lá sob uma fonte única, e o id do AniList não tem onde morar.
 * Aqui `external_ids` é tabela (brief, 3.12), então **há onde pendurar o id que
 * veio junto, sem migration** — e é exatamente isso que o brief previa quando
 * chamou essa tabela de "o argumento mais forte" a favor do modelo.
 *
 * **Casar por título continua descartado** (brief, 3.10): heurística que erra
 * junta duas obras diferentes num acervo que a pessoa não vai reconferir.
 * Consequência assumida: uma linha de CSV sem id nenhum **não tem identidade**,
 * então reimportar o mesmo arquivo a duplica. Honesto — a alternativa seria
 * inventar certeza.
 *
 * ── `overwrite` substitui o ESTADO, nunca a obra ────────────────────────────
 * O `overwrite` do Yamtrack apaga a linha e recria. Na nossa `entries` moram
 * progresso, o `event_log` que aponta pra ela, as pilhas de que participa,
 * nota, notas e os outros vínculos — **nada disso vem no import**, e apagar
 * levaria tudo junto. Aqui ele escreve status, progresso e o vínculo da fonte;
 * o resto sobrevive.
 *
 * ── Toda escrita de progresso passa pelo log ────────────────────────────────
 * Contador e evento na MESMA transação, que é a invariante do brief 3.11 —
 * derivável do log, nunca derivado em leitura. `origin: 'import'` é o que
 * permite desfazer um import inteiro no dia em que isso existir, e
 * `occurred_at` é a data da FONTE quando ela diz, não a de agora: sem isso o
 * histórico de dez anos de alguém nasceria todo carimbado no dia da mudança.
 */

/**
 * Constrói o aplicador de UMA importação.
 *
 * O vocabulário da instalação — tipos e provedores — é lido **uma vez**, no
 * começo, e não a cada item. São duas consultas em vez de duas por obra, e o
 * efeito colateral é bom: o import inteiro roda contra um vocabulário estável,
 * então um tipo criado no meio dele não faz metade das linhas serem julgadas
 * por uma regra e metade por outra.
 */
export function createApplier(userId: number): ApplyItem {
  const knownTypes = new Set(
    db
      .select({ slug: mediaTypes.slug })
      .from(mediaTypes)
      .all()
      .map((r) => r.slug),
  )
  const knownProviders = new Set(
    db
      .select({ slug: providers.slug })
      .from(providers)
      .all()
      .map((r) => r.slug),
  )

  return (item, mode) =>
    applyOne({ item, mode, userId, knownTypes, knownProviders })
}

function applyOne({
  item,
  mode,
  userId,
  knownTypes,
  knownProviders,
}: {
  item: ImportItem
  mode: 'skip' | 'overwrite'
  userId: number
  knownTypes: ReadonlySet<string>
  knownProviders: ReadonlySet<string>
}): ApplyOutcome {
  /**
   * O tipo é recusado ANTES de qualquer escrita, e vira problema do item — não
   * falha do job. Uma instalação que apagou `anime` no wizard (brief, 3.9) não
   * deve ver o import inteiro morrer por causa disso: os mangás entram.
   */
  if (!knownTypes.has(item.mediaType)) {
    return problem(item, 'unknown-media-type', { value: item.mediaType })
  }

  /**
   * Vínculo pra provedor que esta instalação não tem **cai fora**, e o item
   * segue — é a mesma régua que os vínculos entre obras já usam (brief, 3.10):
   * o que não é navegável não entra. Se TODOS caírem, a obra entra sem vínculo
   * nenhum, que é o estado legítimo de quem digitou à mão.
   */
  const usableLinks = item.links.filter((l) => knownProviders.has(l.provider))

  if (usableLinks.length === 0 && item.links.length > 0) {
    return problem(item, 'unknown-source', {
      value: item.links.map((l) => l.provider).join(', '),
    })
  }

  const existingId = findExisting(userId, item.mediaType, usableLinks)

  if (existingId !== undefined) {
    if (mode === 'skip') {
      return { kind: 'skipped' }
    }
    overwriteState(existingId, item, usableLinks)
    return { kind: 'updated' }
  }

  insertEntry(userId, item, usableLinks)
  return { kind: 'added', unmatched: item.partialIdentity }
}

function problem(
  item: ImportItem,
  kind: 'unknown-media-type' | 'unknown-source',
  params: Record<string, string | number>,
): ApplyOutcome {
  return {
    kind: 'problem',
    problem: {
      kind,
      ...(item.row === undefined ? {} : { row: item.row }),
      params,
    },
  }
}

/**
 * A obra que JÁ é desta pessoa, achada por qualquer um dos ids que vieram.
 *
 * **Qualquer um basta, e isso é a conciliação funcionando.** Uma obra
 * adicionada pela busca do AniList tem o id dele; a mesma obra vindo de um
 * import de MAL traz o `idMal`. Casar por um id só faria a segunda entrar
 * duplicada — e é o caso que o brief chama de "o caso difícil do import".
 */
function findExisting(
  userId: number,
  /**
   * **O tipo entra na chave, e sem ele a conciliação mente.** Medido em
   * 07/09/2026: importar 426 obras do MyAnimeList entregou 422, porque quatro
   * mangás — Death Note entre eles — têm o mesmo número de um anime, e a
   * consulta os leu como "já está na biblioteca". A tela contou as quatro como
   * puladas; elas nunca chegaram.
   */
  mediaType: string,
  links: readonly { provider: string; externalId: string }[],
): number | undefined {
  for (const link of links) {
    const row = db
      .select({ entryId: externalIds.entryId })
      .from(externalIds)
      .innerJoin(entries, eq(entries.id, externalIds.entryId))
      .where(
        and(
          eq(entries.userId, userId),
          eq(externalIds.provider, link.provider),
          eq(externalIds.mediaType, mediaType),
          eq(externalIds.externalId, link.externalId),
        ),
      )
      .get()

    if (row) {
      return row.entryId
    }
  }
  return undefined
}

function insertEntry(
  userId: number,
  item: ImportItem,
  links: readonly { provider: string; externalId: string }[],
): void {
  db.transaction((tx) => {
    const row = tx
      .insert(entries)
      .values({
        userId,
        mediaType: item.mediaType,
        title: item.title,
        status: item.status,
        progress: item.progress,
        total: item.total,
      })
      .returning({ id: entries.id })
      .get()

    for (const link of links) {
      tx.insert(externalIds)
        .values({
          entryId: row.id,
          provider: link.provider,
          externalId: link.externalId,
          mediaType: item.mediaType,
        })
        .run()
    }

    if (item.progress > 0) {
      tx.insert(eventLog)
        .values({
          entryId: row.id,
          type: 'progress_delta',
          delta: item.progress,
          origin: 'import',
          occurredAt: item.occurredAt ?? new Date(),
        })
        .run()
    }
  })
}

/**
 * `overwrite`: escreve o que o import TRAZ, e nada além.
 *
 * O que sobrevive, porque não vem no import e apagar seria perda de dado que
 * ninguém pediu: pilhas, nota, notas, o `event_log` inteiro e os vínculos com
 * outros provedores. O que muda: status, progresso, total, e os vínculos novos
 * que a fonte trouxe.
 *
 * **O delta pode ser negativo, e isso é o modelo funcionando** (brief, 3.11):
 * correção é evento novo com delta negativo, nunca `UPDATE` sem rastro. Um
 * import que diz "episódio 3" sobre uma obra em 10 grava `-7`, e o log continua
 * somando o contador.
 */
function overwriteState(
  entryId: number,
  item: ImportItem,
  links: readonly { provider: string; externalId: string }[],
): void {
  db.transaction((tx) => {
    const before = tx
      .select({ progress: entries.progress })
      .from(entries)
      .where(eq(entries.id, entryId))
      .get()

    tx.update(entries)
      .set({
        status: item.status,
        progress: item.progress,
        total: item.total,
      })
      .where(eq(entries.id, entryId))
      .run()

    const delta = item.progress - (before?.progress ?? 0)
    if (delta !== 0) {
      tx.insert(eventLog)
        .values({
          entryId,
          type: 'progress_delta',
          delta,
          origin: 'import',
          occurredAt: item.occurredAt ?? new Date(),
        })
        .run()
    }

    /**
     * Os vínculos que a fonte trouxe e a obra ainda não tinha. **Acrescenta,
     * nunca substitui** — o vínculo com outro provedor foi um ato de quem é
     * dono da obra, e um import não desfaz ato de ninguém.
     */
    const already = new Set(
      tx
        .select({ provider: externalIds.provider })
        .from(externalIds)
        .where(
          and(
            eq(externalIds.entryId, entryId),
            inArray(
              externalIds.provider,
              links.map((l) => l.provider),
            ),
          ),
        )
        .all()
        .map((r) => r.provider),
    )

    for (const link of links) {
      if (!already.has(link.provider)) {
        tx.insert(externalIds)
          .values({
            entryId,
            provider: link.provider,
            externalId: link.externalId,
            mediaType: item.mediaType,
          })
          .run()
      }
    }
  })
}
