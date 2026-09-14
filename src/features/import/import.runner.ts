import { setImmediate as yieldToLoop } from 'node:timers/promises'
import { logger } from '../../lib/logger.js'
import { type ArtTarget, warmArt } from '../art/art.warm.js'
import * as notifications from '../notifications/notifications.store.js'
import { refreshTitles } from '../titles/titles.refresh.js'
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
    logger.info(
      { jobId, items: reading.items.length, cancelled },
      'import finished',
    )
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
       * **O que mudou em 13/09/2026 é que ele deixou de ser MUDO.** A decisão
       * acima continua inteira — ele segue fora do contador do import —, e o
       * que ele ganha é um contador PRÓPRIO: duas fases, dois números. Antes a
       * pessoa lia "terminou", fechava a tela, e o servidor passava de 18 a 52
       * minutos buscando arte sem nada dizer.
       */
      startEnriching(jobId, artTargets(reading.items))
    }
  } catch (error) {
    const failure =
      error instanceof ImportFailure
        ? error
        : new ImportFailure('unexpected', {})

    if (error instanceof ImportFailure) {
      // Falha tipada é da FONTE (perfil privado, API fora): a tela já diz qual,
      // e o log guarda o `kind` pra quem vier perguntar. `params` fica de fora,
      // porque carrega o nome de usuário de quem importou.
      logger.warn({ jobId, kind: failure.kind }, 'import failed')
    } else {
      // O `kind` não promete causa; o rastro fica onde rastro mora.
      logger.error({ jobId, err: error }, 'import failed unexpectedly')
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
 * **Preencher o que falta** — 14/09/2026, pedido do dono.
 *
 * ── Por que ela é `enrich`, e não um quarto tipo ───────────────────────────
 * Porque é exatamente o mesmo trabalho que o import dispara ao terminar:
 * `warmArt` sem `force` e sem `fresh`, que **pula o que já está guardado**. O
 * que muda é só o gatilho — lá é consequência de um import, aqui é alguém
 * pedindo. Um `kind` novo separaria duas linhas idênticas no banco para
 * registrar quem apertou o botão, e isso não muda nada do que a tela mostra.
 *
 * ── Uma ação, duas situações, e é a mesma por construção ───────────────────
 * O dono pediu duas coisas: lidar com stops repentinos, e poder disparar o
 * aquecimento à mão. **São a mesma.** Aquecer pula o que já está feito, então
 * "continuar de onde parou" não precisa saber onde parou — basta rodar de novo,
 * e ele acha o que falta. É por isso que `Continue` e `Fill in missing`
 * chamam esta função sem diferença nenhuma.
 *
 * E ela **não é** o `Refresh`: aquele passa `force: true, fresh: true` e relê a
 * biblioteca inteira à força, custando tudo em vez de custar só o buraco.
 */
export function startFilling(
  userId: number,
  targets: readonly ArtTarget[],
): jobs.Job | null {
  if (targets.length === 0) {
    return null
  }

  let job: jobs.Job
  try {
    job = jobs.start({
      userId,
      /** Não veio de fonte nenhuma — como a varredura (`0054`). */
      source: null,
      mode: 'skip',
      kind: 'enrich',
    })
  } catch (error) {
    // Já há um aquecimento rodando: o índice único recusou, e isso É a resposta.
    logger.debug({ userId, err: error }, 'fill job not started')
    return null
  }

  aliveHere.add(job.id)

  void warmArt(targets, undefined, {
    begin: (total) => jobs.setTotal(job.id, total),
    tick: (done) => jobs.setProcessed(job.id, done),
    cancelled: () => jobs.cancelRequested(job.id),
  })
    .then(() => {
      jobs.finish(job.id, {
        status: jobs.cancelRequested(job.id) ? 'cancelled' : 'done',
      })
    })
    .catch((error: unknown) => {
      logger.error({ jobId: job.id, err: error }, 'fill job failed')
      jobs.finish(job.id, { status: 'failed', errorKind: 'unexpected' })
    })
    .finally(() => {
      aliveHere.delete(job.id)
    })

  return job
}

/**
 * A VARREDURA: reler o provedor para a biblioteca inteira — 13/09/2026,
 * item 11(c) da fila do dono.
 *
 * ── Sob demanda, e por que isso NÃO fura o brief 3.1 ────────────────────────
 * A 3.1 recusa infraestrutura de fila, e o argumento que deixou o aquecimento
 * passar foi ser um laço sem estado que termina sozinho. Este tem estado — a
 * linha do job —, e mesmo assim não é fila: **não há agenda, não há retentativa,
 * não há trabalho esperando para ser pego**. Quem o dispara é um gesto, e ele
 * morre quando acaba.
 *
 * **O cron interno vem depois** (decisão do dono, 13/09/2026), e é ele que vai
 * pedir a conversa sobre a 3.1. O que este ciclo deixa pronto para ele é o
 * corte por idade em `refreshTargets` — ver aquele módulo.
 *
 * ── Ele é `enrich` com outra pergunta, e por isso não é `enrich` ────────────
 * Mesmo percurso, mesma peça (`warmArt`), `kind` diferente. O índice único por
 * tipo deixa os dois coexistirem: recusar a varredura que alguém pediu porque
 * um aquecimento automático ainda roda seria o gesto perdendo para o efeito
 * colateral.
 */
export function startRefresh(
  userId: number,
  targets: readonly ArtTarget[],
): jobs.Job | null {
  if (targets.length === 0) {
    return null
  }

  let job: jobs.Job
  try {
    job = jobs.start({
      userId,
      /** Nula: uma varredura relê vários provedores, não uma fonte. */
      source: null,
      /**
       * `mode` não diz nada aqui — não há colisão a resolver, porque nada
       * entra. Fica no valor que não promete escrita destrutiva.
       */
      mode: 'skip',
      kind: 'refresh',
    })
  } catch (error) {
    // Já há uma varredura rodando: o índice único recusou, e isso é a resposta.
    logger.debug({ userId, err: error }, 'refresh job not started')
    return null
  }

  aliveHere.add(job.id)

  void refreshTitles(targets, {
    progress: {
      begin: (total) => jobs.setTotal(job.id, total),
      tick: (done) => jobs.setProcessed(job.id, done),
      cancelled: () => jobs.cancelRequested(job.id),
    },
  })
    .then((updated) => {
      /**
       * **Quantas obras mudaram de total vai em `updated`**, que é a coluna que
       * já existe com esse nome e esse significado no import. Reusar é o que
       * deixa a tela ler os dois trabalhos com a mesma peça.
       */
      jobs.addProgress(job.id, {
        processed: 0,
        added: 0,
        skipped: 0,
        updated,
        unmatched: 0,
      })
      jobs.finish(job.id, {
        status: jobs.cancelRequested(job.id) ? 'cancelled' : 'done',
      })
    })
    .catch((error: unknown) => {
      logger.error({ jobId: job.id, err: error }, 'refresh job failed')
      jobs.finish(job.id, { status: 'failed', errorKind: 'unexpected' })
    })
    .finally(() => {
      aliveHere.delete(job.id)
    })

  return job
}

/**
 * A SEGUNDA fase: buscar arte e snapshot do que o import trouxe, contando.
 *
 * ── Por que ela é um job, e não um laço solto ───────────────────────────────
 * Porque a pergunta "em que pé está?" precisa ser respondível de fora do laço,
 * e a resposta precisa sobreviver a quem fecha a aba — que é o mesmo argumento
 * que fez `import_jobs` existir. Ela reusa a tabela inteira em vez de ganhar a
 * sua: `status`, `total`, `processed`, o carimbo de cancelamento e a
 * reconciliação de zumbi já estão lá.
 *
 * ── Nada aqui é esperado por ninguém ────────────────────────────────────────
 * `run` já respondeu, o job de import já fechou e a notificação já saiu. O
 * `catch` externo é obrigatório pelo mesmo motivo de sempre: esta promessa não
 * tem dono, e uma rejeição solta vira `unhandledRejection` — o processo morreria
 * por causa de um pôster.
 */
function startEnriching(importJobId: number, targets: ArtTarget[]): void {
  if (targets.length === 0) {
    return
  }

  const parent = jobs.byId(importJobId)
  if (!parent) {
    return
  }

  let job: jobs.Job
  try {
    job = jobs.start({
      userId: parent.userId,
      // A procedência: de qual importação este aquecimento veio.
      source: parent.source,
      mode: parent.mode,
      kind: 'enrich',
    })
  } catch (error) {
    /**
     * **O índice único recusando é um caminho normal, não um defeito.** Dois
     * imports em sequência rápida deixam o aquecimento do primeiro ainda vivo,
     * e o segundo não abre o seu. A arte que ficar de fora cai na rede de
     * segurança do caminho sob demanda, que é a mesma de sempre.
     */
    logger.debug({ importJobId, err: error }, 'enrich job not started')
    return
  }

  aliveHere.add(job.id)

  void warmArt(targets, undefined, {
    begin: (total) => jobs.setTotal(job.id, total),
    /**
     * **O contador anda de um em um, e isso é barato AQUI.** Uma escrita por
     * obra seria cara no import, onde o lote inteiro leva 14ms; aqui cada volta
     * já custa centenas de milissegundos de rede, então a escrita some no ruído.
     */
    tick: (done) => jobs.setProcessed(job.id, done),
    cancelled: () => jobs.cancelRequested(job.id),
  })
    .then((written) => {
      jobs.finish(job.id, {
        status: jobs.cancelRequested(job.id) ? 'cancelled' : 'done',
      })
      return written
    })
    .catch((error: unknown) => {
      logger.error({ jobId: job.id, err: error }, 'enrich job failed')
      jobs.finish(job.id, { status: 'failed', errorKind: 'unexpected' })
    })
    .finally(() => {
      aliveHere.delete(job.id)
    })
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
      /**
       * **Só o `import` notifica**, e ele sempre tem fonte — `source` só é nula
       * na varredura (`0054`), que não emite notificação nenhuma. O `??` é a
       * rede para o dia em que isso deixar de ser verdade: uma frase com a
       * palavra errada é melhor que uma notificação que não nasce.
       */
      source: job.source ?? 'csv',
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
    params: { source: job.source ?? 'csv', reason },
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
