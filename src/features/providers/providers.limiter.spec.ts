import { beforeEach, describe, expect, it } from 'vitest'
import {
  awaitToken,
  configureLimiter,
  reserveToken,
  resetLimiter,
  takeToken,
} from './providers.limiter.js'

/**
 * O limitador, e principalmente a ESPERA que nasceu em 07/09/2026.
 *
 * O que estes testes protegem não é a aritmética do balde — é a diferença entre
 * recusar e enfileirar, que foi o conserto do dia: uma grade de cartas pedindo
 * arte ao mesmo tempo é uma multidão, e sem reserva ela continua sendo uma
 * multidão depois de dormir.
 */

const TETO = { perSecond: 3, burst: 5 }

beforeEach(() => {
  resetLimiter()
})

describe('sem esperar, que é o caminho da busca', () => {
  it('serve a rajada e recusa o resto', () => {
    const t = 1_000
    const servidos = Array.from({ length: 8 }, () =>
      takeToken('p', t, TETO),
    ).filter(Boolean).length

    expect(servidos).toBe(5)
  })

  it('reenche contínuo, não por janela', () => {
    for (let i = 0; i < 5; i += 1) {
      takeToken('p', 1_000, TETO)
    }
    expect(takeToken('p', 1_000, TETO)).toBe(false)

    // Um terço de segundo a 3/s é exatamente uma ficha.
    expect(takeToken('p', 1_334, TETO)).toBe(true)
  })

  it('não deixa o balde encher acima da rajada', () => {
    // Sem o teto, ficar uma hora parado acumularia milhares de fichas e a
    // primeira busca depois disso passaria por cima do provedor.
    configureLimiter('tmdb', { perSecond: 10, burst: 2 })

    expect(takeToken('tmdb', 1_000_000)).toBe(true)
    // Uma hora depois: o balde está cheio, não transbordado.
    expect(takeToken('tmdb', 1_000_000 + 3_600_000)).toBe(true)
    expect(takeToken('tmdb', 1_000_000 + 3_600_000)).toBe(true)
    expect(takeToken('tmdb', 1_000_000 + 3_600_000)).toBe(false)
  })

  it('conta cada provedor separado, porque a cota é de cada um', () => {
    configureLimiter('tmdb', { perSecond: 1, burst: 1 })
    configureLimiter('anilist', { perSecond: 1, burst: 1 })
    const now = 1_000_000

    expect(takeToken('tmdb', now)).toBe(true)
    expect(takeToken('tmdb', now)).toBe(false)
    // Esgotar o TMDB não pode bloquear um provedor que nem foi chamado.
    expect(takeToken('anilist', now)).toBe(true)
  })
})

describe('a reserva, que é o que transforma multidão em fila', () => {
  it('dá a cada um um instante PRÓPRIO, crescendo', () => {
    /**
     * **É o coração do conserto.** Sem reservar, vinte pedidos leriam o mesmo
     * balde vazio, dormiriam o mesmo tanto e acordariam juntos pra brigar pela
     * mesma ficha — um servido, dezenove recusados, de novo. Debitar na hora
     * (as fichas vão a negativo, porque são do futuro) é o que ordena a fila.
     */
    const t = 1_000
    const esperas = Array.from({ length: 8 }, () =>
      reserveToken('p', t, TETO, 10_000),
    )

    expect(esperas.slice(0, 5)).toEqual([0, 0, 0, 0, 0])
    // Do sexto em diante, uma ficha a cada 1/3 de segundo — e cada um o seu.
    expect(esperas.slice(5)).toEqual([1000 / 3, 2000 / 3, 1000])
  })

  it('quem desiste NÃO gasta ficha', () => {
    // Recusar debitando puniria quem nem chegou a ser servido: o pedido
    // seguinte, disposto a esperar, pagaria a fila de quem desistiu.
    for (let i = 0; i < 5; i += 1) {
      reserveToken('p', 1_000, TETO, 0)
    }

    expect(reserveToken('p', 1_000, TETO, 100)).toBeNull()
    expect(reserveToken('p', 1_000, TETO, 500)).toBeCloseTo(1000 / 3, 5)
  })

  it('recusa quando a espera passa do orçamento', () => {
    for (let i = 0; i < 5; i += 1) {
      reserveToken('p', 1_000, TETO, 0)
    }

    // A 3/s, 300ms não alcançam a próxima ficha; 340ms alcançam.
    expect(reserveToken('p', 1_000, TETO, 300)).toBeNull()
    expect(reserveToken('p', 1_000, TETO, 340)).toBeCloseTo(1000 / 3, 5)
  })

  it('provedor sem vazão não tem espera que resolva', () => {
    const parado = { perSecond: 0, burst: 1 }
    reserveToken('p', 1_000, parado, 0)

    expect(reserveToken('p', 1_000, parado, 60_000)).toBeNull()
  })
})

describe('`awaitToken`, que é o que a arte chama', () => {
  it('devolve a ficha depois de esperar por ela', async () => {
    configureLimiter('p', { perSecond: 50, burst: 1 })
    expect(await awaitToken('p', null, 0)).toBe(true)

    const antes = Date.now()
    expect(await awaitToken('p', null, 1_000)).toBe(true)
    // 1/50s = 20ms. O que se afirma é que ESPEROU, não quanto.
    expect(Date.now() - antes).toBeGreaterThanOrEqual(10)
  })

  it('desiste quando a espera não cabe no orçamento', async () => {
    configureLimiter('p', { perSecond: 0.5, burst: 1 })
    expect(await awaitToken('p', null, 0)).toBe(true)

    // A 0,5/s a próxima ficha leva 2s — o AniList é assim, e ali desistir é a
    // resposta honesta.
    expect(await awaitToken('p', null, 500)).toBe(false)
  })

  it('o teto DECLARADO vence o registrado', async () => {
    configureLimiter('p', { perSecond: 0.5, burst: 1 })
    await awaitToken('p', { perSecond: 100, burst: 2 }, 0)

    expect(await awaitToken('p', { perSecond: 100, burst: 2 }, 0)).toBe(true)
  })
})

/**
 * A PRECEDÊNCIA do trabalho de fundo — 13/09/2026.
 *
 * O que estes testes protegem é a diferença entre "há fichas" e "há fichas
 * SOBRANDO": o aquecimento (`art.warm.ts`) roda por minutos e chega sempre
 * primeiro, então sem colchão ele esvazia o balde justo quando alguém abre a
 * grade. Medido antes do conserto: uma grade fria de 20 cartas caía de 7
 * servidas para 2 no AniList.
 */
describe('o trabalho de fundo cede a vez', () => {
  it('deixa um colchão que o primeiro plano encontra cheio', () => {
    // burst 5, metade reservada: o fundo só debita enquanto sobrarem 2,5.
    const teto = { perSecond: 0, burst: 5 }

    // Ele consome até o piso e para — sem reenchimento (`perSecond: 0`), o que
    // isola a regra do colchão da aritmética do tempo.
    let pegas = 0
    for (let i = 0; i < 10; i += 1) {
      if (reserveToken('bg', 0, teto, 0, true) === 0) {
        pegas += 1
      }
    }
    expect(pegas).toBe(2)

    // E o que sobrou continua lá para quem tem alguém esperando.
    expect(reserveToken('bg', 0, teto, 0, false)).toBe(0)
    expect(reserveToken('bg', 0, teto, 0, false)).toBe(0)
  })

  /**
   * A outra metade da precedência, e a que não se vê olhando só o colchão: o
   * primeiro plano **reserva** ficha do futuro, o fundo não. Sem isso, mil obras
   * enfileirariam mil fichas na frente de quem abriu a grade.
   */
  it('não gasta ficha do futuro, enquanto o primeiro plano gasta', () => {
    const teto = { perSecond: 1, burst: 1 }

    // Gasta a única ficha disponível.
    expect(reserveToken('futuro', 0, teto, 0, false)).toBe(0)

    // O primeiro plano aceita esperar e SAI com a ficha debitada (espera > 0).
    expect(reserveToken('futuro', 0, teto, 5000, false)).toBeGreaterThan(0)

    // O de fundo também recebe quanto esperar — mas não debitou, e é isso que
    // deixa a ficha disponível para quem chegar com pressa no meio da espera.
    const antes = reserveToken('futuro', 0, teto, 60_000, true)
    expect(antes).toBeGreaterThan(0)
    const depois = reserveToken('futuro', 0, teto, 60_000, true)
    expect(depois).toBe(antes)
  })

  it('quem tem alguém esperando não paga o colchão', () => {
    const teto = { perSecond: 0, burst: 5 }

    // As cinco saem, porque o piso do primeiro plano é zero.
    for (let i = 0; i < 5; i += 1) {
      expect(reserveToken('fg', 0, teto, 0, false)).toBe(0)
    }
    expect(reserveToken('fg', 0, teto, 0, false)).toBeNull()
  })
})
