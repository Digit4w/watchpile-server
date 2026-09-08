import { eq, inArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { mediaTypeProviders } from '../../db/schema/media-type-providers.js'
import { type OptionSpec, providers } from '../../db/schema/providers.js'
import type { AppRouteHandler } from '../../lib/types.js'
import { prepareRequest } from './providers.auth.js'
import { forgetProvider } from './providers.cache.js'
import { isOverridden, resolveCredential } from './providers.credentials.js'
import { providerDetail } from './providers.detail-text.js'
import type { ProviderPublic } from './providers.public.js'
import type { ListRoute, TestRoute, UpdateRoute } from './providers.routes.js'

/** Os últimos quatro caracteres — o bastante pra reconhecer, longe de vazar. */
function hintOf(value: string): string | null {
  return value.length > 4 ? `…${value.slice(-4)}` : null
}

/**
 * Monta a forma pública de um ou mais provedores.
 *
 * Uma consulta pra junção, não uma por provedor: são poucos hoje, mas provedor
 * definido pelo usuário abre o número, e um `N+1` aqui cresceria junto.
 */
function toPublic(slugs?: string[]): ProviderPublic[] {
  const rows = slugs
    ? db.select().from(providers).where(inArray(providers.slug, slugs)).all()
    : db.select().from(providers).all()

  if (rows.length === 0) {
    return []
  }

  const joins = db
    .select()
    .from(mediaTypeProviders)
    .where(
      inArray(
        mediaTypeProviders.providerSlug,
        rows.map((p) => p.slug),
      ),
    )
    .all()

  return rows.map((provider) => {
    const credentials = provider.credentials.map((spec) => {
      const { value, source } = resolveCredential(
        provider.slug,
        spec.key,
        provider.credentialValues,
      )
      return {
        key: spec.key,
        label: spec.label,
        help: spec.help,
        configured: value !== '',
        hint: value ? hintOf(value) : null,
        source,
        overridden: isOverridden(source),
      }
    })

    return {
      slug: provider.slug,
      name: provider.name,
      baseUrl: provider.baseUrl,
      attribution: provider.attribution,
      authStyle: provider.auth.style,
      credentials: credentials,
      options: provider.options,
      // O valor efetivo: o que o admin salvou, ou o default da declaração. A
      // tela nunca precisa saber qual dos dois é — ela mostra o que vale.
      optionValues: Object.fromEntries(
        provider.options.map((opção) => [
          opção.key,
          provider.optionValues[opção.key] ?? opção.default,
        ]),
      ),
      mediaTypes: joins
        .filter((j) => j.providerSlug === provider.slug)
        .map((j) => j.mediaTypeSlug),
      // Provedor sem credencial declarada nasce pronto — é o caso do AniList e
      // do Open Library, que não pedem nada pra leitura pública.
      ready: credentials.every((c) => c.configured),
    }
  })
}

/**
 * A LISTA é de todo mundo, não só do admin.
 *
 * Duas coisas dependem disso e nenhuma é de administração: a **atribuição** é
 * condição de uso e precisa renderizar pra quem olha a tela (brief, 3.10), e
 * saber que um tipo **não tem provedor** é o que permite a busca dizer isso em
 * voz alta em vez de devolver lista vazia. O segredo não viaja aqui de jeito
 * nenhum — `configured` e os últimos quatro caracteres é tudo que sai.
 */
export const list: AppRouteHandler<ListRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  return c.json(toPublic(), 200)
}

function optionByKey(specs: OptionSpec[], key: string): OptionSpec | undefined {
  return specs.find((spec) => spec.key === key)
}

export const update: AppRouteHandler<UpdateRoute> = (c) => {
  const { slug } = c.req.valid('param')
  const body = c.req.valid('json')

  const provider = db
    .select()
    .from(providers)
    .where(eq(providers.slug, slug))
    .get()

  if (!provider) {
    return c.json({ message: 'Provider not found' }, 404)
  }

  /**
   * Recusa chave que a definição não declara.
   *
   * Sem isto, um erro de digitação vira campo gravado que ninguém lê, e o admin
   * fica achando que configurou. É a mesma família da recusa que se anuncia:
   * melhor negar com nome do que aceitar e ignorar.
   */
  for (const key of Object.keys(body.credentials ?? {})) {
    if (!provider.credentials.some((spec) => spec.key === key)) {
      return c.json(
        { message: `This provider does not use a credential named "${key}"` },
        400,
      )
    }
  }

  for (const [key, value] of Object.entries(body.options ?? {})) {
    const spec = optionByKey(provider.options, key)
    if (!spec) {
      return c.json(
        { message: `This provider does not have an option named "${key}"` },
        400,
      )
    }
    if (typeof value !== spec.type) {
      return c.json({ message: `Option "${key}" must be a ${spec.type}` }, 400)
    }
  }

  /**
   * **Mescla, não substitui** — e a string vazia é o que APAGA uma credencial.
   *
   * O motivo está em `providers.public.ts`: substituir obrigaria a tela a
   * mandar todos os segredos a cada salvamento, e ela não os tem, porque o
   * `GET` nunca os devolveu.
   */
  const credentials = { ...provider.credentialValues }
  for (const [key, value] of Object.entries(body.credentials ?? {})) {
    const trimmed = value.trim()
    if (trimmed === '') {
      delete credentials[key]
    } else {
      credentials[key] = trimmed
    }
  }

  const options = { ...provider.optionValues, ...body.options }

  db.update(providers)
    .set({
      credentialValues: credentials,
      optionValues: options,
      updatedAt: new Date(),
    })
    .where(eq(providers.id, provider.id))
    .run()

  /**
   * Esquecer o cache é parte do salvamento, não faxina.
   *
   * Trocar a credencial ou uma opção muda o que o provedor responde — `language`
   * literalmente muda o idioma dos metadados. Servir a resposta antiga faria o
   * admin achar que salvar não teve efeito, que é a mesma família de erro que o
   * campo travado por env evita do outro lado.
   */
  forgetProvider(slug)

  return c.json(toPublic([slug])[0], 200)
}

/**
 * Bate no endpoint mais barato do provedor com a credencial que está valendo.
 *
 * **Sempre 200 quando a tentativa aconteceu**, com `ok` dizendo se deu certo. A
 * recusa do terceiro não é falha nossa, e devolver 4xx faria o cliente mostrar
 * "não foi possível alcançar o servidor" — a frase errada pra uma chave errada.
 */
export const test: AppRouteHandler<TestRoute> = async (c) => {
  const { slug } = c.req.valid('param')

  const provider = db
    .select()
    .from(providers)
    .where(eq(providers.slug, slug))
    .get()

  if (!provider) {
    return c.json({ message: 'Provider not found' }, 404)
  }

  /**
   * A credencial digitada vence a guardada, **só pela duração da tentativa**.
   *
   * Sem isto, provar uma chave exigia salvá-la antes — e uma chave errada
   * ficava valendo até alguém voltar pra consertar. A mescla é a mesma do
   * `PATCH`, inclusive no vazio: `resolveCredential` conta string vazia como
   * ausente, então testar uma credencial marcada pra apagar cai no degrau
   * seguinte da cadeia, que é o que vai valer depois de salvar.
   */
  const submitted = c.req.valid('json')?.credentials ?? {}

  const prepared = await prepareRequest({
    providerSlug: provider.slug,
    baseUrl: provider.baseUrl,
    auth: provider.auth,
    endpoint: provider.endpoints.test,
    storedCredentials: { ...provider.credentialValues, ...submitted },
    // A troca de token acontece aqui dentro, e é ela que faz "testar conexão"
    // validar a credencial de verdade num provedor de OAuth.
    timeoutMs: provider.timeoutMs,
    accept: provider.endpoints.accept,
  })

  if (!prepared.ok) {
    if (prepared.reason === 'unsupported-auth-style') {
      return c.json(
        {
          ok: false,
          status: null,
          message: `This build cannot authenticate with "${prepared.style}" yet.`,
          // Não houve pedido ao provedor: não há corpo dele pra mostrar.
          detail: null,
        },
        200,
      )
    }

    /**
     * **Aqui a distinção rende a frase mais útil da tela inteira**: "testar
     * conexão" existe pra dizer se a credencial vale, e a recusa na troca de
     * token é literalmente essa resposta. Dizer "precisa da Client ID" a um
     * formulário preenchido mandaria o admin conferir o que ele acabou de
     * digitar, em vez de trocar o que está errado.
     */
    if (prepared.reason === 'token-refused') {
      return c.json(
        {
          ok: false,
          status: prepared.status,
          message: `${provider.name} rejected these credentials (${prepared.status}).`,
          /**
           * Nulo, e é ausência declarada: quem recusou foi o servidor de TOKEN,
           * e `prepareRequest` não devolve o corpo dele. Trazê-lo pediria mudar
           * a forma daquele resultado por um caminho que a tela já explica bem
           * — validar credencial é literalmente o que este botão faz.
           */
          detail: null,
        },
        200,
      )
    }

    if (prepared.reason === 'token-unreachable') {
      return c.json(
        {
          ok: false,
          status: null,
          message: `${provider.name} could not be reached to sign in.`,
          detail: null,
        },
        200,
      )
    }

    // O RÓTULO da declaração, não a chave: `api_key` é nome de máquina, e a
    // frase vai pra tela. A declaração já carrega o rótulo humano justamente
    // porque é dela que o formulário é gerado.
    const label =
      provider.credentials.find((spec) => spec.key === prepared.credential)
        ?.label ?? prepared.credential
    return c.json(
      {
        ok: false,
        status: null,
        message: `${provider.name} needs its ${label} before it can be reached.`,
        detail: null,
      },
      200,
    )
  }

  try {
    const response = await fetch(prepared.request.url, {
      // O endpoint de teste segue o dialeto do provedor como qualquer outro: o
      // do AniList é `POST` com uma consulta GraphQL mínima, porque **um
      // pedido que o provedor ACEITA** é o que a lição do Open Library cobra.
      method: prepared.request.method,
      body: prepared.request.body,
      headers: prepared.request.headers,
      // Sem timeout o "testar conexão" pendura o request até o default do
      // Node, e quem clicou fica olhando um botão girando por um minuto. O
      // prazo é o da DEFINIÇÃO, e aqui isso é mais que coerência: testar com
      // um prazo menor que o da busca diria "demorou demais" a um provedor que
      // busca bem — o diagnóstico mentiria sobre o que ele faz na prática.
      signal: AbortSignal.timeout(provider.timeoutMs),
    })

    /**
     * **`4xx` e `5xx` são fatos diferentes, e a frase tem que dizer qual.**
     *
     * `4xx` é o provedor recusando o NOSSO pedido — chave errada, parâmetro
     * inválido, caminho que não existe. Há o que arrumar, e quem arruma é o
     * admin. `5xx` é o provedor falhando do lado dele: o Jikan devolve **504**
     * com "failed to connect to MyAnimeList" quando o MAL recusa o scraper
     * dele. Não há nada a configurar; há o que esperar.
     *
     * Dizer "refused the request" nos dois manda o admin procurar defeito na
     * configuração que está certa — é a mesma classe do `q=a` que dava 422 no
     * Open Library e se lia como "o provedor está fora do ar" (design system,
     * seção 8: a recusa tem a gravidade do fato).
     */
    const onProviderSide = response.status >= 500

    /**
     * **O que o provedor ESCREVEU, quando ele recusou** (08/09/2026, decisão do
     * dono). A categoria acima está certa e é traduzível; a frase dele é a que
     * a categoria não alcança — o 403 do AniList vinha com *"The AniList API
     * has been temporarily disabled"*, que explica o número.
     *
     * **Só na recusa.** Num `ok` não há o que explicar, e ler o corpo de uma
     * resposta boa seria gastar memória por nada.
     *
     * `providerDetail` raspa as credenciais e recusa HTML — ver lá o porquê. As
     * credenciais vão RESOLVIDAS (as digitadas por cima das guardadas), que é a
     * mesma mescla que montou o pedido: raspar as guardadas não bastaria, porque
     * quem está testando uma chave nova é ela que viaja.
     */
    const detail = response.ok
      ? null
      : providerDetail(
          await response.text().catch(() => null),
          Object.values({ ...provider.credentialValues, ...submitted }),
        )

    return c.json(
      {
        ok: response.ok,
        status: response.status,
        message: response.ok
          ? `${provider.name} answered.`
          : onProviderSide
            ? `${provider.name} is failing on its own side (${response.status}).`
            : `${provider.name} refused the request (${response.status}).`,
        detail,
      },
      200,
    )
  } catch (error) {
    /**
     * Rede fora, DNS, timeout. **A mensagem do erro não vai pro cliente**: ela
     * carrega a URL montada, e a URL montada carrega a chave na query quando o
     * estilo é `query-key` — que é justamente o do TMDB. Seria o segredo
     * vazando pela porta dos fundos, num endpoint de diagnóstico.
     */
    const timeout = error instanceof Error && error.name === 'TimeoutError'
    return c.json(
      {
        ok: false,
        status: null,
        message: timeout
          ? `${provider.name} took too long to answer.`
          : `${provider.name} could not be reached.`,
        // O `Error` não vira texto de tela, e é a mesma razão de sempre — ver o
        // bloco acima.
        detail: null,
      },
      200,
    )
  }
}
