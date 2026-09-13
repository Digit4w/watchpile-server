import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { externalIds } from '../../db/schema/external-ids.js'
import { users } from '../../db/schema/users.js'
import { propagateTotal } from './titles.propagate.js'

/**
 * A travessia entre o snapshot (da INSTALAÇÃO) e `entries.total` (do USUÁRIO).
 *
 * Estes testes são de guarda, não de aritmética: o que eles protegem é a
 * decisão do dono de 13/09/2026 — **o total só cresce**. Encolher apagaria a
 * correção manual de quem arrumou um total errado, e poria obras em `340 / 12`,
 * porque o contador da tela lê exatamente esse par.
 *
 * O caminho com banco é exercido por `titles.test.ts`; aqui ficam as recusas
 * que não precisam de linha nenhuma para serem verdade.
 */
const CHAVE = { provider: 'mal', externalId: '21', mediaType: 'manga' }

describe('propagateTotal', () => {
  it('não escreve quando o provedor não sabe o total', () => {
    expect(propagateTotal(CHAVE, null)).toBe(0)
  })

  /**
   * Zero é o "desconhecido" de alguns provedores — medido no MyAnimeList, onde
   * uma obra em publicação devolve `num_chapters: 0`. Tratá-lo como total
   * zeraria o denominador de toda obra em curso.
   */
  it('trata zero como desconhecido, nunca como total', () => {
    expect(propagateTotal(CHAVE, 0)).toBe(0)
  })

  it('recusa total negativo', () => {
    expect(propagateTotal(CHAVE, -5)).toBe(0)
  })
})

/**
 * A REGRA, contra o banco de verdade.
 *
 * As duas direções no mesmo arquivo é o que a prova: um teste que só olhasse o
 * crescimento passaria igual numa implementação que sobrescreve sempre — e
 * sobrescrever sempre é exatamente a opção que o dono recusou.
 */
describe('propagateTotal, contra o banco', () => {
  function obraComVinculo(total: number | null, mediaType = 'manga'): number {
    const [user] = db
      .insert(users)
      .values({ username: `u${Math.random()}`, passwordHash: 'x' })
      .returning({ id: users.id })
      .all()

    const [entry] = db
      .insert(entries)
      .values({
        userId: user?.id ?? 0,
        mediaType,
        title: 'Uma obra',
        total,
      })
      .returning({ id: entries.id })
      .all()

    db.insert(externalIds)
      .values({
        entryId: entry?.id ?? 0,
        provider: 'mal',
        externalId: '21',
        mediaType,
      })
      .run()

    return entry?.id ?? 0
  }

  const totalDe = (id: number) =>
    db
      .select({ total: entries.total })
      .from(entries)
      .where(eq(entries.id, id))
      .get()?.total

  beforeEach(() => {
    db.delete(externalIds).run()
    db.delete(entries).run()
    db.delete(users).run()
  })

  it('sobe o total quando o provedor sabe mais', () => {
    const id = obraComVinculo(24)

    expect(propagateTotal(CHAVE, 30)).toBe(1)
    expect(totalDe(id)).toBe(30)
  })

  /** A metade que distingue esta implementação de "sobrescreve sempre". */
  it('NÃO encolhe o total quando o provedor sabe menos', () => {
    const id = obraComVinculo(340)

    expect(propagateTotal(CHAVE, 12)).toBe(0)
    expect(totalDe(id)).toBe(340)
  })

  it('preenche o total que ainda não existia', () => {
    const id = obraComVinculo(null)

    expect(propagateTotal(CHAVE, 12)).toBe(1)
    expect(totalDe(id)).toBe(12)
  })

  it('não reescreve quando o número é o mesmo', () => {
    const id = obraComVinculo(24)

    expect(propagateTotal(CHAVE, 24)).toBe(0)
    expect(totalDe(id)).toBe(24)
  })

  /**
   * O id de um provedor é único DENTRO do tipo (07/09/2026). Uma obra que
   * trocou de tipo depois de vinculada não pode receber o total do outro — seria
   * plausível e errado.
   */
  it('não alcança obra cujo tipo não é o da chave', () => {
    const id = obraComVinculo(24, 'anime')

    expect(propagateTotal(CHAVE, 99)).toBe(0)
    expect(totalDe(id)).toBe(24)
  })
})
