import type { entries } from '../../db/schema/entries.js'
import {
  ImportFailure,
  type ImportItem,
  type ImportSource,
  type SourceReading,
} from './import.types.js'

/**
 * O import do MyAnimeList (brief, 3.12).
 *
 * **Por NOME DE USUÁRIO, não por arquivo** — medido no Yamtrack em 06/09/2026 e
 * confirmado contra a API em 07/09: `GET /users/{nome}/animelist` devolve a
 * lista de um perfil público com o `X-MAL-Client-ID` sozinho, sem OAuth. Isso
 * poupa credencial por usuário e poupa a pessoa de achar o botão de export do
 * outro site.
 *
 * ── Tudo aqui foi MEDIDO, e a doc não bastava ───────────────────────────────
 * A referência oficial deles não traz uma amostra de resposta sequer. O
 * envelope, medido:
 *
 * ```
 * { data: [ { node: { id, title, main_picture },
 *             list_status: { status, score, num_episodes_watched, ... } } ],
 *   paging: { next: "<url completa>" } }
 * ```
 *
 * ── O `list_status` MUDA entre anime e mangá ────────────────────────────────
 * `num_episodes_watched` vira `num_chapters_read` (e há `num_volumes_read` ao
 * lado), e `is_rewatching` vira `is_rereading`. Não é detalhe: ler o campo
 * errado devolveria progresso zero para a lista inteira de mangá, sem erro
 * nenhum — a forma mais silenciosa de falhar.
 *
 * ── O status é OUTRO vocabulário, e o de mangá é outro ainda ────────────────
 * Medido em duas contas: anime usa `watching`/`plan_to_watch`, mangá usa
 * `reading`/`plan_to_read`, e os três do meio coincidem. A tradução para os
 * nossos cinco (brief, 3.16) é dado deste módulo, não do provedor.
 *
 * ── O par de identidade ─────────────────────────────────────────────────────
 * O MAL entrega **um** id, o dele. Então toda obra vinda daqui tem um vínculo
 * só, e `partialIdentity` é sempre verdadeiro: o AniList tem o id equivalente e
 * o import não tem como sabê-lo. É a mesma promessa que a tela faz — "came in
 * without a match", e a pessoa vincula o outro depois.
 */

type EntryStatus = (typeof entries.$inferSelect)['status']

/** Onde o id do MAL mora no nosso schema. */
const PROVIDER = 'mal'

/**
 * Quantos itens por página. **1000 é o teto documentado E medido** para lista de
 * usuário — a busca tem teto de 100, mas ela não é este caminho.
 *
 * Uma biblioteca de doze mil obras vira doze requisições. Vale dizer porque a
 * intuição erra ao contrário: **o import é o uso BARATO** do orçamento de
 * requisições; quem gasta é a busca, uma por tecla.
 */
const PAGE_SIZE = 1000

/** Teto de páginas, contra um perfil absurdo ou um `paging.next` em laço. */
const MAX_PAGES = 40

const STATUS: Record<string, EntryStatus> = {
  watching: 'watching',
  reading: 'watching',
  completed: 'completed',
  on_hold: 'on-hold',
  dropped: 'dropped',
  plan_to_watch: 'planned',
  plan_to_read: 'planned',
}

export function malSource(
  username: string,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): ImportSource {
  return {
    read: async () => {
      const anime = await readList('anime', username, clientId, fetchImpl)
      const manga = await readList('manga', username, clientId, fetchImpl)
      return {
        items: [...anime.items, ...manga.items],
        problems: [...anime.problems, ...manga.problems],
      }
    },
  }
}

async function readList(
  kind: 'anime' | 'manga',
  username: string,
  clientId: string,
  fetchImpl: typeof fetch,
): Promise<SourceReading> {
  const items: ImportItem[] = []
  let url =
    `https://api.myanimelist.net/v2/users/${encodeURIComponent(username)}` +
    `/${kind}list?limit=${PAGE_SIZE}&fields=list_status`

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await fetchPage(url, clientId, kind, fetchImpl)

    for (const row of body.data ?? []) {
      const item = toItem(row, kind)
      if (item) {
        items.push(item)
      }
    }

    /**
     * **`paging.next` é uma URL COMPLETA**, já com `offset` e `fields` dentro —
     * medido. Remontá-la à mão seria repetir uma conta que o provedor já fez, e
     * é como se perde um parâmetro numa página do meio.
     */
    const next = body.paging?.next
    if (!next) {
      return { items, problems: [] }
    }
    url = next
  }

  return { items, problems: [] }
}

type MalRow = {
  node?: { id?: number; title?: string }
  list_status?: Record<string, unknown>
}

type MalPage = { data?: MalRow[]; paging?: { next?: string } }

async function fetchPage(
  url: string,
  clientId: string,
  kind: 'anime' | 'manga',
  fetchImpl: typeof fetch,
): Promise<MalPage> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: { 'X-MAL-Client-ID': clientId, Accept: 'application/json' },
    })
  } catch {
    // A rede caiu. Não é recusa do provedor, e a saída de quem lê é esperar.
    throw new ImportFailure('source-down')
  }

  if (!response.ok) {
    throw failureOf(response.status, await safeJson(response), kind)
  }

  return (await response.json()) as MalPage
}

/**
 * Qual falha foi, e **o corpo é quem separa** — medido em 07/09/2026:
 *
 * | | status | `error` |
 * | --- | --- | --- |
 * | lista privada | **403** | `not_permitted` |
 * | sem credencial | **403** | `forbidden` |
 * | usuário não existe | 404 | `not_found` |
 * | credencial inválida | 400 | `bad_request` ("Invalid client id") |
 *
 * **Dois 403 com significados opostos.** Um manda a pessoa tornar o perfil
 * público; o outro é configuração da instalação. Decidir pelo status mandaria
 * metade das pessoas consertar a coisa errada — que é exatamente o defeito que
 * o conserto de recusa de hoje tirou da busca, aqui antes de nascer.
 */
function failureOf(
  status: number,
  body: { error?: string } | null,
  kind: 'anime' | 'manga',
): ImportFailure {
  const error = body?.error ?? ''

  if (status === 404 || error === 'not_found') {
    return new ImportFailure('user-not-found')
  }
  if (error === 'not_permitted') {
    /**
     * **A lista privada é de UM tipo, e mesmo assim derruba o job.** Medido: um
     * perfil pode ter o anime público e o mangá restrito. Importar metade em
     * silêncio seria pior que recusar — a pessoa veria a biblioteca sem mangá
     * nenhum e concluiria que o mangá dela sumiu.
     */
    return new ImportFailure('private-profile', { list: kind })
  }
  if (status >= 500) {
    return new ImportFailure('source-down')
  }
  // `forbidden` sem credencial e `bad_request` com credencial errada caem aqui:
  // nos dois há o que arrumar, e quem arruma é o admin.
  return new ImportFailure('source-refused')
}

async function safeJson(
  response: Response,
): Promise<{ error?: string } | null> {
  try {
    return (await response.json()) as { error?: string }
  } catch {
    return null
  }
}

function toItem(row: MalRow, kind: 'anime' | 'manga'): ImportItem | null {
  const id = row.node?.id
  const title = row.node?.title
  const raw = row.list_status ?? {}

  // Linha sem id ou sem título não tem o que gravar. Não vira problema porque a
  // fonte é a API deles, não um arquivo que alguém digitou: se isso acontecer,
  // é defeito nosso ou deles, e o log é onde ele aparece.
  if (typeof id !== 'number' || typeof title !== 'string' || title === '') {
    return null
  }

  const status = STATUS[String(raw.status ?? '')]
  if (!status) {
    return null
  }

  /**
   * **O campo de progresso muda com o tipo.** Ler o de anime numa lista de
   * mangá devolveria zero para todas, sem erro nenhum.
   */
  const progress =
    kind === 'anime' ? raw.num_episodes_watched : raw.num_chapters_read

  return {
    mediaType: kind,
    title,
    status,
    progress: typeof progress === 'number' ? progress : 0,
    /**
     * A lista **não** traz o total da obra — só o progresso de quem a
     * acompanha. Pedi-lo custaria `fields=node{num_episodes}` em toda página
     * para um dado que a tela de detalhe busca quando precisa.
     */
    total: null,
    links: [{ provider: PROVIDER, externalId: String(id) }],
    /**
     * **Sempre parcial**, e por construção: o MAL entrega um id só. O
     * equivalente no AniList existe e este import não tem como sabê-lo, então a
     * obra entra com um vínculo em vez de dois — que é exatamente o que a tela
     * promete ao oferecer o vínculo depois.
     */
    partialIdentity: true,
    occurredAt: dateOf(raw.updated_at),
  }
}

/**
 * `updated_at` é ISO **com fuso** (`2007-03-07T17:49:39+00:00`) — medido, e é o
 * que faz o evento retroativo do `event_log` cair no dia certo. Ilegível vira
 * nulo, e o evento passa a ser de agora: perder a data é menos grave que perder
 * a obra.
 */
function dateOf(raw: unknown): Date | null {
  if (typeof raw !== 'string' || raw === '') {
    return null
  }
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}
