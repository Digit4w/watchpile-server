import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { eventLog } from '../../db/schema/event-log.js'
import { externalIds } from '../../db/schema/external-ids.js'
import { users } from '../../db/schema/users.js'
import { hashPassword } from '../auth/auth.crypto.js'
import { createApplier } from './import.apply.js'
import type { ImportItem } from './import.types.js'

/**
 * A escrita de uma obra importada — a metade que o executor não conhece.
 *
 * Aqui está a decisão inteira do ciclo: **casa pelo id que veio, e o que não
 * casa entra assim mesmo**. O Yamtrack descarta a obra nesse caso; nós temos
 * `external_ids` como tabela e não precisamos.
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

function obra(over: Partial<ImportItem> = {}): ImportItem {
  return {
    mediaType: 'anime',
    title: 'Frieren',
    status: 'watching',
    progress: 4,
    total: 28,
    links: [{ provider: 'anilist', externalId: '154587' }],
    partialIdentity: false,
    occurredAt: null,
    ...over,
  }
}

function biblioteca(userId: number) {
  return db.select().from(entries).where(eq(entries.userId, userId)).all()
}

function vinculosDe(entryId: number) {
  return db
    .select({
      provider: externalIds.provider,
      externalId: externalIds.externalId,
    })
    .from(externalIds)
    .where(eq(externalIds.entryId, entryId))
    .all()
}

function eventosDe(entryId: number) {
  return db.select().from(eventLog).where(eq(eventLog.entryId, entryId)).all()
}

beforeEach(() => {
  db.delete(users).run()
})

describe('a obra nova', () => {
  it('entra com o vínculo que a fonte trouxe', () => {
    const userId = criarUsuario()
    const outcome = createApplier(userId)(obra(), 'skip')

    expect(outcome).toEqual({ kind: 'added', unmatched: false })

    const [criada] = biblioteca(userId)
    expect(criada).toMatchObject({
      title: 'Frieren',
      mediaType: 'anime',
      status: 'watching',
      progress: 4,
      total: 28,
    })
    expect(vinculosDe(criada?.id ?? 0)).toEqual([
      { provider: 'anilist', externalId: '154587' },
    ])
  })

  it('grava o progresso no LOG, com origem `import` e data da fonte', () => {
    // Contador e evento na mesma transação é a invariante do brief 3.11. E
    // `occurred_at` é a data da FONTE: sem isso o histórico de dez anos de
    // alguém nasceria todo carimbado no dia da mudança.
    const userId = criarUsuario()
    const quando = new Date('2019-04-07T00:00:00Z')

    createApplier(userId)(obra({ occurredAt: quando }), 'skip')

    const [criada] = biblioteca(userId)
    const [evento] = eventosDe(criada?.id ?? 0)
    expect(evento).toMatchObject({
      type: 'progress_delta',
      delta: 4,
      origin: 'import',
    })
    expect(evento?.occurredAt?.toISOString()).toBe(quando.toISOString())
  })

  it('não inventa evento para obra sem progresso', () => {
    const userId = criarUsuario()
    createApplier(userId)(obra({ progress: 0, status: 'planned' }), 'skip')

    const [criada] = biblioteca(userId)
    expect(eventosDe(criada?.id ?? 0)).toHaveLength(0)
  })

  it('ENTRA mesmo sem par, e conta como `unmatched`', () => {
    // ── A diferença medida contra o Yamtrack ────────────────────────────────
    // Lá: `if idMal is None: warning; return` — a obra se perde. Aqui ela entra
    // com um vínculo em vez de dois, e o número diz quantas ainda pedem o
    // outro. É `external_ids` sendo tabela pagando o que o brief prometeu.
    const userId = criarUsuario()

    const outcome = createApplier(userId)(
      obra({ partialIdentity: true }),
      'skip',
    )

    expect(outcome).toEqual({ kind: 'added', unmatched: true })
    expect(biblioteca(userId)).toHaveLength(1)
  })

  it('entra sem vínculo nenhum quando a fonte não trouxe id', () => {
    // O CSV digitado à mão. `partialIdentity` é da FONTE, não uma conta daqui.
    const userId = criarUsuario()

    const outcome = createApplier(userId)(
      obra({ links: [], partialIdentity: true }),
      'skip',
    )

    expect(outcome).toEqual({ kind: 'added', unmatched: true })
    const [criada] = biblioteca(userId)
    expect(vinculosDe(criada?.id ?? 0)).toHaveLength(0)
  })
})

describe('a recusa de item, que NÃO derruba o import', () => {
  it('recusa tipo que esta instalação não tem', () => {
    // Uma instalação que apagou `anime` no wizard não deve ver o import morrer:
    // os mangás entram, e a linha vira problema.
    const userId = criarUsuario()

    const outcome = createApplier(userId)(
      obra({ mediaType: 'light-novel', row: 14 }),
      'skip',
    )

    expect(outcome).toEqual({
      kind: 'problem',
      problem: {
        kind: 'unknown-media-type',
        row: 14,
        params: { value: 'light-novel' },
      },
    })
    expect(biblioteca(userId)).toHaveLength(0)
  })

  it('recusa vínculo para provedor que não existe aqui', () => {
    const userId = criarUsuario()

    const outcome = createApplier(userId)(
      obra({ links: [{ provider: 'simkl', externalId: '9' }] }),
      'skip',
    )

    expect(outcome).toMatchObject({
      kind: 'problem',
      problem: { kind: 'unknown-source', params: { value: 'simkl' } },
    })
  })

  it('deixa a obra entrar quando SÓ ALGUNS vínculos são desconhecidos', () => {
    // Vínculo pra provedor que a instalação não tem cai fora e o item segue —
    // mesma régua dos vínculos entre obras (brief, 3.10): o que não é navegável
    // não entra, mas não leva a obra junto.
    const userId = criarUsuario()

    const outcome = createApplier(userId)(
      obra({
        links: [
          { provider: 'simkl', externalId: '9' },
          { provider: 'anilist', externalId: '154587' },
        ],
      }),
      'skip',
    )

    expect(outcome).toMatchObject({ kind: 'added' })
    const [criada] = biblioteca(userId)
    expect(vinculosDe(criada?.id ?? 0)).toEqual([
      { provider: 'anilist', externalId: '154587' },
    ])
  })
})

describe('a conciliação', () => {
  it('casa por QUALQUER um dos ids que vieram', () => {
    // ── O caso difícil do import, nomeado no brief 3.12 ─────────────────────
    // A obra entrou pela busca do AniList e tem só o id dele. Um import de MAL
    // traz o `idMal`. Se a conciliação casasse por um id só, a segunda entraria
    // duplicada — e o acervo passaria a ter duas Frieren.
    const userId = criarUsuario()
    const aplicar = createApplier(userId)

    aplicar(
      obra({
        links: [
          { provider: 'anilist', externalId: '154587' },
          { provider: 'jikan', externalId: '52991' },
        ],
      }),
      'skip',
    )

    // Agora chega a MESMA obra por outra fonte, que só sabe o id do MAL.
    const outcome = aplicar(
      obra({ links: [{ provider: 'jikan', externalId: '52991' }] }),
      'skip',
    )

    expect(outcome).toEqual({ kind: 'skipped' })
    expect(biblioteca(userId)).toHaveLength(1)
  })

  it('não casa por TÍTULO, e a duplicata é consequência assumida', () => {
    // Heurística por título está descartada no brief 3.10: ela erra e junta
    // duas obras diferentes num acervo que ninguém vai reconferir. O preço é
    // este — sem id, não há identidade, e reimportar duplica.
    const userId = criarUsuario()
    const aplicar = createApplier(userId)

    aplicar(obra({ links: [], partialIdentity: true }), 'skip')
    aplicar(obra({ links: [], partialIdentity: true }), 'skip')

    expect(biblioteca(userId)).toHaveLength(2)
  })

  it('não casa com obra de OUTRA pessoa', () => {
    const dono = criarUsuario('fernando')
    const outra = criarUsuario('outra-pessoa')

    createApplier(dono)(obra(), 'skip')
    const outcome = createApplier(outra)(obra(), 'skip')

    expect(outcome).toMatchObject({ kind: 'added' })
    expect(biblioteca(dono)).toHaveLength(1)
    expect(biblioteca(outra)).toHaveLength(1)
  })
})

describe('a colisão', () => {
  it('`skip` não toca em nada', () => {
    const userId = criarUsuario()
    const aplicar = createApplier(userId)

    aplicar(obra({ progress: 4 }), 'skip')
    const [antes] = biblioteca(userId)

    const outcome = aplicar(obra({ progress: 25, status: 'completed' }), 'skip')

    expect(outcome).toEqual({ kind: 'skipped' })
    const [depois] = biblioteca(userId)
    expect(depois).toMatchObject({ progress: 4, status: 'watching' })
    expect(eventosDe(antes?.id ?? 0)).toHaveLength(1)
  })

  it('`overwrite` substitui o ESTADO, não a obra', () => {
    // ── A leitura que separa o nosso `overwrite` do do Yamtrack ─────────────
    // Lá a linha é apagada e recriada. Aqui progresso, status e total mudam; a
    // nota, as notas, o histórico e os outros vínculos sobrevivem, porque nada
    // disso vem no import e apagar seria perda de dado que ninguém pediu.
    const userId = criarUsuario()
    const aplicar = createApplier(userId)

    aplicar(obra({ progress: 4 }), 'skip')
    const [criada] = biblioteca(userId)
    const idOriginal = criada?.id ?? 0

    // Coisas que o import não traz, escritas por fora como a pessoa faria.
    db.update(entries)
      .set({ rating: 9.5, notes: 'melhor do ano' })
      .where(eq(entries.id, idOriginal))
      .run()

    const outcome = aplicar(
      obra({ progress: 25, status: 'completed' }),
      'overwrite',
    )

    expect(outcome).toEqual({ kind: 'updated' })

    const [depois] = biblioteca(userId)
    expect(depois?.id).toBe(idOriginal) // a MESMA linha, não uma recriada
    expect(depois).toMatchObject({
      progress: 25,
      status: 'completed',
      rating: 9.5,
      notes: 'melhor do ano',
    })
  })

  it('`overwrite` grava o delta no log, e ele pode ser NEGATIVO', () => {
    // Correção é evento novo com delta negativo, nunca UPDATE sem rastro
    // (brief, 3.11). Um import que diz "episódio 3" sobre uma obra em 10 grava
    // -7, e o log continua somando o contador.
    const userId = criarUsuario()
    const aplicar = createApplier(userId)

    aplicar(obra({ progress: 10 }), 'skip')
    aplicar(obra({ progress: 3 }), 'overwrite')

    const [criada] = biblioteca(userId)
    const eventos = eventosDe(criada?.id ?? 0)
    expect(eventos.map((e) => e.delta)).toEqual([10, -7])
    expect(eventos.every((e) => e.origin === 'import')).toBe(true)
  })

  it('`overwrite` ACRESCENTA vínculo novo sem desfazer os que já havia', () => {
    // Vincular a outro provedor foi ato de quem é dono da obra, e um import não
    // desfaz ato de ninguém.
    const userId = criarUsuario()
    const aplicar = createApplier(userId)

    aplicar(
      obra({ links: [{ provider: 'anilist', externalId: '154587' }] }),
      'skip',
    )
    aplicar(
      obra({
        links: [
          { provider: 'anilist', externalId: '154587' },
          { provider: 'jikan', externalId: '52991' },
        ],
      }),
      'overwrite',
    )

    const [criada] = biblioteca(userId)
    expect(vinculosDe(criada?.id ?? 0)).toEqual([
      { provider: 'anilist', externalId: '154587' },
      { provider: 'jikan', externalId: '52991' },
    ])
  })

  it('`overwrite` sem mudança de progresso não inventa evento', () => {
    const userId = criarUsuario()
    const aplicar = createApplier(userId)

    aplicar(obra({ progress: 4 }), 'skip')
    aplicar(obra({ progress: 4, status: 'completed' }), 'overwrite')

    const [criada] = biblioteca(userId)
    expect(eventosDe(criada?.id ?? 0)).toHaveLength(1)
  })
})
