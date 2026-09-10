import type { ProviderEndpoints } from '../../db/schema/providers.js'

/**
 * A prosa do provedor virando texto puro, quando ele declara escrever em HTML.
 *
 * ── Por que existe ─────────────────────────────────────────────────────────
 * A sinopse do AniList vem com `<br>` e `<i>` dentro, e a tela renderiza
 * sinopse como texto — `{synopsis}`, sem `dangerouslySetInnerHTML`, que é o
 * certo pra texto de terceiro. Sem converter, as tags apareceriam literais.
 *
 * **Converter aqui e não na tela** porque o formato é fato do PROVEDOR (schema,
 * `ProviderEndpoints.textFormat`), e é o servidor que lê a definição. Mandar o
 * HTML cru pro cliente empurraria pra cada tela a decisão de o que fazer com
 * ele, e uma delas escolheria renderizar.
 *
 * ── O que ela NÃO é ────────────────────────────────────────────────────────
 * Não é sanitizador, e não precisa ser: o resultado é texto puro que a tela
 * imprime como texto. Ela **remove** marcação em vez de decidir qual é segura —
 * um `<script>` some junto com o `<i>`, e não porque foi reconhecido como
 * perigoso.
 */
export function htmlToText(bruto: string): string {
  return (
    bruto
      // `<br>` é quebra de parágrafo na prosa de catálogo, não separador
      // invisível: sem virar `\n` a sinopse do AniList vira um bloco só.
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      // Só as cinco entidades que aparecem em prosa de catálogo, mais o espaço
      // sem quebra. Uma tabela completa seria uma dependência pra resolver algo
      // que nenhum provedor observado escreve — e `&amp;` vem por último de
      // propósito, senão `&amp;lt;` viraria `<`.
      .replace(/&nbsp;/gi, ' ')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      // O AniList escreve `\n<br><br>\n` antes da linha de fonte, o que
      // resultaria em quatro quebras seguidas. Duas é um parágrafo; mais que
      // isso é buraco no meio do texto.
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/**
 * A prosa lida do provedor, já no formato que a tela consome.
 *
 * Fica numa função só porque são três os chamadores — a busca, o detalhe e o
 * mapa de unidades —, e é assim que eles não divergem sobre o que fazer com o
 * mesmo campo do mesmo provedor.
 */
export function prose(
  value: string | null,
  endpoints: Pick<ProviderEndpoints, 'textFormat'>,
): string | null {
  if (value === null || endpoints.textFormat !== 'html') {
    return value
  }
  return htmlToText(value) || null
}

/**
 * O SUBTIPO do provedor virando rótulo de tela — 02/09/2026.
 *
 * ── Por que normalizar, se o rótulo do grupo vem cru ───────────────────────
 * Porque os quatro provedores que têm subtipo devolvem coisas de naturezas
 * diferentes, e isso foi medido, não suposto:
 *
 * | Provedor | Campo | O que volta |
 * | --- | --- | --- |
 * | IGDB | `game_type.type` | `Main Game`, `Mod` — rótulo humano |
 * | AniList | `format` | `TV`, `ONA`, `MANGA`, `ONE_SHOT` — enum de máquina |
 * | Kitsu | `attributes.subtype` | `TV`, `manga` — minúsculo |
 * | Jikan | `type` | `TV` |
 *
 * Cru, a tela mostraria `ONE_SHOT` ao lado de `Main Game`. O `Season 1` do
 * grupo de unidades pode vir cru porque **é** uma frase que o provedor
 * escreveu; isto é uma constante do catálogo dele, e constante de catálogo não
 * é copy.
 *
 * **Genérico, sem mapa por provedor.** Um `{ ONE_SHOT: 'One shot' }` por
 * provedor seria conhecimento em código sobre o vocabulário de cada um — o
 * `if (slug === …)` que o brief 3.10 recusa, escrito de outro jeito. A regra
 * aqui não sabe de provedor nenhum: ela sabe de sublinhado e de caixa.
 *
 * **Sigla curta em maiúsculas sobrevive**, e é o que impede `ONA` de virar
 * `Ona` — o caso que faz title-case ingênuo estragar o dado em vez de arrumá-lo.
 * O corte em quatro letras é o que separa sigla (`TV`, `ONA`, `OVA`, `OEL`) de
 * palavra gritada (`MANGA`, `MUSIC`, `SPECIAL`).
 */
export function subtypeLabel(
  raw: string | null,
  /**
   * As siglas que ESTE par declara (`field_map.subtypeAcronyms`).
   *
   * Sem elas a função continua sabendo só de sublinhado e de caixa, que é o
   * que ela sempre soube — e é de propósito: lista de siglas de anime aqui
   * dentro seria vocabulário de um domínio numa função genérica. **Quem sabe
   * que `tv` é sigla é o provedor**, e ele declara.
   */
  acronyms: readonly string[] = [],
): string | null {
  if (raw === null) {
    return null
  }

  const words = raw
    .trim()
    .split(/[\s_]+/)
    .filter(Boolean)
  if (words.length === 0) {
    return null
  }

  /**
   * **A regra de FORMA só vale para valor de uma PALAVRA**, e isso foi um
   * teste que pegou: `ONE_SHOT` parte em `ONE` e `SHOT`, e as duas passariam
   * pela regra sozinhas — o resultado era `ONE SHOT`, gritado. Um valor com
   * sublinhado ou espaço **já se declarou composto**, e composto não é sigla.
   *
   * **A regra DECLARADA não tem essa restrição**, e é o que a torna necessária:
   * ela sabe qual palavra é sigla, então `tv_special` do MyAnimeList vira
   * `TV Special` e `TV_SHORT` do AniList vira `TV Short` — casos que a forma
   * sozinha não alcança, porque ali a sigla está DENTRO de um valor composto.
   */
  const shaped = words.length === 1
  const declared = new Set(acronyms.map((a) => a.toLowerCase()))

  return words
    .map((word) => {
      // Declarada: o provedor disse que é sigla, então ela grita venha em que
      // caixa vier.
      if (declared.has(word.toLowerCase())) {
        return word.toUpperCase()
      }
      // Forma: já está do jeito que se lê, e capitalizar a estragaria.
      if (shaped && word.length <= 4 && word === word.toUpperCase()) {
        return word
      }
      return word[0]?.toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

/**
 * A frase que o PROVEDOR escreveu ao recusar — 10/09/2026, decisão do dono.
 *
 * ── Por que ela vai pra tela ───────────────────────────────────────────────
 * Até aqui o motivo do provedor ia só pro log, e a tela mostrava copy nossa com
 * o status ao lado. Isso basta pra saber QUE falhou e não pra saber POR QUÊ — e
 * quem lê a recusa de um `4xx` é um admin que precisa consertar alguma coisa. O
 * 401 do IGDB é o exemplo que fecha o argumento: ele responde *"Ensure you are
 * sending Authorization and Client-ID as headers"*, que é literalmente a
 * instrução do conserto.
 *
 * **O custo está assumido:** ela vem em inglês e **não passa pelo catálogo**,
 * como a atribuição também não passa. A diferença é que a atribuição é licença;
 * esta é diagnóstico. Por isso ela é atribuída na tela — *a frase que EXPLICA um
 * resultado é da fonte que o produziu* (design system, seção 8) —, e nunca se
 * mistura com a nossa copy.
 *
 * ── O que ela NÃO tenta ser ────────────────────────────────────────────────
 * Não é o corpo cru. Provedor recusando manda de tudo — HTML de proxy, página
 * de erro, JSON aninhado —, e despejar isso numa caixa de 256px seria pior que
 * o silêncio de antes. Ela procura a frase nos campos onde as APIs a colocam,
 * aceita texto curto, e **desiste em silêncio** quando não acha: nulo aqui
 * devolve exatamente a tela de ontem.
 */
const MESSAGE_KEYS = [
  'message',
  'error',
  'error_description',
  'status_message',
  'detail',
  'title',
] as const

/** O teto é de LEITURA, não de segurança: duas linhas numa caixa estreita. */
const MAX = 180

export function providerMessage(body: unknown): string | null {
  const found = pick(body)
  if (found === null) {
    return null
  }

  /**
   * Uma linha só, e sem marcação: quebra e tag vêm de página de erro, e o que
   * sobra depois de tirá-las é o que valia a pena mostrar. Se não sobrar nada
   * legível, é nulo — a mesma desistência silenciosa de sempre.
   */
  const clean = found
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (clean === '') {
    return null
  }
  return clean.length > MAX ? `${clean.slice(0, MAX - 1).trimEnd()}…` : clean
}

function pick(body: unknown): string | null {
  if (typeof body === 'string') {
    // Corpo que já é texto: só vale se for curto o bastante pra ser uma frase.
    // Uma página de HTML inteira entra aqui, e é justamente o que não se mostra.
    return body.length <= 400 ? body : null
  }
  if (typeof body !== 'object' || body === null) {
    return null
  }

  const record = body as Record<string, unknown>
  for (const key of MESSAGE_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return value
    }
    /**
     * **O AniList aninha, e ele é o caso que motivou olhar aqui:** a recusa
     * dele vem em `errors: [{ message }]`. Um nível de profundidade cobre o que
     * os sete provedores fazem; mais que isso seria varrer JSON alheio à
     * procura de qualquer string, que é como se mostra uma chave de API sem
     * querer.
     */
    if (Array.isArray(value)) {
      const first = value[0]
      if (typeof first === 'string' && first.trim() !== '') {
        return first
      }
      if (typeof first === 'object' && first !== null) {
        const nested = (first as Record<string, unknown>).message
        if (typeof nested === 'string' && nested.trim() !== '') {
          return nested
        }
      }
    }
  }

  const errors = record.errors
  if (Array.isArray(errors)) {
    const first = errors[0]
    if (typeof first === 'object' && first !== null) {
      const message = (first as Record<string, unknown>).message
      if (typeof message === 'string' && message.trim() !== '') {
        return message
      }
    }
  }

  return null
}
