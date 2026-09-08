import { asc, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { externalIds } from '../../db/schema/external-ids.js'

export type EntrySource = { provider: string; externalId: string }

/**
 * De qual vínculo a obra fala, quando ela tem mais de um.
 *
 * ── A cadeia tem DOIS degraus, e tinha três até 02/09/2026 ──────────────────
 *
 * 1. o **override da obra** (`entries.primary_provider`), se ele estiver entre
 *    os vínculos dela
 * 2. senão, o vínculo **mais antigo** — o provedor de onde a obra veio
 *
 * O degrau que saiu foi o **provedor padrão do tipo**, e tirá-lo foi decisão do dono
 * do projeto. Três motivos, e o terceiro é o que decide:
 *
 * - **A copy nunca prometeu isso.** `/settings/media-types` fala só de busca
 *   ("which one answers"), e essa redação é uma correção deliberada de
 *   02/09/2026, feita porque o consumidor de obra estava dormente. Vincular
 *   obra existente o acordou sem que a promessa voltasse
 * - **Na trilha comum os dois critérios dão a MESMA resposta.** O primeiro
 *   vínculo de uma obra vinda da busca é o provedor que respondeu, e quem
 *   responde a busca é o padrão. Eles só divergem quando alguém buscou de
 *   propósito num provedor fora do padrão — e ali *o que a pessoa de fato usou* é
 *   o padrão melhor
 * - **A régua de 30/08 põe cada um do seu lado** (brief, 3.9): "qual provedor
 *   responde a busca neste servidor" é infraestrutura, do admin; "de qual
 *   vínculo ESTA obra fala" é propriedade da obra, que é conteúdo do usuário. O
 *   padrão decidindo as duas era o borrão
 *
 * ── O que isso compra, além de clareza ──────────────────────────────────────
 * **A fonte efetiva passa a mudar só por ato explícito.** Vincular um segundo
 * provedor nunca troca nada, porque o mais antigo continua falando — então não
 * existe a troca silenciosa que reescreveria sinopse e arte sem ninguém pedir.
 * Uma regra em vez de duas.
 *
 * ── E continua determinístico, que importa duas vezes ───────────────────────
 * A chave do cache de arte é (provedor, id externo), e um desempate instável
 * gravaria a mesma obra duas vezes; e a tela de detalhe mostraria uma sinopse
 * diferente a cada visita.
 *
 * Extraído de `art.handlers.ts` em 01/09/2026, quando a tela de detalhe passou
 * a fazer a mesma pergunta. Duas cópias desta escolha divergiriam no dia em
 * que alguém mexesse numa.
 */
export function sourceOf(
  entryId: number,
  /**
   * `entries.primary_provider` — a escolha de quem é dono da obra, ou nulo.
   *
   * Vem por parâmetro e não por consulta aqui dentro porque **todo chamador já
   * tem a linha de `entries` na mão**: buscá-la de novo seria uma segunda
   * leitura do mesmo dado, e é assim que duas leituras acabam discordando.
   */
  primaryProvider: string | null,
): EntrySource | null {
  const links = db
    .select()
    .from(externalIds)
    .where(eq(externalIds.entryId, entryId))
    .orderBy(asc(externalIds.createdAt), asc(externalIds.id))
    .all()

  if (links.length === 0) {
    return null
  }

  /**
   * Override que aponta pra um provedor que a obra **não tem** cai fora em vez
   * de zerar a resposta: é o estado que sobra se o vínculo for embora por fora
   * (o `DELETE` da rota limpa a coluna, mas um `db:seed` ou um acerto manual
   * não). Ignorar o degrau devolve a obra ao vínculo mais antigo, que é a
   * resposta certa; devolver nulo apagaria a arte e a sinopse dela.
   */
  const chosen =
    links.find((vínculo) => vínculo.provider === primaryProvider) ?? links[0]

  return chosen
    ? { provider: chosen.provider, externalId: chosen.externalId }
    : null
}
