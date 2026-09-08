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
 */
const PAUSE_MS = 100

export async function warmArt(
  targets: readonly ArtTarget[],
  /**
   * Injetável só para teste — e não é formalidade: em 02/09/2026 um teste com
   * dublê bateu no provedor de verdade porque a injeção parava um degrau antes
   * do caminho novo. Injeção que não alcança não é injeção.
   */
  fetchImpl?: typeof fetch,
): Promise<number> {
  if (!env.WATCHPILE_ART_CACHE) {
    return 0
  }

  let written = 0
  const providers = new Map<string, ProviderRow | undefined>()
  const bindings = new Map<string, TypeBinding | undefined>()

  for (const target of dedupe(targets)) {
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

    if (!needsArt && !needsSnapshot) {
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
      const fetched = needsArt
        ? await fetchArt({
            provider,
            binding,
            externalId: target.externalId,
            waitForTokenMs: TOKEN_WAIT_MS,
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
      if (needsSnapshot) {
        await captureSnapshot({
          provider,
          binding,
          externalId: target.externalId,
          mediaType: target.mediaType,
          waitForTokenMs: TOKEN_WAIT_MS,
          fetchImpl,
        })
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
