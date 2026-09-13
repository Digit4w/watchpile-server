import { setImmediate as yieldToLoop } from 'node:timers/promises'
import { env } from '../../env.js'
import {
  bindingFor,
  type ProviderRow,
  providerBySlug,
  type TypeBinding,
} from '../providers/providers.query.js'
import { captureSnapshot, hasSnapshot } from '../titles/titles.snapshot.js'
import { fetchArt } from './art.fetch.js'
import { hasArt, writeArt } from './art.store.js'

/**
 * Encher o que a obra precisa para abrir sem o provedor, sem ninguém estar
 * olhando (brief, 3.10).
 *
 * **Duas coisas, desde 07/09/2026:** a arte em disco e o snapshot da obra. O
 * nome do módulo ficou o da primeira porque foi ela que o abriu, e as duas
 * saem da MESMA resposta de detalhe — separá-las em dois laços dobraria as
 * idas à rede para não mudar nada.
 *
 * ── O que ele conserta, e o que ele NÃO desfaz ──────────────────────────────
 * "A arte enche na primeira vez que é PEDIDA" continua de pé: adicionar uma obra
 * não pode esperar a rede, e nada aqui é `await`ado por um handler. O que essa
 * decisão não previu é o intervalo entre **ter** a obra e **olhar** para ela —
 * nele, a arte não existe em disco, e quem abrir o app sem internet vê ladrilho
 * de uma obra que salvou faz semanas.
 *
 * Nasceu no import, que é o caso extremo: cento e vinte obras de uma vez, a
 * grade abrindo fria, todas pedindo juntas. Medido em 07/09/2026, antes de
 * existir: numa grade de 20 cartas de um provedor a 3/s, **oito voltavam
 * vazias** — e ficavam, porque a tela guarda qual `src` falhou.
 *
 * ── Por que ele vale para QUALQUER obra que ganha vínculo ───────────────────
 * O argumento que segurava isso no brief era não haver fila. Passou a haver —
 * este laço —, e ele é o mesmo trabalho nos três chamadores: o import, a obra
 * criada a partir da busca, e a obra existente que ganha um vínculo. Com os
 * três, a promessa deixa de ser *"a arte que você já viu abre offline"* e passa
 * a ser *"a arte da sua biblioteca abre offline"*, que é o que a exigência de
 * offline queria dizer desde o começo (brief, 3.10: a exigência segue o OBJETO).
 *
 * Fica de fora quem não tem de onde tirar: obra sem vínculo com provedor nenhum
 * — a digitada à mão — segue no ladrilho, com ou sem rede, até ser vinculada.
 *
 * ── Não é a fila que o brief recusa ─────────────────────────────────────────
 * A 3.1 recusa infraestrutura de fila. Isto é um laço sobre uma lista que já
 * está na memória, que termina sozinho e não guarda estado em lugar nenhum.
 * Morrer no meio custa o que custava antes: o que faltar volta a encher sob
 * demanda, que continua sendo o caminho principal.
 */

/** A identidade INTEIRA de uma arte — o tipo entra porque o id é único dentro dele. */
export type ArtTarget = {
  provider: string
  externalId: string
  mediaType: string
}

/**
 * Quanto o aquecimento aceita esperar por uma ficha do limitador.
 *
 * Muito acima dos 5s de quem serve uma carta, e pelo motivo oposto: ali há
 * alguém olhando, aqui não há ninguém. Esperar um minuto por uma ficha é
 * exatamente o comportamento certo de um trabalho que ninguém está cronometrando.
 */
const TOKEN_WAIT_MS = 60_000

/**
 * A pausa entre obras, e ela não é educação com o provedor — é com o USUÁRIO.
 *
 * Quem está com o app aberto disputa as mesmas fichas; sem a pausa, um
 * aquecimento de quatrocentas obras mantém o balde no chão e cada carta que a
 * pessoa abre espera os 5s inteiros. Custa alguns minutos a mais numa coisa que
 * ninguém está esperando terminar.
 *
 * ── O que MEDIR corrigiu, em 13/09/2026 ────────────────────────────────────
 * A suposição registrada era que esta pausa *"não alivia nada num provedor a
 * 3/s"*, e ela está **invertida**. Medido com uma grade fria de 20 cartas
 * disputando o balde com este laço:
 *
 * | provedor | volta de 100ms | volta de 600ms (rede real) |
 * | --- | --- | --- |
 * | mal, kitsu (3/s) | 15 de 20 servidas | **20 de 20** |
 * | anilist (0,5/s) | 2 de 20 | 2 de 20 |
 *
 * Ou seja: a 3/s é exatamente a pausa — somada à latência real da rede — que
 * segura este laço em 1,07 req/s de um orçamento de 3, e é por isso que ele não
 * atrapalha ninguém ali. E a 0,5/s ela é **irrelevante**, porque mesmo a 0,38
 * req/s o laço já come 76% do orçamento sozinho.
 *
 * **A causa nunca foi a pausa: era não haver precedência.** Quem chegava
 * primeiro levava, e este laço chega sempre, porque está rodando há minutos. O
 * conserto é `background: true` nas duas chamadas abaixo — ver `reserveToken`.
 */
const PAUSE_MS = 100

/**
 * Como este trabalho conta a si mesmo para quem está de fora — 13/09/2026.
 *
 * Ele existe porque o aquecimento era **invisível do começo ao fim**: medido
 * contra 1.200 obras, ele leva 18,7 min no MyAnimeList e 52 min no AniList, e
 * nesse intervalo a pessoa já leu "importação terminada" e fechou a tela.
 *
 * **É opcional de propósito.** Dos três chamadores, dois aquecem UMA obra —
 * criar da busca e vincular —, e abrir uma linha de job para uma obra seria
 * contabilidade mais cara que o trabalho. Quem tem muito o que fazer passa o
 * relator; quem não tem, não passa. Uma função só, não duas.
 */
export type WarmProgress = {
  /**
   * Quantos alvos ÚNICOS o trabalho tem — dito uma vez, antes da primeira
   * volta, porque o total só se conhece depois do `dedupe`.
   */
  begin: (total: number) => void
  /**
   * Uma volta terminou. **Conta também a que não precisou de rede**: a obra
   * que já tinha arte e snapshot está pronta, e um contador que só somasse as
   * buscadas nunca alcançaria o próprio denominador.
   */
  tick: (done: number) => void
  /** Alguém pediu para parar. Conferido entre obras, como o `Stop` do import. */
  cancelled?: () => boolean
}

/**
 * O que muda quando o trabalho é um `Refresh` pedido por alguém — 13/09/2026.
 *
 * Aquecer e refrescar são o MESMO percurso com duas perguntas diferentes:
 * aquecer é *"o que falta?"*, refrescar é *"o que mudou?"*. Um segundo módulo
 * copiaria o laço, o tratamento de falha por obra, a pausa e a cessão do event
 * loop para trocar duas condições — e é assim que a segunda cópia diverge.
 */
export type WarmMode = {
  /**
   * Reprocessa mesmo quem já tem arte e snapshot.
   *
   * Sem isto o `Refresh` não faria **nada**: o laço pula a obra completa, que é
   * exatamente a obra que alguém mandou atualizar.
   */
  force?: boolean
  /** Ignora o cache de resposta de 6h. Ver `fetchDetail`. */
  fresh?: boolean
  /**
   * Chamado quando o provedor respondeu, com o que ele disse.
   *
   * É por aqui que o total novo alcança a biblioteca, e **quem decide o que
   * fazer com ele não é este módulo**: o snapshot é linha da INSTALAÇÃO (a
   * chave não tem dono) e `entries` é do usuário, então escrever numa a partir
   * da outra é decisão de quem chamou.
   */
  onCaptured?: (target: ArtTarget) => void
}

export async function warmArt(
  targets: readonly ArtTarget[],
  /**
   * Injetável só para teste — e não é formalidade: em 02/09/2026 um teste com
   * dublê bateu no provedor de verdade porque a injeção parava um degrau antes
   * do caminho novo. Injeção que não alcança não é injeção.
   */
  fetchImpl?: typeof fetch,
  progress?: WarmProgress,
  mode: WarmMode = {},
): Promise<number> {
  if (!env.WATCHPILE_ART_CACHE) {
    return 0
  }

  let written = 0
  const providers = new Map<string, ProviderRow | undefined>()
  const bindings = new Map<string, TypeBinding | undefined>()

  const work = dedupe(targets)
  progress?.begin(work.length)
  let done = 0

  for (const target of work) {
    /**
     * **Antes da obra, não no meio dela.** Conferir aqui custa uma leitura por
     * obra — barato num laço cuja volta já leva centenas de milissegundos —, e
     * é o que permite parar um aquecimento de 52 minutos sem esperar o fim.
     */
    if (progress?.cancelled?.()) {
      break
    }

    /**
     * **O `finally` é quem conta, e não uma linha antes de cada saída.**
     *
     * O corpo abaixo tem três saídas — a obra já pronta, o provedor que sumiu,
     * e o caminho normal —, e contar em cada uma seria três cópias da mesma
     * linha, com a terceira esperando alguém esquecê-la. Aqui a contagem é do
     * BLOCO: toda volta que começa, termina contada, seja qual for o caminho.
     */
    try {
      /**
       * **Duas perguntas, não uma** — 07/09/2026, quando o snapshot entrou.
       *
       * Antes o laço pulava a obra que já tinha arte, e isso passou a esconder o
       * caso em que a arte está em disco e o snapshot não existe: toda obra
       * adicionada antes desta tabela. Uma condição só decidiria pelas duas, e a
       * que ficasse de fora nunca encheria.
       */
      const needsArt = !hasArt(
        target.provider,
        target.externalId,
        target.mediaType,
      )
      const needsSnapshot = !hasSnapshot(target)

      /**
       * **No `Refresh` não há o que pular.** A obra completa é justamente a que
       * alguém mandou atualizar; a condição abaixo existe para o aquecimento,
       * onde repetir trabalho feito gastaria cota de todo mundo por nada.
       */
      if (!mode.force && !needsArt && !needsSnapshot) {
        continue
      }

      const provider = remember(providers, target.provider, () =>
        providerBySlug(target.provider),
      )
      if (!provider) {
        continue
      }

      const binding = remember(
        bindings,
        `${target.mediaType} ${target.provider}`,
        () => bindingFor(target.mediaType, target.provider),
      )

      /**
       * **Nada aqui pode derrubar o processo.** Isto roda solto, sem ninguém
       * esperando a promessa: uma exceção viraria `unhandledRejection` e mataria
       * o container por causa de um pôster.
       */
      try {
        const fetched =
          needsArt || mode.force
            ? await fetchArt({
                provider,
                binding,
                externalId: target.externalId,
                waitForTokenMs: TOKEN_WAIT_MS,
                /**
                 * **Este trabalho cede a vez, e é o ponto do ciclo de 13/09.**
                 * Medido: no AniList (0,5/s) o aquecimento derrubava uma grade
                 * fria de 20 cartas de 7 servidas para 2, porque os dois pediam
                 * do mesmo balde sem precedência.
                 */
                background: true,
                fresh: mode.fresh,
                fetchImpl,
              })
            : null

        /**
         * **O snapshot vem DEPOIS da arte, e é de graça quando ela veio.** As
         * duas saem do mesmo detalhe, e `fetchArt` acabou de enchê-lo no
         * `provider_cache` — esta chamada lê de lá. Quando só o snapshot falta,
         * aí sim é uma ida à rede, que é a única forma de saber o que o provedor
         * diz.
         */
        if (needsSnapshot || mode.force) {
          await captureSnapshot({
            provider,
            binding,
            externalId: target.externalId,
            mediaType: target.mediaType,
            waitForTokenMs: TOKEN_WAIT_MS,
            background: true,
            /**
             * **`fresh` só quando a arte NÃO foi buscada agora** — 13/09/2026.
             *
             * As duas chamadas leem o MESMO detalhe, e a de cima acabou de
             * encher o `provider_cache` com a resposta nova. Repetir `fresh`
             * aqui jogaria fora exatamente o que ela trouxe: uma segunda ida à
             * rede e uma segunda ficha do limitador, por obra.
             *
             * Medido antes do conserto: a varredura andava a **0,47 obras/s**
             * contra um teto de 3/s, e cada obra custava 2,1s — sendo que o
             * detalhe do provedor leva 0,37s e a imagem outros 0,37s. O que
             * sobrava era a segunda busca, paga por nada.
             *
             * Quando só o snapshot falta, aí `fresh` volta a valer: não houve
             * primeira busca para reaproveitar.
             */
            fresh: mode.fresh && !fetched,
            fetchImpl,
          })
          mode.onCaptured?.(target)
        }

        if (fetched?.ok) {
          writeArt({
            provider: target.provider,
            externalId: target.externalId,
            mediaType: target.mediaType,
            bytes: fetched.art.bytes,
            contentType: fetched.art.contentType,
          })
          written += 1
        }
        /**
         * **Falhar aqui não vira nova tentativa**, e é decisão: quem falhou tem a
         * rede de segurança do caminho sob demanda, que roda quando a pessoa
         * finalmente olhar aquela carta. Repetir aqui gastaria cota de todo mundo
         * com uma obra que talvez ninguém abra.
         */
      } catch (error) {
        console.error('[art] warm failed for %s', target.externalId, error)
      }

      await sleep(PAUSE_MS)
      await yieldToLoop()
    } finally {
      done += 1
      progress?.tick(done)
    }
  }

  return written
}

/**
 * O jeito seguro de disparar o aquecimento de dentro de um handler.
 *
 * O `catch` é obrigatório e não é zelo: a promessa não tem dono, e uma rejeição
 * solta vira `unhandledRejection` — o processo morreria por causa de um pôster.
 * E é `void` porque **nenhum handler espera por isto**: adicionar uma obra
 * responde na hora, como sempre respondeu.
 */
export function warmArtInBackground(targets: readonly ArtTarget[]): void {
  if (targets.length === 0) {
    return
  }

  void warmArt(targets).catch((error: unknown) => {
    console.error('[art] warm failed', error)
  })
}

function dedupe(targets: readonly ArtTarget[]): ArtTarget[] {
  const seen = new Set<string>()
  const list: ArtTarget[] = []

  for (const target of targets) {
    const key = `${target.mediaType} ${target.provider} ${target.externalId}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    list.push(target)
  }

  return list
}

function remember<T>(cache: Map<string, T>, key: string, compute: () => T): T {
  const stored = cache.get(key)
  if (stored !== undefined || cache.has(key)) {
    return stored as T
  }
  const value = compute()
  cache.set(key, value)
  return value
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
