import { describe, expect, it } from 'vitest'
import {
  ALL_INTERFACES,
  allowsRemote,
  defaultHost,
  hostFor,
  hostLock,
  LOOPBACK,
  resolveBind,
} from './network.bind.js'

describe('defaultHost', () => {
  it('abre para a rede onde o controle não é oferecido', () => {
    // O padrão do self-hosted, e o que o container precisa: escutar só o
    // loopback lá dentro é ficar inalcançável até para o host.
    expect(defaultHost('off')).toBe(ALL_INTERFACES)
  })

  it('fecha onde o controle É oferecido', () => {
    // Senão o toggle nasce na posição permissiva, e a proteção só existe para
    // quem já sabia que ela existe.
    expect(defaultHost('ui')).toBe(LOOPBACK)
  })
})

describe('resolveBind', () => {
  it('deixa o ambiente vencer o que o admin gravou', () => {
    const bind = resolveBind({
      override: '10.0.0.5',
      stored: ALL_INTERFACES,
      control: 'ui',
    })
    expect(bind).toEqual({ host: '10.0.0.5', source: 'env' })
  })

  it('ignora variável vazia ou só com espaço', () => {
    // `WATCHPILE_HOST=` num compose é a variável existindo sem valor, e tratar
    // isso como escolha prenderia o servidor numa string vazia.
    for (const override of ['', '   ']) {
      expect(resolveBind({ override, stored: null, control: 'off' })).toEqual({
        host: ALL_INTERFACES,
        source: 'default',
      })
    }
  })

  it('usa o que o admin gravou quando não há ambiente', () => {
    const bind = resolveBind({
      override: undefined,
      stored: LOOPBACK,
      control: 'ui',
    })
    expect(bind).toEqual({ host: LOOPBACK, source: 'setting' })
  })

  it('cai no padrão quando não há nem um nem outro', () => {
    expect(
      resolveBind({ override: undefined, stored: null, control: 'ui' }),
    ).toEqual({ host: LOOPBACK, source: 'default' })
  })
})

describe('allowsRemote', () => {
  it('reconhece os endereços que ficam na própria máquina', () => {
    for (const host of [LOOPBACK, '::1', 'localhost']) {
      expect(allowsRemote(host)).toBe(false)
    }
  })

  it('trata todo o resto como alcançável de fora', () => {
    // Errar para o lado de "isto está aberto" é o erro certo num controle que
    // fala de exposição.
    for (const host of [
      ALL_INTERFACES,
      '::',
      '192.168.1.40',
      'watchpile.lan',
    ]) {
      expect(allowsRemote(host)).toBe(true)
    }
  })

  it('casa com o que `hostFor` grava, nos dois sentidos', () => {
    expect(allowsRemote(hostFor(true))).toBe(true)
    expect(allowsRemote(hostFor(false))).toBe(false)
  })
})

describe('hostLock', () => {
  it('recusa onde o controle não é oferecido', () => {
    expect(hostLock('off', 'default')).toBe('not-offered')
    // Vale mesmo com valor gravado: quem não oferece o controle não o oferece
    // por já ter sido usado antes.
    expect(hostLock('off', 'setting')).toBe('not-offered')
  })

  it('recusa quando o ambiente fixou o endereço', () => {
    expect(hostLock('ui', 'env')).toBe('set-by-environment')
  })

  it('libera quando o controle é oferecido e nada o fixou', () => {
    expect(hostLock('ui', 'default')).toBeNull()
    expect(hostLock('ui', 'setting')).toBeNull()
  })
})
