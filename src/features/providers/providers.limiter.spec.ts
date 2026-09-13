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
  /**
   * A regra que ficou: o de fundo para antes de esvaziar o balde, e o que
   * sobra é o que a tela encontra pronto ao abrir uma grade fria.
   *
   * O teste deriva o colchão do BURST em vez de cravar um número — o valor da
   * reserva foi recalibrado em 13/09/2026 (0,5 → 0,2) depois de medir o custo
   * dele, e um teste contra o número antigo teria quebrado sem que a regra
   * tivesse mudado.
   */
  it('deixa um colchão que o primeiro plano encontra cheio', () => {
    // `perSecond: 0` isola a regra do colchão da aritmética do tempo.
    const teto = { perSecond: 0, burst: 10 }

    let doFundo = 0
    for (let i = 0; i < 20; i += 1) {
      if (reserveToken('bg', 0, teto, 0, true) === 0) {
        doFundo += 1
      }
    }

    // Ele para antes do fim, e o que sobra não é zero.
    expect(doFundo).toBeGreaterThan(0)
    expect(doFundo).toBeLessThan(teto.burst)

    // E o que sobrou é servido a quem tem alguém esperando.
    const sobra = teto.burst - doFundo
    for (let i = 0; i < sobra; i += 1) {
      expect(reserveToken('bg', 0, teto, 0, false)).toBe(0)
    }
    expect(reserveToken('bg', 0, teto, 0, false)).toBeNull()
  })

  /**
   * **O de fundo DEBITA**, e isso é o que mantém o teto do provedor de pé.
   *
   * A versão anterior o fazia dormir sem debitar e tentar de novo; o laço de
   * retry saiu em 13/09/2026, e sem o débito ele passaria a pedir sem limite
   * nenhum — que é o defeito oposto ao que o colchão veio evitar.
   */
  it('gasta a ficha que pegou, como todo mundo', () => {
    const teto = { perSecond: 0, burst: 10 }

    /**
     * **O teste conta o TOTAL que o balde entrega**, e é isso que distingue as
     * duas implementações: se o de fundo não debitasse, o balde entregaria as
     * fichas dele *além* das dez — e a primeira versão deste teste passava nos
     * dois casos porque só olhava o resto, que continua menor que o burst de um
     * jeito ou de outro.
     */
    let doFundo = 0
    while (reserveToken('debita', 0, teto, 0, true) === 0) {
      doFundo += 1
      if (doFundo > 50)
        throw new Error('o de fundo não debita: balde sem fundo')
    }

    let doPrimeiroPlano = 0
    while (reserveToken('debita', 0, teto, 0, false) === 0) {
      doPrimeiroPlano += 1
      if (doPrimeiroPlano > 50) throw new Error('balde sem fundo')
    }

    // As duas metades somam o burst, nem uma ficha a mais.
    expect(doFundo + doPrimeiroPlano).toBe(teto.burst)
    expect(doFundo).toBeGreaterThan(0)
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
