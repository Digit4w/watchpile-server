import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { externalIds } from '../../db/schema/external-ids.js'
import type { SnapshotKey } from './titles.snapshot.js'

/**
 * Levar o total que o provedor acabou de dizer até as OBRAS — 13/09/2026.
 *
 * ── Por que isto não acontece sozinho ───────────────────────────────────────
 * `title_snapshots` é linha da INSTALAÇÃO: a chave é (provedor, id externo,
 * tipo) e não tem dono, de propósito — a mesma obra pode estar na biblioteca de
 * várias pessoas, e a resposta do provedor é a mesma para todas. `entries` é o
 * contrário: cada linha é de alguém e carrega o estado dele (brief, 3.9).
 *
 * Escrever de uma na outra atravessa essa fronteira, e por isso é um passo
 * explícito em vez de um efeito colateral de gravar o snapshot.
 *
 * ── Quando ele roda, e quando NÃO ───────────────────────────────────────────
 * **Só no `Refresh`**, manual ou em varredura — quando alguém PEDIU dado novo.
 * O aquecimento normal não propaga: ali o snapshot está nascendo, e as obras
 * acabaram de entrar com o total que a fonte trouxe. Propagar sempre reescreveria
 * dado do usuário sem ninguém ter pedido, que é o que a régua de 30/08 separa.
 *
 * ── A regra é SÓ PARA CIMA, e é decisão do dono (13/09/2026) ────────────────
 * O total cresce quando o provedor sabe mais do que está gravado, e **nunca
 * encolhe**. Três coisas a sustentam:
 *
 * - **É o que a realidade faz.** Mangá em publicação ganha capítulo; série
 *   ganha episódio. O caminho de baixo existe quase só quando o provedor
 *   perdeu dado, e ali o número antigo é o mais confiável dos dois
 * - **`entries.total` é do USUÁRIO** — pode ter sido digitado à mão, e pode
 *   estar certo contra um provedor incompleto. Encolher apagaria a correção de
 *   alguém com uma resposta automática
 * - **Progresso não pode ficar acima do teto.** Uma obra em `340 / 340` cujo
 *   provedor voltasse a dizer 12 passaria a exibir `340 / 12`, e o contador da
 *   tela lê exatamente esse par
 *
 * `NULL` conta como "não se sabe" e é preenchido — é o `12 / ?` da 3.11
 * finalmente ganhando denominador, que é o caso mais comum de obra vinda da
 * busca.
 */
export function propagateTotal(key: SnapshotKey, total: number | null): number {
  if (total === null || total <= 0) {
    return 0
  }

  /**
   * Uma escrita só, com a condição dentro do `WHERE`.
   *
   * Ler as obras, comparar em memória e escrever de volta custaria uma consulta
   * por obra e abriria a janela entre a leitura e a escrita — e quem mais mexe
   * em `entries` é a própria pessoa, ao vivo, na mesma instalação.
   */
  return db
    .update(entries)
    .set({ total, updatedAt: new Date() })
    .where(
      and(
        sql`${entries.id} IN (
          SELECT ${externalIds.entryId} FROM ${externalIds}
          WHERE ${externalIds.provider} = ${key.provider}
            AND ${externalIds.externalId} = ${key.externalId}
            AND ${externalIds.mediaType} = ${key.mediaType}
        )`,
        /** Só para cima: nulo ganha número, e número menor ganha o maior. */
        or(isNull(entries.total), lt(entries.total, total)),
        /**
         * **Obra de tipo trocado fica de fora.** O id de um provedor é único
         * DENTRO do tipo (07/09), e o vínculo já carrega o tipo — mas a obra
         * pode ter sido editada depois, e escrever um total de anime numa linha
         * que hoje é mangá seria plausível e errado.
         */
        eq(entries.mediaType, key.mediaType),
      ),
    )
    .returning({ id: entries.id })
    .all().length
}
