import { artUrl, asString, readPath } from '../providers/providers.client.js'
import { detailFieldMapOf, fetchDetail } from '../providers/providers.detail.js'
import type { ProviderRow, TypeBinding } from '../providers/providers.query.js'

/**
 * Buscar a arte de uma obra no provedor (brief, 3.10).
 *
 * ── Por que passa pelo DETALHE, e não por uma coluna ────────────────────────
 * O que o provedor devolve é um caminho cru (`/abc.jpg`), e ele **não é
 * guardado em lugar nenhum** — a busca o transforma em URL na hora e joga
 * fora. Guardá-lo numa coluna nova pareceria mais barato e cobraria caro: seria
 * dado do provedor desnormalizado no nosso banco, que envelhece calado quando o
 * TMDB troca o pôster, e que a obra vinculada DEPOIS (brief, 3.10) não teria.
 *
 * O endpoint de detalhe já está na definição, com `{id}`, e a resposta dele
 * passa pelo **mesmo cache de resposta** da busca — então o custo real é uma
 * ida à rede por obra, não por pedido de imagem.
 *
 * ── O que ele NÃO faz ───────────────────────────────────────────────────────
 * Não tenta de novo, não enfileira e não busca em segundo plano. Falhar aqui é
 * a tela cair no ladrilho com a inicial, que é resposta legítima — e uma fila
 * é infraestrutura que este servidor não tem (brief, 3.1).
 */

/** Teto por arquivo. Pôster w342 tem ~40KB; 5MB é folga, não orçamento. */
const MAX_BYTES = 5 * 1024 * 1024

/**
 * Quanto esperar por uma ficha do limitador antes de desistir — e **este número
 * é NOSSO**, ao contrário do prazo e do teto, que são do provedor.
 *
 * Ele não mede o provedor: mede quanto tempo aceitamos segurar uma conexão HTTP
 * nossa esperando cota. Por isso não sai de `timeoutMs`, que é o prazo de uma
 * ida à rede — as duas coisas se somam e respondem a perguntas diferentes.
 *
 * Cinco segundos porque do outro lado há uma carta na tela: até aí a arte
 * aparecendo tarde é melhor que ladrilho em branco, e depois disso é o
 * contrário. A 3/s isso cobre quinze cartas de fila; a 0,5/s do AniList, duas —
 * e ali desistir é a resposta honesta.
 */
const TOKEN_WAIT_MS = 5_000

export type FetchedArt = { bytes: Buffer; contentType: string }

export type ArtFailure =
  | 'not-configured'
  | 'rate-limited'
  | 'no-art'
  | 'provider-error'
  | 'unreachable'

export type ArtOutcome =
  | { ok: true; art: FetchedArt }
  | { ok: false; reason: ArtFailure }

export async function fetchArt({
  provider,
  binding,
  externalId,
  waitForTokenMs,
  fetchImpl = fetch,
}: {
  provider: ProviderRow
  /** O par, que decide qual detalhe ler — `/movie/{id}` contra `/tv/{id}`. */
  binding?: TypeBinding | null
  externalId: string
  /**
   * Sobrescreve o orçamento de espera. Quem passa é o aquecimento do import,
   * que é trabalho de segundo plano e pode esperar muito mais que uma carta.
   */
  waitForTokenMs?: number
  /** Injetável só para teste; produção usa o `fetch` global do Node. */
  fetchImpl?: typeof fetch
}): Promise<ArtOutcome> {
  // O mapa do DETALHE, não o da busca: é da resposta de detalhe que a arte
  // sai, e no Open Library os dois endpoints a nomeiam diferente.
  const map = detailFieldMapOf(provider, binding)

  if (!map.art) {
    // A definição não diz onde a arte mora. Não é falha: provedor de metadados
    // sem imagem é legítimo, e a tela desenha a inicial.
    return { ok: false, reason: 'no-art' }
  }

  /**
   * O detalhe vem de `providers.detail.ts`, que é o mesmo caminho da tela de
   * obra. Antes esta função montava a requisição por conta própria — duas
   * chamadas ao mesmo endpoint com dois parsers, que é a duplicação que só se
   * percebe quando as duas divergem.
   */
  const detail = await fetchDetail({
    provider,
    binding,
    externalId,
    /**
     * **Aqui se ESPERA pela ficha, e é o que separa esta chamada da busca.**
     * Um `<img>` não tenta de novo, não lê corpo de erro e não sabe que foi
     * recusado por cota — recusar nele não é "tente de novo", é ladrilho em
     * branco até alguém recarregar a página. Medido em 07/09/2026: numa grade
     * fria de 20 cartas de um provedor a 3/s, oito voltavam vazias.
     */
    waitForTokenMs: waitForTokenMs ?? TOKEN_WAIT_MS,
    fetchImpl,
  })

  if (!detail.ok) {
    // `not-found` no provedor é o mesmo destino que os outros aqui: não há
    // arte pra servir, e a tela cai no ladrilho.
    return {
      ok: false,
      reason: detail.reason === 'not-found' ? 'no-art' : detail.reason,
    }
  }

  const url = artUrl(
    asString(readPath(detail.body, map.art)),
    provider.artTemplate,
  )

  if (!url) {
    // A obra existe no provedor e não tem pôster. Caso comum em catálogo
    // grande, e não é erro de ninguém.
    return { ok: false, reason: 'no-art' }
  }

  /**
   * A imagem em si **não passa pelo limitador nem pelo cache de resposta**: ela
   * quase nunca sai do mesmo host da API (no TMDB é uma CDN separada), a cota
   * que o limitador protege é a da API, e guardar bytes de imagem na tabela de
   * respostas colocaria um binário onde só há texto. Quem guarda a imagem é o
   * cache em disco, que é o ponto deste ciclo.
   */
  try {
    const image = await fetchImpl(url, {
      /**
       * **O mesmo prazo da API dele, e não um segundo número.** A imagem quase
       * nunca sai do mesmo host (no TMDB é uma CDN separada), o que tentaria
       * justificar um prazo próprio — mas o campo que existisse pra isso teria
       * um valor só, calibrado por ninguém, que é exatamente o defeito que este
       * ciclo veio tirar. Um provedor que declara 30s aceita gastar 30s aqui;
       * o custo é uma imagem pendurada, e a tela cai no ladrilho quando cair.
       */
      signal: AbortSignal.timeout(provider.timeoutMs),
    })

    if (!image.ok) {
      return { ok: false, reason: 'provider-error' }
    }

    const contentType = image.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
      // O provedor respondeu, mas não com uma imagem — uma página de erro em
      // HTML, tipicamente. Gravar isso encheria o cache de lixo servido como
      // arte, e o navegador desenharia o ícone de imagem quebrada.
      return { ok: false, reason: 'provider-error' }
    }

    const bytes = Buffer.from(await image.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      return { ok: false, reason: 'provider-error' }
    }

    return { ok: true, art: { bytes, contentType } }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}
