import { z } from '@hono/zod-openapi'
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import { createSelectSchema } from 'drizzle-zod'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { pileEntries } from '../../db/schema/pile-entries.js'
import { piles } from '../../db/schema/piles.js'
import { PILE_PREVIEW_SIZE } from './piles.query.js'

/**
 * A forma pública da pilha — as colunas que viajam e o schema que as descreve,
 * **no mesmo arquivo e de propósito**.
 *
 * Nasceu em 31/08/2026, quando a capa em BLOB entrou (brief, 3.17) e mostrou
 * que a forma estava duplicada em quatro lugares: dois `PileSchema` montados
 * por `createSelectSchema` em features diferentes, e dois jeitos de escolher
 * coluna nos handlers. Três dos quatro passaram a carregar o BLOB sem ninguém
 * escrever uma linha sobre capa — e o quarto, `GET /api/piles`, só escapou
 * porque listava coluna a coluna.
 *
 * O sintoma foi ruidoso e o diagnóstico é que ele podia não ter sido: o
 * gerador de contrato quebrou porque `blob` vira `z.custom` e o OpenAPI não
 * sabe serializá-lo. Sem esse acidente, o BLOB teria começado a sair em base64
 * dentro do JSON de `GET /api/entries/{id}/piles`, e a primeira notícia seria
 * uma tela lenta.
 */

/**
 * O que sai da capa é **se existe uma**, nunca ela.
 *
 * O BLOB tem dezenas de KB e uma listagem devolve dezenas de pilhas: mandá-lo
 * em base64 multiplicaria a resposta por mil pra desenhar um quadrado de
 * 150px. A capa tem endereço próprio, que o navegador cacheia como cacheia
 * qualquer imagem.
 *
 * `.mapWith(Boolean)` não é enfeite: SQLite não tem booleano, `is not null`
 * devolve 0 ou 1, e sem a conversão o `sql<boolean>` seria só uma afirmação de
 * tipagem — o JSON sairia com `0` contra um contrato que promete `boolean`.
 */
export const publicPileColumns = {
  id: piles.id,
  name: piles.name,
  description: piles.description,
  removeWhenCompleted: piles.removeWhenCompleted,
  pinnedAt: piles.pinnedAt,
  createdAt: piles.createdAt,
  updatedAt: piles.updatedAt,
  hasCover: sql<boolean>`${piles.cover} is not null`.mapWith(Boolean),
} as const

/**
 * O contrato correspondente. Ele e as colunas acima têm que concordar, e é por
 * isso que moram juntos: separados, o dia em que discordarem produz um cliente
 * tipado contra um JSON que não existe.
 */
export const PublicPileSchema = createSelectSchema(piles)
  .omit({ userId: true, cover: true, coverType: true })
  .extend({
    /**
     * O primeiro degrau da escada de identidade do container (design system,
     * seção 5): capa subida > mosaico 2×2 > uma peça > ladrilho vazio. Sem
     * isto o cliente teria que tentar carregar a capa e ler o 404 como "não
     * tem", que é usar erro como resposta.
     */
    hasCover: z.boolean(),
  })

/**
 * A pilha como ela sai daqui: sem dono, **sem o BLOB da capa**, e com um
 * booleano no lugar dele.
 *
 * Tirar `cover` do tipo não é higiene de tipagem — é o que faz o compilador
 * recusar um `select()` sem colunas, que é exatamente como o BLOB voltaria a
 * ser lido em toda listagem sem ninguém notar.
 */
export type PublicPile = z.infer<typeof PublicPileSchema>

/**
 * O mínimo pra desenhar uma peça do mosaico 2×2, e nada além.
 *
 * Só `title` porque a arte de obra ainda é a inicial do título sobre um
 * degradê (o provedor de metadados é 3.10 e não existe). `id` viaja junto não
 * pra ser usado agora, mas pra ser a chave de lista estável do React — dois
 * títulos iguais na mesma pilha são possíveis.
 */
const PilePreviewSchema = z
  .object({
    id: z.number().int(),
    title: z.string(),
  })
  .openapi('PilePreview')

/**
 * A pilha com o que a tela precisa dela, e não com o que a tabela guarda.
 *
 * `entryCount` e `preview` são derivados de `pile_entries`, não colunas. Eles
 * entram na resposta de TODA rota de pilha, e não só na listagem: quem cria
 * uma pilha, renomeia, sobe capa ou tira capa põe a resposta direto no cache
 * da lista, e uma forma diferente por rota obrigaria o cliente a remendar o
 * buraco em cada uma.
 *
 * `GET /api/entries/{id}/piles` é a exceção consciente e usa a forma enxuta:
 * ali a pergunta é "em quais pilhas esta obra está", e contagem e mosaico de
 * cada uma seriam trabalho de banco pra desenhar um chip com um nome dentro.
 */
export const PileWithDetailsSchema = PublicPileSchema.extend({
  entryCount: z.number().int(),
  preview: z.array(PilePreviewSchema),
})
  /**
   * O nome que a pilha tem NO contrato — `components.schemas.Pile` (brief,
   * 3.7). É esta a forma que sai de TODA rota de pilha, e por isso é ela que
   * leva o nome; a forma enxuta de `GET /api/entries/{id}/piles` segue anônima
   * de propósito, porque nomeá-la anunciaria uma segunda pilha que não existe.
   */
  .openapi('Pile')

type PilePreview = { id: number; title: string }

/**
 * As primeiras obras de cada pilha, na ordem manual da pilha — o mosaico 2×2
 * do ladrilho (`design/mockups/piles.html`).
 *
 * Uma consulta só para todas as pilhas da tela, com `row_number()` cortando em
 * quatro por pilha DENTRO do banco. A alternativa óbvia — ler todas as
 * associações e cortar em JavaScript — lê a biblioteca inteira pra desenhar no
 * máximo quatro iniciais por ladrilho, e cresce com o tamanho do acervo em vez
 * de com o número de pilhas na tela.
 *
 * O desempate por `entry_id` acompanha o de `piles.entries.handlers.ts`: duas
 * obras podem compartilhar a mesma `position` depois de um rebalanceamento, e
 * sem o desempate o mosaico troca de peças entre dois `GET` idênticos.
 */
export function previewsFor(pileIds: number[]): Map<number, PilePreview[]> {
  const previews = new Map<number, PilePreview[]>()
  if (pileIds.length === 0) {
    return previews
  }

  const ranked = db
    .select({
      pileId: pileEntries.pileId,
      entryId: entries.id,
      title: entries.title,
      rank: sql<number>`row_number() over (
        partition by ${pileEntries.pileId}
        order by ${pileEntries.position}, ${pileEntries.entryId}
      )`.as('rank'),
    })
    .from(pileEntries)
    .innerJoin(entries, eq(entries.id, pileEntries.entryId))
    .where(inArray(pileEntries.pileId, pileIds))
    .as('ranked')

  const rows = db
    .select({
      pileId: ranked.pileId,
      id: ranked.entryId,
      title: ranked.title,
    })
    .from(ranked)
    .where(lte(ranked.rank, PILE_PREVIEW_SIZE))
    .orderBy(asc(ranked.pileId), asc(ranked.rank))
    .all()

  for (const { pileId, ...entry } of rows) {
    const current = previews.get(pileId)
    if (current) {
      current.push(entry)
    } else {
      previews.set(pileId, [entry])
    }
  }

  return previews
}

/**
 * A pilha isolada, com o que a listagem calcula em bloco.
 *
 * Duas consultas por pilha, e não vale otimizar: isto roda em `GET /{id}`,
 * `POST` e `PATCH` — uma pilha por vez, contra um SQLite local.
 */
export function withDetails(pile: PublicPile) {
  const counted = db
    .select({ total: sql<number>`count(*)` })
    .from(pileEntries)
    .where(eq(pileEntries.pileId, pile.id))
    .get()

  return {
    ...pile,
    entryCount: counted?.total ?? 0,
    preview: previewsFor([pile.id]).get(pile.id) ?? [],
  }
}

/** A pilha do usuário, ou `undefined` — dono e existência na mesma pergunta. */
export function findPile(id: number, userId: number): PublicPile | undefined {
  return db
    .select(publicPileColumns)
    .from(piles)
    .where(and(eq(piles.id, id), eq(piles.userId, userId)))
    .get()
}
