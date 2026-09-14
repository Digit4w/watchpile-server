import { setImmediate as yieldToLoop } from 'node:timers/promises'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/client.js'
import { notifications } from '../../db/schema/notifications.js'
import { users } from '../../db/schema/users.js'
import { hashPassword } from '../auth/auth.crypto.js'
import * as jobs from './import.jobs.js'
import { reconcileInterrupted, run, startFilling } from './import.runner.js'
import {
  type ApplyItem,
  ImportFailure,
  type ImportItem,
  type ImportProblem,
  type ImportSource,
} from './import.types.js'

/**
 * A mecânica do executor, com uma fonte FALSA.
 *
 * É a metade que se prova sem tocar em `entries`: o laço não sabe escrever
 * obra, ele conta resultados, cede o event loop e obedece ao `Stop`. Amarrar
 * estes testes ao aplicador de verdade faria cada um deles montar um banco com
 * tipos, provedores e vínculos pra provar uma coisa que não depende de nenhum
 * dos três.
 */

function criarUsuario(username = 'fernando'): number {
  const [row] = db
    .insert(users)
    .values({ username, passwordHash: hashPassword('password123') })
    .returning({ id: users.id })
    .all()

  if (!row) {
    throw new Error('insert returned no row')
  }
  return row.id
}

function item(n: number): ImportItem {
  return {
    mediaType: 'anime',
    title: `Obra ${n}`,
    status: 'watching',
    progress: n % 12,
    total: 12,
    links: [{ provider: 'anilist', externalId: String(n) }],
    partialIdentity: false,
    occurredAt: null,
  }
}

function fonte(
  items: ImportItem[],
  problems: ImportProblem[] = [],
): ImportSource {
  return { read: () => Promise.resolve({ items, problems }) }
}

function fonteQueFalha(error: unknown): ImportSource {
  return { read: () => Promise.reject(error) }
}

/** Um aplicador que só responde o que o teste mandou, sem tocar no banco. */
function aplicador(
  responder: (item: ImportItem) => ReturnType<ApplyItem>,
): ApplyItem {
  return (item) => responder(item)
}

const adiciona: ApplyItem = () => ({ kind: 'added', unmatched: false })

beforeEach(() => {
  db.delete(notifications).run()
  db.delete(users).run()
})

describe('o executor conta o que aconteceu', () => {
  it('escreve os quatro contadores e o total', async () => {
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'anilist', mode: 'skip' })

    await run(
      job.id,
      fonte([item(1), item(2), item(3), item(4)]),
      aplicador((i) => {
        if (i.title.endsWith('1')) return { kind: 'added', unmatched: false }
        if (i.title.endsWith('2')) return { kind: 'added', unmatched: true }
        if (i.title.endsWith('3')) return { kind: 'skipped' }
        return { kind: 'problem', problem: { kind: 'unknown-media-type' } }
      }),
      'skip',
    )

    expect(jobs.byId(job.id)).toMatchObject({
      status: 'done',
      total: 4,
      processed: 4,
      added: 2,
      skipped: 1,
      updated: 0,
      // `unmatched` é RECORTE de `added`, não um quinto resultado: as duas que
      // entraram somam 2, e uma delas entrou sem par.
      unmatched: 1,
      problemCount: 1,
    })
  })

  it('guarda os problemas que a LEITURA já encontrou', async () => {
    // Um CSV com linha ilegível produz problema antes de o laço começar — a
    // fonte devolve os dois lados do que conseguiu ler.
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'csv', mode: 'skip' })

    await run(
      job.id,
      fonte([item(1)], [{ kind: 'missing-identity', row: 14 }]),
      adiciona,
      'skip',
    )

    const done = jobs.byId(job.id)
    expect(done?.problemCount).toBe(1)
    expect(JSON.parse(done?.problems ?? '[]')).toEqual([
      { kind: 'missing-identity', row: 14 },
    ])
  })
})

describe('o executor CEDE o event loop entre lotes', () => {
  it('deixa outra tarefa rodar no meio da importação', async () => {
    // ── O teste que existe por causa de um defeito real ─────────────────────
    // A primeira versão de `applyAll` era SÍNCRONA e enfileirava a cessão num
    // encadeamento de promessas. Isso não cede nada: o laço inteiro roda até o
    // fim e só então as cessões são descarregadas — o mesmo bloqueio, com mais
    // passos, e sem nada na tela ou nos outros testes denunciando.
    //
    // A prova é agendar uma tarefa no MESMO instante em que o import começa e
    // perguntar quanto ele já tinha feito quando ela rodou. Com o laço cedendo,
    // ela pega o import pela metade; com o laço bloqueando, ela só roda depois
    // do fim e vê o total.
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'anilist', mode: 'skip' })

    const TOTAL = jobs.BATCH_SIZE * 5
    const items = Array.from({ length: TOTAL }, (_, i) => item(i))

    let processadoQuandoOutraTarefaRodou = -1
    const rodando = run(job.id, fonte(items), adiciona, 'skip')
    setImmediate(() => {
      processadoQuandoOutraTarefaRodou = jobs.byId(job.id)?.processed ?? -1
    })

    await rodando

    expect(processadoQuandoOutraTarefaRodou).toBeGreaterThan(0)
    expect(processadoQuandoOutraTarefaRodou).toBeLessThan(TOTAL)
    expect(jobs.byId(job.id)?.processed).toBe(TOTAL)
  })
})

describe('o Stop', () => {
  it('para no fim do lote, e o que já entrou FICA', async () => {
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'anilist', mode: 'skip' })

    const TOTAL = jobs.BATCH_SIZE * 4
    const items = Array.from({ length: TOTAL }, (_, i) => item(i))

    const rodando = run(job.id, fonte(items), adiciona, 'skip')
    // O pedido chega durante a importação, como chegaria pela rota.
    setImmediate(() => {
      jobs.requestCancel(job.id, userId)
    })

    await rodando

    const parado = jobs.byId(job.id)
    expect(parado?.status).toBe('cancelled')
    // Cancelar interrompe, não desfaz: as obras do lote que já rodou ficam.
    expect(parado?.added).toBeGreaterThan(0)
    expect(parado?.added).toBeLessThan(TOTAL)
    // E o lote é a granularidade da parada, por construção.
    expect((parado?.processed ?? 0) % jobs.BATCH_SIZE).toBe(0)
  })

  it('não emite notificação — quem apertou Stop está olhando a tela', async () => {
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'anilist', mode: 'skip' })
    jobs.requestCancel(job.id, userId)

    await run(job.id, fonte([item(1)]), adiciona, 'skip')

    expect(jobs.byId(job.id)?.status).toBe('cancelled')
    expect(db.select().from(notifications).all()).toHaveLength(0)
  })

  it('recusa o pedido de quem não é dono do job', () => {
    const dono = criarUsuario('fernando')
    const outra = criarUsuario('outra-pessoa')
    const job = jobs.start({ userId: dono, source: 'anilist', mode: 'skip' })

    expect(jobs.requestCancel(job.id, outra)).toBe(false)
    expect(jobs.cancelRequested(job.id)).toBe(false)
  })
})

describe('quando o job inteiro falha', () => {
  it('guarda o kind que a fonte levantou', async () => {
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'anilist', mode: 'skip' })

    await run(
      job.id,
      fonteQueFalha(new ImportFailure('private-profile', { username: 'fer' })),
      adiciona,
      'skip',
    )

    expect(jobs.byId(job.id)).toMatchObject({
      status: 'failed',
      errorKind: 'private-profile',
      errorParams: '{"username":"fer"}',
    })
  })

  it('traduz defeito NOSSO em `unexpected`, sem prometer causa', async () => {
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'csv', mode: 'skip' })

    await run(
      job.id,
      fonteQueFalha(new TypeError('x is not a function')),
      adiciona,
      'skip',
    )

    expect(jobs.byId(job.id)?.errorKind).toBe('unexpected')
  })

  it('nunca rejeita, porque a rota a dispara sem await', async () => {
    // Uma promessa rejeitada aqui viraria `unhandledRejection` e derrubaria o
    // processo dentro de um container.
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'csv', mode: 'skip' })

    await expect(
      run(job.id, fonteQueFalha(new Error('boom')), adiciona, 'skip'),
    ).resolves.toBeUndefined()
  })
})

describe('as notificações', () => {
  it('avisa quando termina, com audiência de USUÁRIO e degrau info', async () => {
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'anilist', mode: 'skip' })

    await run(job.id, fonte([item(1), item(2)]), adiciona, 'skip')

    const [aviso] = db.select().from(notifications).all()
    expect(aviso).toMatchObject({
      audience: 'user',
      userId,
      severity: 'info',
      kind: 'import-finished',
    })
    // `kind` + `params`, nunca a frase: a linha é persistida e sobreviveria à
    // tradução do app.
    expect(JSON.parse(aviso?.params ?? '{}')).toEqual({
      source: 'anilist',
      added: 2,
      problemCount: 0,
    })
  })

  it('avisa quando falha, com o motivo dentro dos params', async () => {
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'mal', mode: 'skip' })

    await run(
      job.id,
      fonteQueFalha(new ImportFailure('source-down')),
      adiciona,
      'skip',
    )

    const [aviso] = db.select().from(notifications).all()
    expect(aviso).toMatchObject({ severity: 'warning', kind: 'import-failed' })
    // É o `reason` que deixa a copy separar "confira o nome" de "tente mais
    // tarde" — a divisão `refused`/`down` de 02/09 vive aqui, não na severidade.
    expect(JSON.parse(aviso?.params ?? '{}').reason).toBe('source-down')
  })
})

describe('a reconciliação de zumbis', () => {
  it('fecha a linha running que este processo não está executando', () => {
    const userId = criarUsuario()
    const zumbi = jobs.start({ userId, source: 'anilist', mode: 'skip' })

    // Ninguém está rodando: o executor deste processo não conhece esta linha.
    expect(reconcileInterrupted()).toBe(1)
    expect(jobs.byId(zumbi.id)).toMatchObject({
      status: 'failed',
      errorKind: 'interrupted',
    })
  })

  it('destrava a instalação — é o que impede o índice de virar cadeado', () => {
    const userId = criarUsuario()
    jobs.start({ userId, source: 'anilist', mode: 'skip' })

    // Sem reconciliar, a segunda esbarra no índice único parcial.
    expect(() => jobs.start({ userId, source: 'csv', mode: 'skip' })).toThrow(
      /UNIQUE constraint failed/,
    )

    reconcileInterrupted()

    expect(() =>
      jobs.start({ userId, source: 'csv', mode: 'skip' }),
    ).not.toThrow()
  })

  it('NÃO fecha o job que está rodando agora', async () => {
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'anilist', mode: 'skip' })

    const items = Array.from({ length: jobs.BATCH_SIZE * 3 }, (_, i) => item(i))
    let fechadosNoMeio = -1

    const rodando = run(job.id, fonte(items), adiciona, 'skip')
    setImmediate(() => {
      fechadosNoMeio = reconcileInterrupted()
    })

    await rodando

    expect(fechadosNoMeio).toBe(0)
    expect(jobs.byId(job.id)?.status).toBe('done')
  })
})

describe('o teto da lista de problemas', () => {
  it('guarda os primeiros N e conta todos', async () => {
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'csv', mode: 'skip' })

    const excesso = jobs.MAX_STORED_PROBLEMS + 37
    const items = Array.from({ length: excesso }, (_, i) => item(i))

    await run(
      job.id,
      fonte(items),
      aplicador(() => ({
        kind: 'problem',
        problem: { kind: 'invalid-status', params: { value: 'Rewatching' } },
      })),
      'skip',
    )

    const done = jobs.byId(job.id)
    // A contagem é a verdade; a lista é o que cabe.
    expect(done?.problemCount).toBe(excesso)
    expect(JSON.parse(done?.problems ?? '[]')).toHaveLength(
      jobs.MAX_STORED_PROBLEMS,
    )
  })
})

describe('a linha some junto com quem importou', () => {
  it('apaga em cascata', async () => {
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'anilist', mode: 'skip' })
    await run(job.id, fonte([item(1)]), adiciona, 'skip')

    db.delete(users).where(eq(users.id, userId)).run()

    expect(jobs.byId(job.id)).toBeUndefined()
  })
})

describe('o executor não segura o banco entre lotes', () => {
  it('deixa o status ser lido enquanto roda', async () => {
    // É o que a tela faz: pergunta "em que pé está?" durante a importação. Se o
    // laço não cedesse, esta leitura só voltaria depois do fim — e o contador
    // da tela seria sempre `0 / N` seguido de `N / N`.
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'anilist', mode: 'skip' })

    const items = Array.from({ length: jobs.BATCH_SIZE * 4 }, (_, i) => item(i))
    const leituras: number[] = []

    const rodando = run(job.id, fonte(items), adiciona, 'skip')
    const espiao = (async () => {
      for (let i = 0; i < 3; i += 1) {
        await yieldToLoop()
        leituras.push(jobs.running('import')?.processed ?? -1)
      }
    })()

    await Promise.all([rodando, espiao])

    // Cada espiada pegou um estágio diferente: o contador ANDOU enquanto a
    // importação rodava, que é a coisa toda.
    expect(leituras.every((n) => n >= 0)).toBe(true)
    expect(new Set(leituras).size).toBeGreaterThan(1)
  })
})

/**
 * A SEGUNDA fase — 13/09/2026.
 *
 * O aquecimento era invisível: o `status` ia a `done` e o sino disparava antes
 * de ele começar, e nesse intervalo — 18,7 min no MyAnimeList, 52 min no
 * AniList, medidos contra 1.200 obras — a pessoa já tinha lido "terminou".
 *
 * Estes testes afirmam a FORMA: duas linhas, dois contadores, e a primeira
 * fechando sem esperar pela segunda. O que acontece dentro do laço de
 * aquecimento é de `art.warm.test.ts`.
 */
describe('o enriquecimento é a segunda fase, e tem contador próprio', () => {
  it('abre uma linha PRÓPRIA, sem tocar na do import', async () => {
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'anilist', mode: 'skip' })

    await run(job.id, fonte([item(1), item(2)]), adiciona, 'skip')

    const importado = jobs.byId(job.id)
    expect(importado?.kind).toBe('import')
    expect(importado?.status).toBe('done')

    const enrich = jobs.latestOfKindFor(userId, 'enrich')
    expect(enrich).toBeDefined()
    expect(enrich?.id).not.toBe(job.id)
    expect(enrich?.kind).toBe('enrich')
    /** A procedência: de qual importação este aquecimento veio. */
    expect(enrich?.source).toBe('anilist')
  })

  /**
   * A decisão de 07/09 continua inteira, e é ela que este teste protege:
   * segurar o `done` no aquecimento faria o contador parar em `N / N` por
   * minutos e uma CDN fora do ar reprovar um import que deu certo.
   */
  it('fecha o import SEM esperar pelo aquecimento', async () => {
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'anilist', mode: 'skip' })

    await run(job.id, fonte([item(1)]), adiciona, 'skip')

    expect(jobs.byId(job.id)?.status).toBe('done')
    expect(jobs.byId(job.id)?.finishedAt).not.toBeNull()
  })

  /**
   * **O índice único passou a ser por TIPO**, e é o que impede um aquecimento
   * de 52 minutos de recusar todo import novo. Antes ele indexava só `status`,
   * o que valia "uma linha viva na instalação inteira".
   */
  it('deixa um import começar com um aquecimento vivo', async () => {
    const userId = criarUsuario()
    const primeiro = jobs.start({ userId, source: 'anilist', mode: 'skip' })
    await run(primeiro.id, fonte([item(1)]), adiciona, 'skip')

    const enrich = jobs.latestOfKindFor(userId, 'enrich')
    expect(enrich?.status).toBe('running')

    // Com o índice antigo, esta linha lançaria por constraint.
    const segundo = jobs.start({ userId, source: 'csv', mode: 'skip' })
    expect(segundo.kind).toBe('import')
    expect(jobs.running('import')?.id).toBe(segundo.id)
  })

  /** Obra sem vínculo não tem de onde tirar arte — não há o que aquecer. */
  it('não abre linha nenhuma quando não há alvo', async () => {
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'csv', mode: 'skip' })

    const semVinculo: ImportItem = { ...item(1), links: [] }
    await run(job.id, fonte([semVinculo]), adiciona, 'skip')

    expect(jobs.latestOfKindFor(userId, 'enrich')).toBeUndefined()
  })

  /** Cancelar o import não pode deixar um aquecimento órfão para trás. */
  it('não aquece o que foi cancelado', async () => {
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'anilist', mode: 'skip' })

    const items = Array.from({ length: jobs.BATCH_SIZE * 2 }, (_, i) => item(i))
    jobs.requestCancel(job.id, userId)
    await run(job.id, fonte(items), adiciona, 'skip')

    expect(jobs.byId(job.id)?.status).toBe('cancelled')
    expect(jobs.latestOfKindFor(userId, 'enrich')).toBeUndefined()
  })
})

/**
 * Preencher o que falta, e o trabalho interrompido — 14/09/2026.
 *
 * O que estes testes protegem é a decisão que uniu dois pedidos do dono:
 * **retomar depois de um stop e disparar à mão são a mesma ação**, porque
 * aquecer pula o que já está guardado. Se um dia alguém separar as duas, o
 * teste de `startFilling` continua verde e o de `dismiss` também — o que
 * quebra é a promessa, e é por isso que ela está escrita aqui.
 */
describe('preencher o que falta', () => {
  it('não abre job quando não há nada faltando', () => {
    const userId = criarUsuario()
    expect(startFilling(userId, [])).toBeNull()
  })

  it('abre um job de aquecimento, do mesmo tipo que o import dispara', () => {
    const userId = criarUsuario()

    const job = startFilling(userId, [
      { provider: 'anilist', externalId: '1', mediaType: 'anime' },
    ])

    /**
     * **`enrich` e não um quarto tipo**: é literalmente o mesmo trabalho que o
     * import dispara ao terminar, e o que muda é só quem apertou.
     */
    expect(job?.kind).toBe('enrich')
    /** Não veio de fonte nenhuma, como a varredura. */
    expect(job?.source).toBeNull()
  })

  it('recusa quando já há um aquecimento vivo', () => {
    const userId = criarUsuario()
    const alvo = [{ provider: 'anilist', externalId: '2', mediaType: 'anime' }]

    expect(startFilling(userId, alvo)).not.toBeNull()
    // O índice único por tipo recusa o segundo, e isso É a resposta.
    expect(startFilling(userId, alvo)).toBeNull()
  })
})

describe('dispensar um trabalho interrompido', () => {
  function interrompido(userId: number): number {
    const job = jobs.start({
      userId,
      source: 'mal',
      mode: 'skip',
      kind: 'enrich',
    })
    jobs.finish(job.id, { status: 'failed', errorKind: 'interrupted' })
    return job.id
  }

  /** **Dispensar não é apagar** — a linha fica, o aviso sai. */
  it('carimba sem remover a linha', () => {
    const userId = criarUsuario()
    const id = interrompido(userId)

    expect(jobs.dismiss(id, userId)).toBe(true)
    expect(jobs.byId(id)).toBeDefined()
    expect(jobs.byId(id)?.dismissedAt).not.toBeNull()
  })

  it('não dispensa duas vezes', () => {
    const userId = criarUsuario()
    const id = interrompido(userId)

    expect(jobs.dismiss(id, userId)).toBe(true)
    expect(jobs.dismiss(id, userId)).toBe(false)
  })

  it('não alcança o trabalho de outra pessoa', () => {
    const dono = criarUsuario('dono')
    const outro = criarUsuario('outro')
    const id = interrompido(dono)

    expect(jobs.dismiss(id, outro)).toBe(false)
    expect(jobs.byId(id)?.dismissedAt).toBeNull()
  })

  /** Um trabalho vivo não se dispensa — se para. */
  it('não dispensa o que ainda está rodando', () => {
    const userId = criarUsuario()
    const job = jobs.start({ userId, source: 'mal', mode: 'skip' })

    expect(jobs.dismiss(job.id, userId)).toBe(false)
  })
})

describe('limpar o histórico', () => {
  it('apaga o que terminou e PRESERVA o que está rodando', () => {
    const userId = criarUsuario()

    const vivo = jobs.start({ userId, source: 'mal', mode: 'skip' })
    const morto = jobs.start({
      userId,
      source: 'csv',
      mode: 'skip',
      kind: 'enrich',
    })
    jobs.finish(morto.id, { status: 'done' })

    expect(jobs.clearHistory(userId)).toBe(1)

    /**
     * O vivo fica, e não por zelo: apagar a linha de um trabalho em curso
     * deixaria o executor escrevendo contadores numa linha que não existe.
     */
    expect(jobs.byId(vivo.id)).toBeDefined()
    expect(jobs.byId(morto.id)).toBeUndefined()
  })

  it('não alcança o histórico de outra pessoa', () => {
    const dono = criarUsuario('dono')
    const outro = criarUsuario('outro')
    const dele = jobs.start({ userId: outro, source: 'csv', mode: 'skip' })
    jobs.finish(dele.id, { status: 'done' })

    expect(jobs.clearHistory(dono)).toBe(0)
    expect(jobs.byId(dele.id)).toBeDefined()
  })
})
