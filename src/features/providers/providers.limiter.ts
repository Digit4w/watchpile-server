/**
 * O limitador por provedor — **requisito, não otimização** (brief, 3.10).
 *
 * A chave é da INSTÂNCIA, então o orçamento é compartilhado por todo mundo que
 * usa aquele servidor: um usuário importando uma coleção grande gasta a cota de
 * todos. Importar sem isso é a forma mais rápida de tomar bloqueio.
 *
 * ── Balde de fichas, e por que em MEMÓRIA ───────────────────────────────────
 * O Watchpile é um processo só servindo um arquivo SQLite (brief, 3.1) — não há
 * segunda instância com quem coordenar, então guardar o estado do balde numa
 * tabela custaria escrita a cada requisição pra resolver um problema que não
 * existe. Reiniciar o servidor zera o balde, e isso é aceitável: reinício não é
 * o caminho de quem está importando.
 *
 * O que **não** é aceitável e por isso está aqui: perder a conta entre duas
 * buscas seguidas na mesma sessão.
 */

type Bucket = {
  /** Fichas disponíveis agora, em ponto flutuante — elas reenchem contínuo. */
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()

/**
 * O TMDB documenta ~50 requisições por segundo e não publica cota diária desde
 * 2019. 20/s é conservador de propósito: o teto do provedor é o que ele tolera,
 * não o que se deve mirar, e a diferença entre 20 e 50 não se sente numa busca
 * — se sente num import, que é justamente onde ir ao teto derruba a chave de
 * todo mundo no servidor.
 */
const DEFAULT_PER_SECOND = 20
/** Uma rajada curta é normal: a tela dispara busca a cada tecla, com debounce. */
const DEFAULT_BURST = 10

export type LimiterConfig = { perSecond: number; burst: number }

const config: Record<string, LimiterConfig | undefined> = {}

export function configureLimiter(slug: string, cfg: LimiterConfig): void {
  config[slug] = cfg
}

function configFor(slug: string): LimiterConfig {
  return config[slug] ?? { perSecond: DEFAULT_PER_SECOND, burst: DEFAULT_BURST }
}

/**
 * Reserva uma ficha e diz **quanto esperar** por ela — `null` quando a espera
 * passaria do orçamento de quem pediu.
 *
 * ── Por que RESERVAR, e não dormir e tentar de novo ─────────────────────────
 * Vinte pedidos que dormem o mesmo tanto acordam juntos e brigam pela mesma
 * ficha: sai um servido e dezenove recusados, de novo. Reservar debita **na
 * hora** — as fichas vão a negativo, porque são fichas do FUTURO — e cada um
 * sai com um instante próprio. É isso que transforma uma multidão numa fila, e
 * a ordem dela é a de chegada.
 */
/**
 * Quanto do balde o trabalho de FUNDO nunca encosta — 13/09/2026.
 *
 * ── O que foi medido, e o que ele conserta ──────────────────────────────────
 * O aquecimento e a tela disputavam o mesmo balde **sem precedência nenhuma**,
 * e quem chegou primeiro levava. Medido em 13/09/2026 com uma grade fria de 20
 * cartas e `maxWait` de 5s: no AniList (0,5/s) o aquecimento derrubava as
 * servidas de **7 para 2**; no MyAnimeList e no Kitsu (3/s) ele não atrapalhava,
 * porque a latência real da rede já o segura em 1,07/s de um orçamento de 3.
 *
 * ── Por que uma FRAÇÃO do burst, e não uma taxa ─────────────────────────────
 * O que a tela precisa não é de vazão — é de **fichas prontas no instante em
 * que alguém abre a grade**. Uma cota por segundo não guarda nada para esse
 * instante; um piso no balde guarda. Metade do burst é o que sobra sempre, e
 * como o burst já é declarado por provedor, a reserva acompanha quem ele é sem
 * um segundo número para calibrar.
 */
const BACKGROUND_RESERVE = 0.5

export function reserveToken(
  slug: string,
  now = Date.now(),
  /**
   * O teto declarado pelo PROVEDOR, quando ele declara um.
   *
   * Vence o registro em memória e o padrão, porque é o único dos três que sabe
   * do que está falando: `configureLimiter` existe pra teste e pra override
   * futuro, e o padrão é um chute conservador pra quem não declarou nada.
   */
  declared?: LimiterConfig | null,
  /** Quanto quem pede aguenta esperar. Zero é o comportamento de sempre. */
  maxWaitMs = 0,
  /**
   * Este pedido é de trabalho de FUNDO — ninguém está esperando por ele.
   *
   * Duas consequências, e as duas existem para que a tela nunca espere por
   * causa do aquecimento: ele deixa um colchão de fichas intocado, e **nunca
   * gasta ficha do futuro**. Reservar futuro é o que transforma uma multidão
   * numa fila, e uma fila de mil obras na frente de quem abriu a grade é
   * exatamente o que não pode acontecer.
   */
  background = false,
): number | null {
  const { perSecond, burst } = declared ?? configFor(slug)
  const bucket = buckets.get(slug) ?? { tokens: burst, lastRefill: now }

  // Reenchimento contínuo, não por janela: janela fixa deixa passar o dobro na
  // virada — as últimas N de uma janela e as primeiras N da seguinte, coladas.
  const elapsed = Math.max(0, now - bucket.lastRefill) / 1000
  bucket.tokens = Math.min(burst, bucket.tokens + elapsed * perSecond)
  bucket.lastRefill = now

  /** O piso que este pedido respeita: zero para quem tem alguém esperando. */
  const floor = background ? burst * BACKGROUND_RESERVE : 0

  if (bucket.tokens >= 1 + floor) {
    bucket.tokens -= 1
    buckets.set(slug, bucket)
    return 0
  }

  // Provedor sem vazão declarada não tem espera que resolva.
  if (perSecond <= 0) {
    buckets.set(slug, bucket)
    return null
  }

  const waitMs = ((1 + floor - bucket.tokens) / perSecond) * 1000
  if (waitMs > maxWaitMs) {
    // Guarda o reenchimento e **não debita**: quem desistiu não gastou nada.
    buckets.set(slug, bucket)
    return null
  }

  /**
   * **O trabalho de fundo não debita adiantado.** Quem tem alguém esperando sai
   * com a ficha reservada e um instante próprio — é o que ordena a fila pela
   * chegada. O de fundo apenas DORME até a ficha existir de verdade e tenta de
   * novo; se nesse meio-tempo a tela pedir, ela leva, que é o ponto.
   */
  if (background) {
    buckets.set(slug, bucket)
    return waitMs
  }

  bucket.tokens -= 1
  buckets.set(slug, bucket)
  return waitMs
}

/**
 * Tenta gastar uma ficha, sem esperar. Devolve `false` quando não há — e quem
 * chama por aqui **não espera**: devolver "tente de novo" na hora é melhor que
 * segurar uma conexão HTTP aberta enquanto o balde reenche, porque quem está do
 * outro lado é uma caixa de busca que já vai disparar de novo na próxima tecla.
 *
 * **Esse argumento é da BUSCA, e não vale para todo mundo** — ver `awaitToken`.
 */
export function takeToken(
  slug: string,
  now = Date.now(),
  declared?: LimiterConfig | null,
): boolean {
  return reserveToken(slug, now, declared) !== null
}

/**
 * A ficha, esperando por ela até `maxWaitMs`. `false` quando nem esperando dá.
 *
 * ── Quem espera e quem não espera ───────────────────────────────────────────
 * A busca **não** espera: do outro lado há uma pessoa digitando, e a tecla
 * seguinte já dispara outra consulta. A ARTE espera, e a diferença é que do
 * outro lado dela há um `<img>` — ele não tenta de novo, não lê corpo de erro e
 * não sabe que foi recusado por cota. Recusar ali não é "tente de novo": é
 * ladrilho em branco até alguém recarregar a página.
 *
 * Medido em 07/09/2026, e foi o que trouxe esta função ao mundo: numa grade
 * fria de 20 cartas de um provedor a 3/s, **8 voltavam vazias** — e ficavam,
 * porque a tela guarda qual `src` falhou.
 */
export async function awaitToken(
  slug: string,
  declared: LimiterConfig | null | undefined,
  maxWaitMs: number,
  /** Ver `reserveToken`: deixa o colchão de pé e não gasta ficha do futuro. */
  background = false,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs

  /**
   * **O de fundo tenta de novo; o de primeiro plano não precisa.**
   *
   * Quem tem alguém esperando sai daqui com a ficha já debitada, então uma volta
   * basta. O de fundo apenas dorme até a ficha existir — e ao acordar ela pode
   * ter sido levada por quem chegou com pressa, que é o comportamento desejado.
   * O laço é limitado pelo mesmo prazo, então ele termina de um jeito ou de
   * outro em vez de girar enquanto alguém navega.
   */
  for (;;) {
    const remaining = background ? deadline - Date.now() : maxWaitMs
    if (remaining < 0) {
      return false
    }

    const waitMs = reserveToken(
      slug,
      Date.now(),
      declared,
      remaining,
      background,
    )
    if (waitMs === null) {
      return false
    }
    if (waitMs > 0) {
      await sleep(waitMs)
    }
    if (!background) {
      return true
    }

    /** Agora a ficha existe. Tenta debitá-la de fato, sem esperar de novo. */
    if (reserveToken(slug, Date.now(), declared, 0, background) === 0) {
      return true
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Só para teste: o balde é global e sobrevive entre casos. */
export function resetLimiter(): void {
  buckets.clear()
  for (const key of Object.keys(config)) {
    delete config[key]
  }
}
