import type { FieldMap, ProviderEndpoints } from '../../db/schema/providers.js'
import { prepareRequest } from './providers.auth.js'
import { optionVars } from './providers.body.js'
import {
  cacheKeyFor,
  pruneExpired,
  readCache,
  writeCache,
} from './providers.cache.js'
import { takeToken } from './providers.limiter.js'
import type { ProviderRow, TypeBinding } from './providers.query.js'
import { prose, providerMessage, subtypeLabel } from './providers.text.js'
import { forgetToken } from './providers.token.js'

/**
 * Um resultado de busca **não é uma obra**, e a distinção é deliberada.
 *
 * Ele não tem `id` nosso, nem status, nem progresso, nem dono — nada do que
 * `entries` guarda existe até alguém adicionar. Devolver algo com cara de
 * `Entry` e `id: null` seria a mentira que cobra depois: toda tela que
 * recebesse a lista teria que lembrar de checar o nulo, e uma esqueceria.
 *
 * Adicionar à biblioteca é um segundo passo, e é ele que cria a linha de
 * `entries` e a de `external_ids` juntas.
 */
export type ProviderResult = {
  provider: string
  externalId: string
  title: string
  /** O ano, extraído de uma data — nulo quando o provedor não devolve. */
  year: number | null
  /** Caminho ou URL da arte, como o provedor devolve. Cachear é outro ciclo. */
  art: string | null
  synopsis: string | null
  /**
   * O que a obra é dentro do tipo — `TV`, `Mod`, `One Shot`. Nulo nos
   * provedores que não têm (TMDB e Open Library).
   */
  subtype: string | null
}

export type SearchOutcome =
  | { ok: true; results: ProviderResult[]; cached: boolean }
  /** O tipo não tem provedor associado — o caso que o brief manda gritar. */
  | { ok: false; reason: 'no-provider' }
  /** O provedor existe mas não tem como autenticar. */
  | {
      ok: false
      reason: 'not-configured'
      provider: string
      credential: string
    }
  | { ok: false; reason: 'rate-limited'; provider: string }
  /**
   * **`4xx` e `5xx` são fatos diferentes, e o nome de cada um diz qual** —
   * 02/09/2026. O provedor recusou o NOSSO pedido (chave errada, parâmetro
   * inválido, caminho que não existe): há o que arrumar, e quem arruma é o
   * admin.
   *
   * O endpoint de TESTE já fazia essa distinção; a busca ficava para trás e
   * mandava os dois para "refused the search", que é a frase errada pro 504 do
   * Jikan. Um motivo só obrigaria a tela a reabrir o status pra decidir o tom e
   * o botão — e a régua é que **onde o servidor decide, a tela LÊ a decisão**.
   */
  | {
      ok: false
      reason: 'provider-refused'
      provider: string
      status: number
      /**
       * A frase que o PROVEDOR escreveu, quando ele escreveu uma — 10/09/2026.
       *
       * **Só no `refused`**, e é decisão: ali há o que arrumar, e a frase dele é
       * quem diz o quê (o 401 do IGDB responde com a instrução do conserto). No
       * `down` o corpo é quase sempre página de erro de proxy, e mostrá-la
       * gastaria a tela pra dizer "está fora do ar" com mais palavras.
       */
      detail: string | null
    }
  /** O provedor falhando do lado dele. Não há o que configurar; há o que esperar. */
  | { ok: false; reason: 'provider-down'; provider: string; status: number }
  | { ok: false; reason: 'unreachable'; provider: string }

/**
 * Lê um caminho pontuado do JSON do provedor — `poster_path`, `images.jpg.large`.
 *
 * É o que permite provedor novo sem código novo: a definição diz onde o campo
 * está, e isto vai lá buscar.
 */
function readOne(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((atual, parte) => {
    if (atual === null || typeof atual !== 'object') {
      return undefined
    }
    return (atual as Record<string, unknown>)[parte]
  }, source)
}

/**
 * Um valor VIÁVEL é escalar ou array — nunca objeto.
 *
 * É a regra que faz o caminho alternativo saber quando desistir do primeiro:
 * objeto não é folha, é lugar por onde se passa. Sem ela, `description` vindo
 * como `{type, value}` pararia a busca ali, porque "não é nulo".
 */
function usable(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false
  }
  return Array.isArray(value) || typeof value !== 'object'
}

/**
 * Um caminho dentro da resposta do provedor — ou **uma lista deles**, tentada
 * em ordem até a primeira que dê valor viável.
 *
 * ── Por que a lista existe — 02/09/2026 ────────────────────────────────────
 * O `description` do Open Library vem ora como `"texto"`, ora como
 * `{type, value}`: o provedor evoluiu o próprio formato sem reescrever os
 * registros antigos, e as duas formas convivem no acervo dele hoje. Isso não é
 * excentricidade de um catálogo — é o que acontece com **qualquer** API que
 * durou o bastante pra mudar de ideia sem quebrar cliente antigo.
 *
 * A alternativa era o mapa ganhar um "tipo" por campo, ou o cliente ganhar um
 * `if`. As duas erram o alvo: o que varia não é o TIPO do campo, é ONDE ele
 * está — e "onde" é justamente o que o mapa já sabe dizer.
 *
 * `string` continua valendo e é a forma comum. A lista é a exceção declarada.
 */
export type FieldPath = string | string[]

export function readPath(source: unknown, path: FieldPath): unknown {
  if (typeof path === 'string') {
    return readOne(source, path)
  }
  for (const candidate of path) {
    const value = readOne(source, candidate)
    if (usable(value)) {
      return value
    }
  }
  return undefined
}

export function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null
  }
  return typeof value === 'number' ? String(value) : null
}

/**
 * O ano de uma data do provedor — a ÚNICA conta desse tipo no repositório.
 *
 * ── Por que estava em dois lugares, e por que não está mais ────────────────
 * A busca lia os quatro primeiros dígitos por regex; o detalhe fazia
 * `parseInt(texto.slice(0, 4))`. As duas respondiam igual para `1999-10-15`, e
 * é assim que duas contas da mesma coisa convivem sem ninguém notar — até uma
 * delas precisar mudar. O formato Unix é essa mudança, e com duas cópias ela
 * entraria numa e não na outra.
 *
 * Os quatro primeiros dígitos, e não `new Date(...).getFullYear()`: o TMDB
 * devolve `""` para título sem data anunciada, e `new Date('')` é `Invalid
 * Date`, cujo `getFullYear()` é `NaN` — que vira `null` no JSON e passa por
 * ausência, mas só depois de atravessar o código inteiro como número inválido.
 */
export function yearOf(
  value: unknown,
  format?: FieldMap['yearFormat'],
): number | null {
  if (format === 'unix-seconds') {
    /**
     * **O IGDB devolve `first_release_date` como timestamp Unix**, e ler os
     * quatro primeiros dígitos de `1487894400` daria o ano **1487** — plausível,
     * na coluna certa, sem erro nenhum. É o modo de falhar mais caro que existe,
     * e é por isso que o formato se declara em vez de se adivinhar.
     */
    const seconds = typeof value === 'number' ? value : Number(asString(value))
    if (!Number.isFinite(seconds)) {
      return null
    }
    const year = new Date(seconds * 1000).getUTCFullYear()
    return Number.isFinite(year) ? year : null
  }

  const text = asString(value)
  const matched = text?.match(/^(\d{4})/)
  return matched ? Number(matched[1]) : null
}

/**
 * Substitui `{option:<chave>}` pelo valor efetivo da opção.
 *
 * É o que faz `nsfw` e `language` chegarem ao provedor **sem a opção precisar
 * declarar onde vai**: o lugar é propriedade do endpoint, não do formulário. Um
 * placeholder de opção que a definição não declara vira string vazia em vez de
 * viajar literal — mandar `include_adult={option:nsfw}` ao TMDB seria pedir uma
 * busca com lixo no parâmetro.
 */
function resolveTemplate(
  template: string,
  optionValues: Record<string, string | boolean>,
): string {
  return template.replace(/\{option:([^}]+)\}/g, (_todo, key: string) => {
    const value = optionValues[key]
    return value === undefined ? '' : String(value)
  })
}

/**
 * O valor cru de `art` virando URL de imagem.
 *
 * Três casos, e o terceiro é o que impede imagem quebrada:
 *
 * 1. já é absoluto → passa direto. Provedor que devolve URL não precisa de molde
 * 2. relativo e há molde → interpola. `{path}` recebe o valor como veio
 * 3. relativo e sem molde → **nulo**, e a tela cai no ladrilho com a inicial
 *
 * O molde vive na definição porque montar a URL é conhecimento do provedor —
 * escrevê-lo em código seria o atalho de embutido que o brief 3.10 recusa.
 */
export function artUrl(
  cru: string | null,
  template: string | null,
): string | null {
  if (!cru) {
    return null
  }
  if (/^https?:\/\//i.test(cru)) {
    return cru
  }
  return template ? template.replace('{path}', cru) : null
}

function mapResult(
  item: unknown,
  fieldMap: FieldMap,
  providerSlug: string,
  artTemplate: string | null,
  endpoints: Pick<ProviderEndpoints, 'textFormat'>,
): ProviderResult | null {
  const externalId = asString(readPath(item, fieldMap.externalId))
  const title = asString(readPath(item, fieldMap.title))

  // Sem id ou sem título não há o que mostrar nem o que adicionar depois. O
  // item é descartado em vez de virar uma linha vazia na lista — o TMDB devolve
  // pessoas no `/search/multi`, e elas não têm título nenhum.
  if (!externalId || !title) {
    return null
  }

  return {
    provider: providerSlug,
    externalId,
    title,
    year: fieldMap.year
      ? yearOf(readPath(item, fieldMap.year), fieldMap.yearFormat)
      : null,
    art: fieldMap.art
      ? artUrl(asString(readPath(item, fieldMap.art)), artTemplate)
      : null,
    synopsis: fieldMap.synopsis
      ? prose(asString(readPath(item, fieldMap.synopsis)), endpoints)
      : null,
    subtype: fieldMap.subtype
      ? subtypeLabel(
          asString(readPath(item, fieldMap.subtype)),
          fieldMap.subtypeAcronyms,
        )
      : null,
  }
}

/**
 * O cliente genérico: lê a definição e executa (brief, 3.10).
 *
 * **Ele não conhece o TMDB.** Tudo que decide o comportamento — URL, onde a
 * chave entra, qual endpoint, quais campos ler — vem da linha do banco. É isso
 * que faz o provedor do usuário ser cidadão de primeira: ele passa exatamente
 * por aqui.
 *
 * A ordem das checagens é a que gasta menos: sem provedor nem chega a montar
 * requisição; o cache vem antes do limitador, porque resposta cacheada não
 * consome cota nenhuma e recusá-la por rate limit seria cobrar por trabalho que
 * não vai acontecer.
 */
/**
 * De quem é o problema, quando o provedor responde e não é `2xx`.
 *
 * ── O status era um PROXY, e o proxy falha — 07/09/2026 ─────────────────────
 * A divisão de 02/09 diz `4xx` = "há o que arrumar, e quem arruma é o admin";
 * `5xx` = "há o que esperar". A pergunta que ela realmente faz é a primeira, e
 * o status era só um jeito barato de respondê-la.
 *
 * **Ele falha quando o provedor não tem credencial nenhuma.** O AniList
 * desativou a própria API em 07/09/2026 e passou a devolver **403** em toda
 * consulta — *"The AniList API has been temporarily disabled due to severe
 * stability issues"*. Pela regra antiga isso virava `provider-refused`, e a
 * tela oferecia `Open providers` a um admin que ia conferir a configuração e
 * não achar nada errado: **é o mesmo defeito que o 504 do Jikan motivou**, na
 * porta que a correção daquele dia não fechou.
 *
 * A saída é derivável e não precisa de vocabulário novo: um provedor que
 * **declara zero credenciais** não tem o que o admin configure, então um `4xx`
 * dele não pode ser "arrume a sua chave" — seja qual for a causa real. Cai em
 * `provider-down`, cuja copy ("The source is having trouble", tom `condition`,
 * sem botão de Settings) descreve exatamente o fato.
 *
 * ── O que NÃO muda, e é de propósito ────────────────────────────────────────
 * Provedor **com** credencial que devolve `4xx` continua `provider-refused`: a
 * credencial existe, foi enviada, e foi recusada — há o que arrumar. O caso
 * genuinamente indecidível (serviço fora do ar respondendo `403` a um provedor
 * que tem chave) fica onde estava, porque ali a resposta antiga acerta com mais
 * frequência do que erra, e **oferecer a saída errada custa mais que não
 * oferecer nenhuma** só vale quando se sabe que ela é errada.
 *
 * A troca de token que falha também segue `provider-refused`, e por coerência:
 * se houve troca de token, há credencial preenchida.
 */
/**
 * O corpo da recusa, sem deixar a leitura dele derrubar a recusa.
 *
 * Provedor que recusa não promete JSON válido — e um `json()` que lança aqui
 * transformaria "o provedor recusou" em "erro nosso", que é a má atribuição que
 * o `catch` largo de 02/09 já custou uma vez.
 */
async function readBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text()
    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  } catch {
    return null
  }
}

function refusalOf(
  provider: ProviderRow,
  status: number,
): 'provider-down' | 'provider-refused' {
  if (status >= 500) {
    return 'provider-down'
  }
  return provider.credentials.length === 0
    ? 'provider-down'
    : 'provider-refused'
}

export async function searchProvider({
  provider,
  binding,
  term,
  fetchImpl = fetch,
}: {
  provider: ProviderRow
  binding: TypeBinding
  term: string
  /** Injetável só para teste; produção usa o `fetch` global do Node. */
  fetchImpl?: typeof fetch
}): Promise<SearchOutcome> {
  const fieldMap = binding.fieldMap ?? provider.fieldMap
  const endpoint = {
    ...provider.endpoints.search,
    path: binding.searchPath ?? provider.endpoints.search.path,
    // O corpo do PAR vence o do provedor, como o caminho: no AniList o
    // endereço é `/` pra tudo e quem separa anime de mangá é a variável `type`
    // dentro do corpo.
    body: binding.searchBody ?? provider.endpoints.search.body,
  }

  const optionValues = Object.fromEntries(
    provider.options.map((opção) => [
      opção.key,
      provider.optionValues[opção.key] ?? opção.default,
    ]),
  )

  /**
   * O termo vai na query **ou** no corpo, nunca nos dois: um provedor que fala
   * por `POST` não tem `queryParam` que signifique alguma coisa, e mandá-lo
   * assim mesmo acrescentaria um parâmetro que o AniList ignora e que o IGDB
   * pode recusar. A query fixa do endpoint continua valendo nos dois casos.
   */
  const query: Record<string, string> = endpoint.body
    ? {}
    : { [endpoint.queryParam]: term }
  for (const [key, value] of Object.entries(endpoint.query ?? {})) {
    query[key] = resolveTemplate(value, optionValues)
  }

  const prepared = await prepareRequest({
    providerSlug: provider.slug,
    baseUrl: provider.baseUrl,
    auth: provider.auth,
    // A query fixa do endpoint já foi resolvida em `query` acima; o que falta
    // passar adiante é o CORPO, e ele é o do par quando o par declara um.
    endpoint: { path: endpoint.path, body: endpoint.body },
    accept: provider.endpoints.accept,
    storedCredentials: provider.credentialValues,
    // O prazo e o `fetch` seguem para a TROCA DE TOKEN, que é uma ida à rede
    // antes da requisição. Sem repassá-los, o estilo `oauth-client-credentials`
    // usaria o `fetch` global — e foi assim que o teste dele bateu no provedor
    // de verdade em vez de no dublê.
    timeoutMs: provider.timeoutMs,
    fetchImpl,
    extraQuery: query,
    bodyVars: { term, ...optionVars(optionValues) },
  })

  if (!prepared.ok) {
    /**
     * **A troca de token falhar NÃO é "falta configurar"** — 02/09/2026. As
     * duas credenciais estão preenchidas, e quem recusou foi o provedor: mandar
     * `not-configured` levaria o admin a um formulário cheio, sem dizer o que
     * está errado nele. Um `4xx` na troca é o mesmo fato que um `4xx` na busca,
     * então usa o mesmo motivo — há o que arrumar, e quem arruma é o admin.
     */
    if (prepared.reason === 'token-refused') {
      return {
        ok: false,
        reason: 'provider-refused',
        provider: provider.slug,
        status: prepared.status,
        /**
         * A troca de token não devolve corpo por aqui — `prepareRequest` já o
         * consumiu decidindo. **Nulo é a resposta honesta**, e ela cai na tela
         * de ontem: copy nossa e o status ao lado.
         */
        detail: null,
      }
    }
    // A rede caiu antes do token, e não depois. Para quem lê é a mesma coisa.
    if (prepared.reason === 'token-unreachable') {
      return { ok: false, reason: 'unreachable', provider: provider.slug }
    }

    return {
      ok: false,
      reason: 'not-configured',
      provider: provider.slug,
      credential:
        prepared.reason === 'missing-credential'
          ? prepared.credential
          : prepared.style,
    }
  }

  // O parâmetro da credencial sai da chave do cache. Ver `providers.cache.ts`.
  const keyParam =
    provider.auth.style === 'query-key' ? provider.auth.param : null
  const key = cacheKeyFor(prepared.request.url, keyParam, prepared.request.body)

  const cached = readCache(provider.slug, key)
  if (cached !== null) {
    return {
      ok: true,
      results: parseResults(
        cached,
        fieldMap,
        provider.slug,
        provider.artTemplate,
        provider.endpoints,
      ),
      cached: true,
    }
  }

  if (!takeToken(provider.slug, undefined, provider.rateLimit)) {
    return { ok: false, reason: 'rate-limited', provider: provider.slug }
  }

  /**
   * **O `try` embrulha a REDE, e só ela** — corrigido em 02/09/2026.
   *
   * Ele embrulhava o `writeCache` junto, então uma falha NOSSA de banco saía
   * daqui como `unreachable`: o provedor tinha respondido, e a tela dizia que
   * ele não podia ser alcançado. Foi o que custou tempo no ciclo do Kitsu, com
   * a FK de `provider_cache` — o sintoma apontava pra rede, e o defeito estava
   * a duas tabelas de distância.
   *
   * Fora do `try`, a falha de banco sobe e vira 500 com stack no log: **falha
   * nossa se reporta como nossa.** O custo assumido é que um lock transiente do
   * SQLite derruba uma busca que funcionou.
   */
  let body: string
  try {
    const response = await fetchImpl(prepared.request.url, {
      method: prepared.request.method,
      body: prepared.request.body,
      headers: prepared.request.headers,
      // O prazo é do PROVEDOR, não nosso. Ver `providers.timeoutMs`: é a
      // busca do Kitsu, de 6 a 12s, que descobriu que 10s fixos transformavam
      // provedor lento em provedor inalcançável.
      signal: AbortSignal.timeout(provider.timeoutMs),
    })

    /**
     * **`401` joga fora o token guardado** — 02/09/2026.
     *
     * O token da Twitch vale ~60 dias, então um que seja revogado do lado
     * deles ficaria válido aqui por dois meses: toda busca voltaria `401` e o
     * "testar conexão" diria que está tudo bem, porque a credencial de fato
     * está certa. Esquecer aqui faz a requisição SEGUINTE trocar por um novo.
     *
     * Não há repetição automática, e é escolha: repetir esconderia do log que
     * a primeira falhou, e quem está do outro lado é uma caixa de busca que
     * já vai disparar de novo na próxima tecla.
     */
    if (response.status === 401) {
      forgetToken(provider.slug)
    }

    if (!response.ok) {
      const reason = refusalOf(provider, response.status)
      /**
       * O corpo só é lido quando ele vai a algum lugar. Ler e jogar fora seria
       * gastar a resposta de um provedor que acabou de recusar — e no `down` a
       * frase não vai pra tela.
       */
      const detail =
        reason === 'provider-refused'
          ? providerMessage(await readBody(response))
          : null

      return reason === 'provider-refused'
        ? {
            ok: false,
            reason,
            provider: provider.slug,
            status: response.status,
            detail,
          }
        : {
            ok: false,
            reason,
            provider: provider.slug,
            status: response.status,
          }
    }

    // Continua aqui dentro: o corpo chega pela rede, e ela pode cair no meio
    // da leitura — que é `unreachable` com toda razão.
    body = await response.text()
  } catch {
    /**
     * A mensagem do erro **não sobe**, pelo mesmo motivo do "testar conexão": a
     * URL montada carrega a chave na query quando o estilo é `query-key`, e
     * repetir o texto do erro seria o segredo vazando por um caminho que
     * ninguém audita.
     */
    return { ok: false, reason: 'unreachable', provider: provider.slug }
  }

  writeCache(provider.slug, key, body)
  // Oportunista, na escrita — não por timer. Ver `providers.cache.ts`.
  pruneExpired()

  return {
    ok: true,
    results: parseResults(
      body,
      fieldMap,
      provider.slug,
      provider.artTemplate,
      provider.endpoints,
    ),
    cached: false,
  }
}

/**
 * Onde a lista de resultados mora dentro do corpo.
 *
 * O TMDB põe em `results`; outro provedor põe em `data.items` ou devolve o
 * array na raiz. A definição podia declarar isso, e um dia vai — hoje o
 * fallback cobre os três formatos sem inventar campo que nenhum provedor
 * embutido usa.
 */
/**
 * `{id}` no caminho de um endpoint, **segmento a segmento**.
 *
 * `encodeURIComponent` inteiro não serve: o id do Open Library JÁ É um caminho
 * (`/works/OL45804W`), e escapar a barra o transformaria num segmento só. Mas
 * substituir cru abriria travessia, porque o id vem de terceiro.
 *
 * Então: parte nas barras, **recusa `.` e `..`** (que nenhum encode neutraliza,
 * porque não têm caractere pra escapar), e escapa cada segmento. A barra
 * sobrevive como separador e a saída do caminho vira impossível por construção
 * — a mesma régua do nome de arquivo do cache de arte, que é hash pelo mesmo
 * motivo.
 */
export function pathWithId(
  template: string,
  externalId: string,
): string | null {
  const segments = externalId.split('/')
  if (segments.some((s) => s === '.' || s === '..')) {
    return null
  }
  return template.replace('{id}', segments.map(encodeURIComponent).join('/'))
}

function itemsOf(body: unknown, resultsPath?: string): unknown[] {
  if (Array.isArray(body)) {
    return body
  }
  if (resultsPath) {
    const declared = readPath(body, resultsPath)
    return Array.isArray(declared) ? declared : []
  }
  if (body && typeof body === 'object') {
    const results = (body as Record<string, unknown>).results
    if (Array.isArray(results)) {
      return results
    }
  }
  return []
}

function parseResults(
  raw: string,
  fieldMap: FieldMap,
  providerSlug: string,
  artTemplate: string | null,
  /**
   * Os endpoints inteiros, e não só o `resultsPath`: o dialeto do provedor
   * decide DUAS coisas na leitura — onde a lista mora e em que formato a prosa
   * dele vem —, e passar as duas soltas era o quinto e o sexto parâmetro
   * posicional de uma função que já tinha quatro.
   */
  endpoints: ProviderEndpoints,
): ProviderResult[] {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    // Corpo que não é JSON: o provedor respondeu 200 com uma página de erro, o
    // que acontece com proxy no meio. Lista vazia é o menos errado — quem
    // chamou trata o vazio, e derrubar a busca com 500 diria que o defeito é
    // nosso.
    return []
  }

  return itemsOf(body, endpoints.search.resultsPath)
    .map((item) =>
      mapResult(item, fieldMap, providerSlug, artTemplate, endpoints),
    )
    .filter((r): r is ProviderResult => r !== null)
}
