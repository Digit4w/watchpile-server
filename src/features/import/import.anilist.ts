import type { entries } from '../../db/schema/entries.js'
import {
  ImportFailure,
  type ImportItem,
  type ImportSource,
} from './import.types.js'

/**
 * O import do AniList (brief, 3.12).
 *
 * ── ATENÇÃO: esta fonte NÃO FOI MEDIDA, e isso é estado, não descuido ───────
 * O AniList **desativou a própria API em 07/09/2026** — 403 em toda forma de
 * consulta, com o site no ar: *"The AniList API has been temporarily disabled
 * due to severe stability issues"*. Variei o pedido (Media simples, Page/search,
 * Viewer) antes de concluir, porque repetir um pedido não o verifica.
 *
 * Então, ao contrário do MyAnimeList — cuja definição inteira saiu de respostas
 * reais —, **esta fonte foi escrita a partir de duas fontes de segunda mão**:
 * a documentação deles, que está no ar, e o `integrations/imports/anilist.py`
 * do Yamtrack, que é uma implementação em produção e diz exatamente quais
 * campos pedir e por onde lê-los.
 *
 * **O que isso significa na prática:** a forma da consulta é confiável (é uma
 * query GraphQL, e o servidor a valida ou recusa por inteiro), e o que pode
 * estar errado é a LEITURA do envelope. Um teste com dublê prova o mapeamento
 * contra a forma que eu acredito ser a certa — não contra a que ela é.
 *
 * **A verificação é um passo só, no dia em que a API voltar:** rodar
 * `read()` contra um perfil público e conferir contagem, status e progresso,
 * como foi feito com o MAL. Até lá, esta fonte não deve ser oferecida na tela.
 *
 * ── O caso difícil do import mora aqui ──────────────────────────────────────
 * O AniList entrega o id DELE e, **nem sempre**, o `idMal` (brief, 3.12). O
 * Yamtrack **descarta a obra** quando o `idMal` falta — `if idMal is None:
 * warning; return` —, porque anime e mangá vivem lá sob fonte única e o id do
 * AniList não tem onde morar.
 *
 * Aqui os dois ids têm onde morar, então:
 *
 * - com `idMal`: **dois vínculos**, e a identidade está completa
 * - sem `idMal`: **um vínculo**, e `partialIdentity` — a obra ENTRA
 *
 * É a única fonte das três em que `partialIdentity` varia por item. No MAL ela
 * é sempre verdadeira (um id só); no CSV depende de a linha trazer id.
 *
 * ── As listas CUSTOMIZADAS ficam de fora ────────────────────────────────────
 * `MediaListCollection` devolve as listas de status **e** as customizadas que a
 * pessoa criou, e a mesma obra aparece nas duas. Sem filtrar, toda obra numa
 * lista customizada entraria duas vezes — o Yamtrack filtra por `isCustomList`,
 * e a conciliação por id nos salvaria de duplicar, mas ao custo de processar o
 * dobro e de contar errado no resultado.
 */

type EntryStatus = (typeof entries.$inferSelect)['status']

const PROVIDER = 'anilist'
/** Onde um id de MAL mora no nosso schema — ver `0036_mal.sql`. */
const MAL_PROVIDER = 'mal'

const ENDPOINT = 'https://graphql.anilist.co'

/**
 * Os cinco status deles, traduzidos para os nossos (brief, 3.16).
 *
 * `REPEATING` é "assistindo de novo", e cai em `watching` porque é o que a
 * pessoa está fazendo. Rewatch não tem modelo nosso e está fora do escopo deste
 * ciclo — tratá-lo como `completed` diria que ela terminou, o que ela pode não
 * ter feito nesta volta.
 */
const STATUS: Record<string, EntryStatus> = {
  CURRENT: 'watching',
  REPEATING: 'watching',
  COMPLETED: 'completed',
  PAUSED: 'on-hold',
  DROPPED: 'dropped',
  PLANNING: 'planned',
}

/**
 * A consulta, e ela pede as DUAS coleções de uma vez.
 *
 * `MediaListCollection` não pagina — devolve a coleção inteira do usuário numa
 * resposta —, então a lista de anime e a de mangá cabem no mesmo pedido. É uma
 * ida à rede em vez de duas, e o teto de 0,5 requisição por segundo do AniList
 * (medido em 02/09, contra o header deles) torna isso mais que estético.
 *
 * **`updatedAt` é UNIX EM SEGUNDOS** na resposta deles, e é o que vira
 * `occurred_at` retroativo no `event_log`.
 */
const QUERY = `query ($userName: String) {
  anime: MediaListCollection(userName: $userName, type: ANIME) {
    lists { isCustomList entries {
      status progress updatedAt
      media { id idMal title { userPreferred } episodes }
    } }
  }
  manga: MediaListCollection(userName: $userName, type: MANGA) {
    lists { isCustomList entries {
      status progress updatedAt
      media { id idMal title { userPreferred } chapters }
    } }
  }
}`

type AniEntry = {
  status?: string
  progress?: number
  updatedAt?: number
  media?: {
    id?: number
    idMal?: number | null
    title?: { userPreferred?: string }
    episodes?: number | null
    chapters?: number | null
  }
}

type AniCollection = {
  lists?: { isCustomList?: boolean; entries?: AniEntry[] }[]
}

type AniBody = {
  data?: { anime?: AniCollection; manga?: AniCollection }
  errors?: { message?: string }[]
}

export function anilistSource(
  username: string,
  fetchImpl: typeof fetch = fetch,
): ImportSource {
  return {
    read: async () => {
      const body = await fetchCollections(username, fetchImpl)
      return {
        items: [
          ...collect(body.data?.anime, 'anime'),
          ...collect(body.data?.manga, 'manga'),
        ],
        problems: [],
      }
    },
  }
}

async function fetchCollections(
  username: string,
  fetchImpl: typeof fetch,
): Promise<AniBody> {
  let response: Response
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query: QUERY, variables: { userName: username } }),
    })
  } catch {
    throw new ImportFailure('source-down')
  }

  const body = (await safeJson(response)) as AniBody | null

  /**
   * **Em GraphQL o erro vem no CORPO, e o status pode ser 200.** Conferir só
   * `response.ok` deixaria passar "User not found" como uma coleção vazia — e a
   * pessoa veria "0 obras importadas" achando que a conta dela está vazia.
   *
   * As mensagens vêm do Yamtrack, que as trata por texto: `User not found` e
   * `Private User`. Casar por texto é frágil e eu preferiria um código — o
   * AniList não fornece um, e é por isso que o `??` no fim existe.
   */
  const message = body?.errors?.[0]?.message ?? ''
  if (message === 'User not found') {
    throw new ImportFailure('user-not-found')
  }
  if (message === 'Private User') {
    throw new ImportFailure('private-profile')
  }

  if (!response.ok) {
    /**
     * **`4xx` daqui NÃO é do admin**, e é a mesma régua que o conserto de
     * 07/09/2026 fixou na busca: o AniList não pede credencial nenhuma pra ler
     * perfil público, então não há o que configurar. O 403 de hoje — a API
     * desativada por eles — é exatamente este caminho.
     */
    throw new ImportFailure('source-down')
  }

  if (message !== '') {
    // Erro de GraphQL que não reconhecemos, com status 200. Não é rede, não é
    // recusa nossa: é o servidor deles dizendo que não deu.
    throw new ImportFailure('source-down')
  }

  return body ?? {}
}

/**
 * As listas de STATUS, sem as customizadas.
 *
 * Uma obra numa lista customizada aparece **também** na lista de status dela,
 * então incluir as duas a processaria duas vezes. A conciliação por id evitaria
 * a duplicata no banco, mas o resultado contaria errado — e contar errado num
 * número que a pessoa lê é pior que um item a menos.
 */
function collect(
  collection: AniCollection | undefined,
  kind: 'anime' | 'manga',
): ImportItem[] {
  const items: ImportItem[] = []

  for (const list of collection?.lists ?? []) {
    if (list.isCustomList) {
      continue
    }
    for (const entry of list.entries ?? []) {
      const item = toItem(entry, kind)
      if (item) {
        items.push(item)
      }
    }
  }

  return items
}

function toItem(entry: AniEntry, kind: 'anime' | 'manga'): ImportItem | null {
  const id = entry.media?.id
  const title = entry.media?.title?.userPreferred

  if (typeof id !== 'number' || typeof title !== 'string' || title === '') {
    return null
  }

  const status = STATUS[String(entry.status ?? '')]
  if (!status) {
    return null
  }

  /**
   * **O par de identidade, e é aqui que a decisão do ciclo aparece em código.**
   *
   * O `idMal` é o mesmo id que o provedor `mal` usa, então ele vira um segundo
   * vínculo — e é o que faz esta obra CASAR com a mesma vinda de um import de
   * MyAnimeList, em vez de entrar duplicada.
   *
   * Quando ele falta, a obra entra com um vínculo só. O Yamtrack a descarta
   * aqui; nós não temos por quê.
   */
  const idMal = entry.media?.idMal
  const links = [{ provider: PROVIDER, externalId: String(id) }]
  if (typeof idMal === 'number' && idMal > 0) {
    links.push({ provider: MAL_PROVIDER, externalId: String(idMal) })
  }

  const total = kind === 'anime' ? entry.media?.episodes : entry.media?.chapters

  return {
    mediaType: kind,
    title,
    status,
    progress: typeof entry.progress === 'number' ? entry.progress : 0,
    /**
     * Ao contrário do MAL, o AniList devolve o total da obra na mesma consulta —
     * então ele viaja. `0` e `null` viram ausente: mangá em publicação não tem
     * último capítulo (brief, 3.12).
     */
    total: typeof total === 'number' && total > 0 ? total : null,
    links,
    /** Incompleta exatamente quando o `idMal` faltou. */
    partialIdentity: links.length < 2,
    occurredAt: dateOf(entry.updatedAt),
  }
}

/**
 * `updatedAt` é **UNIX em segundos** — a mesma armadilha que `yearFormat`
 * resolveu no IGDB: ler um timestamp como se fosse outra coisa produz um valor
 * plausível, na coluna certa, sem erro nenhum.
 *
 * `0` é o "nunca mexeram nisto" do AniList, e vira nulo — o evento passa a ser
 * de agora, em vez de 1970.
 */
function dateOf(raw: unknown): Date | null {
  if (typeof raw !== 'number' || raw <= 0) {
    return null
  }
  const date = new Date(raw * 1000)
  return Number.isNaN(date.getTime()) ? null : date
}

async function safeJson(response: Response): Promise<unknown | null> {
  try {
    return await response.json()
  } catch {
    return null
  }
}
