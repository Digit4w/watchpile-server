import { describe, expect, it } from 'vitest'
import { pathWithId, readPath } from './providers.client.js'

/**
 * `{id}` num caminho de endpoint. O id vem de TERCEIRO, então a regra aqui não
 * é de formatação — é de contenção, e é a mesma do nome de arquivo do cache de
 * arte (hash, não id saneado).
 */
describe('pathWithId', () => {
  it('escapa o segmento, como sempre fez', () => {
    expect(pathWithId('/movie/{id}', '550')).toBe('/movie/550')
    expect(pathWithId('/movie/{id}', 'a b')).toBe('/movie/a%20b')
  })

  it('PRESERVA a barra, porque o id do Open Library já é um caminho', () => {
    // `encodeURIComponent` inteiro daria `%2Fworks%2FOL59800W`, e o provedor
    // responderia 404 pra uma obra que existe. Foi o segundo provedor que
    // descobriu isto — com um só, a regra parecia certa.
    expect(pathWithId('{id}.json', '/works/OL59800W')).toBe(
      '/works/OL59800W.json',
    )
  })

  it('recusa travessia, e recusar é a única saída', () => {
    // `..` não tem caractere nenhum pra escapar, então nenhum encode o
    // neutraliza: ou se rejeita o segmento, ou se aceita sair do endpoint.
    expect(pathWithId('{id}.json', '/works/../../admin')).toBeNull()
    expect(pathWithId('/movie/{id}', '..')).toBeNull()
    expect(pathWithId('/movie/{id}', '.')).toBeNull()
  })

  it('deixa passar um ponto que não é segmento inteiro', () => {
    // `2001.a.space.odyssey` é um id legítimo; a regra é sobre o SEGMENTO ser
    // `.` ou `..`, não sobre o caractere aparecer.
    expect(pathWithId('/x/{id}', '2001.a.odyssey')).toBe('/x/2001.a.odyssey')
  })
})

describe('readPath com caminhos alternativos', () => {
  it('para no primeiro caminho que dá valor VIÁVEL', () => {
    const old = { description: 'um texto' }
    const newer = { description: { type: '/type/text', value: 'outro texto' } }

    // A mesma declaração lê as duas formas do mesmo provedor.
    const path = ['description', 'description.value']
    expect(readPath(old, path)).toBe('um texto')
    expect(readPath(newer, path)).toBe('outro texto')
  })

  it('objeto NÃO é valor viável, e é isso que faz a alternativa funcionar', () => {
    // Se a regra fosse "não nulo", `{type, value}` pararia a busca no primeiro
    // caminho e a segunda alternativa nunca seria tentada.
    expect(readPath({ a: { b: 1 } }, ['a', 'a.b'])).toBe(1)
  })

  it('array É viável — `unitGroups.path` aponta pra um', () => {
    expect(readPath({ seasons: [1, 2] }, ['seasons', 'outro'])).toEqual([1, 2])
  })

  it('nenhum caminho serve: indefinido, como um caminho só que não existe', () => {
    expect(readPath({ a: 1 }, ['x', 'y'])).toBeUndefined()
  })

  it('string continua sendo a forma comum e não mudou', () => {
    expect(readPath({ a: { b: 'v' } }, 'a.b')).toBe('v')
  })
})
