import { setImmediate as yieldToLoop } from 'node:timers/promises'
import { type ArtTarget, warmArtInBackground } from '../art/art.warm.js'
import * as notifications from '../notifications/notifications.store.js'
import * as jobs from './import.jobs.js'
import {
  type ApplyItem,
  ImportFailure,
  type ImportItem,
  type ImportProblem,
  type ImportSource,
} from './import.types.js'

/**
 * O executor de uma importação (brief, 3.12).
 *
 * ── Por que ele existe, e o que exatamente ele protege ──────────────────────
 * O `better-sqlite3` é **síncrono**: cada escrita segura o event loop, e o
 * event loop é o servidor inteiro. Importar doze mil obras num laço direto
 * congelaria o Watchpile de todo mundo por dezenas de segundos — o risco está
 * escrito no brief desde antes de existir uma tela de import.
 *
 * A saída é escrever em LOTES e **ceder o event loop entre eles**. Isso não
 * torna a importação mais rápida; torna o servidor responsivo enquanto ela
 * roda, que é o que permite a tela perguntar "em que pé está?" e a pessoa
 * apertar `Stop`.
 *
 * **Ler não entra na conta.** A fonte lê tudo antes (`ImportSource.read`), e
 * ler é I/O de rede: assíncrono, e não segura nada. Só a escrita bloqueia, e é
 * só ela que se divide.
 *
 * ── Este módulo não sabe escrever obra ──────────────────────────────────────
 * `apply` é injetado. As duas metades falham de jeitos diferentes e se provam
 * com testes diferentes: a mecânica do laço se prova com uma fonte falsa de
 * doze mil itens sem tocar em `entries`; a escrita se prova com três itens e o
 * banco de verdade. Amarradas, cada teste do laço pagaria a montagem de um
 * banco com tipos, provedores e usuário.
 */

/**
 * Os jobs que ESTE processo está executando agora.
 *
 * É o que dá precisão à reconciliação de zumbis: uma linha `running` que não
 * está aqui não pode estar rodando em lugar nenhum — só há um processo, e o
 * índice único garante que só há uma importação. Um boot hook pegaria o
 * processo morto; isto pega também o executor que morreu sozinho.
 */
const aliveHere = new Set<number>()

/** Fecha as linhas `running` órfãs. Chamado nos pontos de entrada do feature. */
export function reconcileInterrupted(): number {
  return jobs.reconcileInterrupted(aliveHere)
}

/**
 * Roda a importação até o fim, e **nunca rejeita**.
 *
 * A rota a dispara sem `await` — ela responde 202 com o job e sai —, então uma
 * promessa rejeitada aqui viraria `unhandledRejection` e derrubaria o processo
 * num container. Tudo que dá errado vira `status = 'failed'` com um `kind`, que
 * é informação para a tela em vez de barulho no log.
 */
export async function run(
  jobId: number,
  source: ImportSource,
  apply: ApplyItem,
  mode: 'skip' | 'overwrite',
): Promise<void> {
  aliveHere.add(jobId)

  try {
    const reading = await source.read()

    jobs.setTotal(jobId, reading.items.length)
    jobs.addProblems(jobId, reading.problems)

    const cancelled = await applyAll(jobId, reading.items, apply, mode)

    jobs.finish(jobId, { status: cancelled ? 'cancelled' : 'done' })
    if (!cancelled) {
      notifyFinished(jobId)
      /**
       * **Sem `await`, e depois de fechar o job** — a arte não faz parte do que
       * o import prometeu. O título, o status e o progresso são o que a pessoa
       * pediu; o pôster é o que a tela já sabe substituir por um ladrilho.
       *
       * Segurar o `done` nisto faria o contador ficar parado em `426 / 426` por
       * minutos dizendo que ainda não acabou, a notificação mentir sobre o que
       * terminou, e uma CDN fora do ar reprovar um import que deu certo.
       *
       * O `catch` é obrigatório e não é zelo: esta promessa não tem dono, e uma
       * rejeição solta vira `unhandledRejection` — o processo morreria por causa
       * de um pôster.
       */
      warmArtInBackground(artTargets(reading.items))
    }
  } catch (error) {
    const failure =
      error instanceof ImportFailure
        ? error
        : new ImportFailure('unexpected', {})

    if (!(error instanceof ImportFailure)) {
      // O `kind` não promete causa; o rastro fica onde rastro mora.
      console.error('[import] job %d failed unexpectedly', jobId, error)
    }

    jobs.finish(jobId, {
      status: 'failed',
      errorKind: failure.kind,
      errorParams: failure.params,
    })
    notifyFailed(jobId, failure.kind)
  } finally {
    aliveHere.delete(jobId)
  }
}

/**
 * Devolve `true` quando parou por causa do `Stop`.
 *
 * **`async` não é detalhe: é a peça.** Uma função síncrona não tem como ceder o
 * event loop — enfileirar a cessão de dentro dela faz o laço inteiro rodar até
 * o fim e só então descarregar as cessões, que é o mesmo bloqueio com mais
 * passos. O `await` no meio do `for` é o que efetivamente devolve o controle.
 */
async function applyAll(
  jobId: number,
  items: readonly ImportItem[],
  apply: ApplyItem,
  mode: 'skip' | 'overwrite',
): Promise<boolean> {
  for (let start = 0; start < items.length; start += jobs.BATCH_SIZE) {
    // **Antes do lote, não durante.** Conferir a cada item pagaria uma consulta
    // por obra pra encurtar a parada em, no máximo, um lote — e é o lote que
    // define quanto tempo o servidor fica preso, não a resposta ao `Stop`.
    if (jobs.cancelRequested(jobId)) {
      return true
    }

    runBatch(jobId, items.slice(start, start + jobs.BATCH_SIZE), apply, mode)

    // A cessão. Sem ela nada disto teria motivo de existir: o laço rodaria numa
    // tarefa só e o servidor ficaria mudo até o fim.
    //
    // `setImmediate` e não `setTimeout(0)`: ele roda na fase de check, depois
    // do I/O já pendente — que é a ordem que se quer, com as requisições
    // chegadas durante o lote respondendo antes do próximo.
    await yieldToLoop()
  }

  return false
}

/**
 * Um lote inteiro, síncrono de propósito — é o pedaço que segura o event loop,
 * e ele é curto por construção.
 *
 * Os contadores vão numa escrita só no fim, não por item: são duas escritas por
 * lote em vez de duas por obra.
 */
function runBatch(
  jobId: number,
  batch: readonly ImportItem[],
  apply: ApplyItem,
  mode: 'skip' | 'overwrite',
): void {
  const delta = { processed: 0, added: 0, skipped: 0, updated: 0, unmatched: 0 }
  const problems: ImportProblem[] = []

  for (const item of batch) {
    delta.processed += 1

    const outcome = apply(item, mode)
    switch (outcome.kind) {
      case 'added':
        delta.added += 1
        if (outcome.unmatched) {
          delta.unmatched += 1
        }
        break
      case 'skipped':
        delta.skipped += 1
        break
      case 'updated':
        delta.updated += 1
        break
      case 'problem':
        problems.push(outcome.problem)
        break
    }
  }

  jobs.addProgress(jobId, delta)
  jobs.addProblems(jobId, problems)
}

/**
 * **Cancelar não avisa.** A pessoa apertou `Stop` e está olhando a tela: a
 * notificação existe pra quem NÃO estava olhando, e avisar aqui seria contar
 * de volta o que ela acabou de fazer.
 *
 * Terminar e falhar avisam, e os dois são de audiência `user` — é o primeiro
 * emissor de usuário do app. O degrau `info` do contador do sino existe desde
 * 06/09/2026 e nunca tinha sido exercitado.
 */
function notifyFinished(jobId: number): void {
  const job = jobs.byId(jobId)
  if (!job) {
    return
  }

  notifications.emit({
    audience: 'user',
    userId: job.userId,
    severity: 'info',
    kind: 'import-finished',
    params: {
      source: job.source,
      added: job.added,
      problemCount: job.problemCount,
    },
  })
}

function notifyFailed(jobId: number, reason: string): void {
  const job = jobs.byId(jobId)
  if (!job) {
    return
  }

  // `warning` e não `info`, e não `danger`: o import não aconteceu e a pessoa
  // precisa refazê-lo — há o que fazer —, mas nada quebrou na instalação. O
  // barulho do sinal acompanha o tamanho do fato (design system, seção 5).
  notifications.emit({
    audience: 'user',
    userId: job.userId,
    severity: 'warning',
    kind: 'import-failed',
    params: { source: job.source, reason },
  })
}

/**
 * De que arte cada obra importada precisa.
 *
 * **O vínculo que interessa é o PRIMEIRO**, porque é o mais antigo da obra, e é
 * o mais antigo que responde por ela quando não há escolha explícita
 * (`sourceOf`). Aquecer pelo segundo gravaria uma arte que a rota nunca vai
 * pedir.
 *
 * Obra sem vínculo nenhum cai fora: não há de onde tirar arte, e ela seguirá no
 * ladrilho com ou sem rede até ser vinculada.
 */
function artTargets(items: readonly ImportItem[]): ArtTarget[] {
  const targets: ArtTarget[] = []

  for (const item of items) {
    const link = item.links[0]
    if (link) {
      targets.push({
        provider: link.provider,
        externalId: link.externalId,
        mediaType: item.mediaType,
      })
    }
  }

  return targets
}
