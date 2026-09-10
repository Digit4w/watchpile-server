import { env } from '../../env.js'
import type { Asset } from './updates.asset.js'

/**
 * A release mais nova publicada, lida da API do GitHub.
 *
 * ── `/releases/latest` NÃO serve, e isso foi medido ────────────────────────
 * Ele **exclui pre-release**, e em 10/09/2026 a única release deste produto é
 * uma pre-release (`v0.1.0`, cortada assim de propósito — brief, seção 8).
 * O endpoint responde **404**, medido contra o repositório real. O caminho
 * certo é a LISTA, que traz tudo.
 *
 * ── Pre-release CONTA, enquanto for o que este produto publica ─────────────
 * Hoje não há release estável nenhuma, então filtrá-las deixaria a checagem
 * sem nada pra encontrar. Um interruptor "receber pre-release" seria
 * vocabulário que nada exercita — *vocabulário não exercitado é o que nasce
 * errado* —, e ele nasce no dia em que existir uma release estável ao lado.
 *
 * ── A mais nova é por VERSÃO, não pela ordem da lista ──────────────────────
 * A API ordena por data de criação, e o CI deste produto **atualiza os
 * artefatos de uma release existente** quando a `main` é repromovida sem subir
 * a versão (`server/CLAUDE.md`, "Plano de distribuição"). Ordenar por data
 * acerta quase sempre e erra no dia em que um conserto sair numa branch
 * antiga — então quem escolhe é o comparador, sobre uma página curta.
 *
 * ── Rascunho fica de fora, e não por filtro nosso ──────────────────────────
 * O `draft` só aparece com autenticação, e esta consulta é anônima. O filtro
 * existe assim mesmo porque ele é barato e porque o dia em que alguém puser um
 * token aqui é o dia em que o rascunho apareceria — e a promessa da tela é
 * sobre o que está publicado.
 */
export type Release = {
  version: string
  url: string
  /**
   * Os arquivos publicados naquela release. Quem escolhe qual serve esta
   * máquina é `assetFor`, que é regra pura — aqui só se lê o que veio.
   */
  assets: Asset[]
}

export type FeedResult =
  | { ok: true; releases: Release[] }
  /** A rede, o prazo ou o formato — a tela não distingue, e nem precisa. */
  | { ok: false }

/**
 * `fetchImpl` injetado, como no cliente de provedores: a suíte **derruba o
 * `fetch` global** (`test/setup.ts`), e um módulo que o alcançasse por dentro
 * bateria na rede de verdade — foi assim que o aquecimento do cache de arte
 * consultou um provedor real centenas de vezes sem sinal nenhum, em 07/09.
 */
export async function readReleases(
  fetchImpl: typeof fetch = fetch,
): Promise<FeedResult> {
  const url = `https://api.github.com/repos/${env.WATCHPILE_UPDATE_REPO}/releases?per_page=10`

  try {
    const res = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        /**
         * O GitHub recusa requisição sem `User-Agent`. O nome do produto é o
         * que a documentação deles pede, e **a versão instalada NÃO entra
         * aqui**: ela não é necessária pra resposta, e mandá-la transformaria
         * uma consulta anônima num relato de qual build cada IP está rodando.
         */
        'User-Agent': 'Watchpile',
      },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      return { ok: false }
    }

    const body: unknown = await res.json()
    if (!Array.isArray(body)) {
      return { ok: false }
    }

    return { ok: true, releases: body.flatMap(toRelease) }
  } catch {
    /**
     * Sem rede, prazo estourado, DNS, JSON quebrado: **uma resposta só**. A
     * tela faz a mesma coisa em todos — diz que não conseguiu conferir e
     * oferece tentar —, e distinguir seria vocabulário sem consumidor.
     */
    return { ok: false }
  }
}

function toRelease(item: unknown): Release[] {
  if (typeof item !== 'object' || item === null) {
    return []
  }
  const {
    tag_name: tag,
    html_url: url,
    draft,
    assets,
  } = item as Record<string, unknown>
  if (draft === true || typeof tag !== 'string' || typeof url !== 'string') {
    return []
  }
  return [
    {
      version: tag,
      url,
      assets: Array.isArray(assets) ? assets.flatMap(toAsset) : [],
    },
  ]
}

function toAsset(item: unknown): Asset[] {
  if (typeof item !== 'object' || item === null) {
    return []
  }
  const { name, browser_download_url: url } = item as Record<string, unknown>
  if (typeof name !== 'string' || typeof url !== 'string') {
    return []
  }
  return [{ name, url }]
}
