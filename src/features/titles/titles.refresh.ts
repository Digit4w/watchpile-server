import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { externalIds } from '../../db/schema/external-ids.js'
import type { ArtTarget } from '../art/art.warm.js'
import { warmArt } from '../art/art.warm.js'
import { propagateTotal } from './titles.propagate.js'
import { readSnapshot } from './titles.snapshot.js'

/**
 * Reler o que o provedor diz sobre obras que já estão na biblioteca
 * (brief, 3.10; item 11(c) e 11(d) da fila do dono).
 *
 * ── Por que ele reusa o aquecimento em vez de ter o próprio laço ────────────
 * Aquecer pergunta *"o que falta?"*; refrescar pergunta *"o que mudou?"*. O
 * PERCURSO é o mesmo — ficha do limitador, detalhe do provedor, arte em disco,
 * snapshot, pausa, cessão do event loop, falha que não derruba o processo —, e
 * um segundo módulo copiaria tudo isso para trocar duas condições. `WarmMode`
 * é o que separa as duas perguntas sem separar o caminho.
 *
 * ── O que ele escreve, e a fronteira que ele atravessa com cuidado ──────────
 * Arte e snapshot são da INSTALAÇÃO; `entries.total` é do USUÁRIO. A travessia
 * acontece em `propagateTotal`, **só para cima**, e é decisão do dono
 * (13/09/2026) — ver o módulo dela para os três argumentos.
 *
 * ── A varredura, e o que ela DEIXA pronto ───────────────────────────────────
 * `refreshTargets` responde "o que dá para atualizar" a partir dos vínculos, e
 * aceita um corte por idade (`staleBefore`). Hoje **ninguém passa esse corte**:
 * a varredura é sob demanda e atualiza tudo, porque quem apertou o botão pediu
 * agora. Ele existe porque o passo seguinte já está decidido — cron interno, no
 * futuro (decisão do dono, 13/09/2026) —, e o que um agendador precisa é
 * exatamente isto: *quais obras estão velhas o bastante para valer a ida à
 * rede*. `title_snapshots.fetched_at` é quem mede, e é por isso que a peça
 * nasce com o parâmetro em vez de ganhá-lo depois num segundo lugar.
 */

/**
 * Os alvos de uma obra — no máximo um, o vínculo que responde por ela.
 *
 * **O primeiro vínculo**, que é o critério de `sourceOf` quando não há escolha
 * explícita. Atualizar por outro gravaria uma arte que a rota nunca vai pedir.
 */
export function targetsForEntry(entryId: number, userId: number): ArtTarget[] {
  const row = db
    .select({
      provider: externalIds.provider,
      externalId: externalIds.externalId,
      mediaType: externalIds.mediaType,
    })
    .from(externalIds)
    .innerJoin(entries, eq(entries.id, externalIds.entryId))
    /** A guarda é do PAI: `external_ids` é dono por transitividade. */
    .where(and(eq(externalIds.entryId, entryId), eq(entries.userId, userId)))
    .orderBy(externalIds.id)
    .all()

  const first = row[0]
  return first ? [first] : []
}

/**
 * Tudo que a biblioteca de alguém tem como atualizar.
 *
 * Obra sem vínculo cai fora — não há de onde tirar nada, e é o mesmo recorte do
 * aquecimento. O `dedupe` de `warmArt` cuida de duas obras que apontem para a
 * mesma identidade externa.
 */
export function refreshTargets(
  userId: number,
  /**
   * Só o que foi lido antes deste instante. **Sem uso hoje** — ver o cabeçalho
   * do módulo: é o corte que o cron futuro vai passar, e a peça nasce com ele
   * porque é a pergunta que um agendador faz.
   */
  staleBefore?: Date,
): ArtTarget[] {
  const links = db
    .select({
      entryId: externalIds.entryId,
      provider: externalIds.provider,
      externalId: externalIds.externalId,
      mediaType: externalIds.mediaType,
    })
    .from(externalIds)
    .innerJoin(entries, eq(entries.id, externalIds.entryId))
    .where(eq(entries.userId, userId))
    /** A ordem é o que torna "o primeiro vínculo" determinístico. */
    .orderBy(externalIds.entryId, externalIds.id)
    .all()

  const seen = new Set<number>()
  const targets: ArtTarget[] = []

  for (const link of links) {
    if (seen.has(link.entryId)) {
      continue
    }
    seen.add(link.entryId)

    const target = {
      provider: link.provider,
      externalId: link.externalId,
      mediaType: link.mediaType,
    }

    if (staleBefore) {
      const snapshot = readSnapshot(target)
      /**
       * Sem snapshot é sempre alvo: nunca foi lido, então não há o que
       * considerar recente.
       */
      if (snapshot && snapshot.fetchedAt >= staleBefore) {
        continue
      }
    }

    targets.push(target)
  }

  return targets
}

/**
 * Roda o refresh sobre os alvos, propagando o total de cada um.
 *
 * Devolve quantas obras tiveram o total atualizado — o número que a tela mostra
 * depois de um refresh de uma obra só, e que num varrimento vira o total de
 * linhas que mudaram.
 */
export async function refreshTitles(
  targets: readonly ArtTarget[],
  options: {
    fetchImpl?: typeof fetch
    progress?: Parameters<typeof warmArt>[2]
  } = {},
): Promise<number> {
  let updated = 0

  await warmArt(targets, options.fetchImpl, options.progress, {
    force: true,
    fresh: true,
    onCaptured: (target) => {
      /**
       * Lê o snapshot que `captureSnapshot` **acabou de gravar** em vez de
       * receber os campos por parâmetro: é uma leitura local de uma linha que
       * está no cache de página do SQLite, e mantém `warmArt` sem saber o que é
       * um total.
       */
      const snapshot = readSnapshot(target)
      updated += propagateTotal(target, snapshot?.total ?? null)
    },
  })

  return updated
}
