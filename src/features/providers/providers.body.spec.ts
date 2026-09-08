import { describe, expect, it } from 'vitest'
import { optionVars, renderBody } from './providers.body.js'

/** A consulta do AniList, encurtada — o que importa é ter `{id}` literal dentro. */
const QUERY = 'query ($id: Int) { Media(id: $id) { id title { romaji } } }'

describe('o dialeto JSON', () => {
  it('substitui o marcador que ocupa a FOLHA inteira', () => {
    const { text, contentType } = renderBody(
      { kind: 'json', value: { query: QUERY, variables: { s: '{term}' } } },
      { term: 'frieren' },
    )

    expect(contentType).toBe('application/json')
    expect(JSON.parse(text)).toEqual({
      query: QUERY,
      variables: { s: 'frieren' },
    })
  })

  it('NÃO toca no `{id}` que é sintaxe do GraphQL', () => {
    /**
     * O teste que justifica a regra da folha inteira. `{ id }` sem espaços é
     * seleção de campo válida, e uma substituição por texto trocaria a seleção
     * pelo id da obra — produzindo consulta inválida, ou pior, uma consulta
     * válida pedindo outra coisa.
     */
    const withSelection = 'query { Media(id: 1) {id} }'
    const { text } = renderBody(
      {
        kind: 'json',
        value: { query: withSelection, variables: { i: '{id}' } },
      },
      { id: '154587' },
    )

    const body = JSON.parse(text) as { query: string; variables: unknown }
    expect(body.query).toBe(withSelection)
    expect(body.variables).toEqual({ i: '154587' })
  })

  it('deixa o escape com o serializador, e por isso aspas passam inteiras', () => {
    const { text } = renderBody(
      { kind: 'json', value: { variables: { s: '{term}' } } },
      { term: 'a "obra" \\ com\nquebra' },
    )

    // O que se afirma é o valor DEPOIS de reparsear: o corpo é JSON válido
    // mesmo com aspas, barra e quebra de linha no termo.
    expect(JSON.parse(text)).toEqual({
      variables: { s: 'a "obra" \\ com\nquebra' },
    })
  })

  it('atravessa array e aninhamento', () => {
    const { text } = renderBody(
      { kind: 'json', value: { a: [{ b: '{term}' }, 1, null] } },
      { term: 'x' },
    )
    expect(JSON.parse(text)).toEqual({ a: [{ b: 'x' }, 1, null] })
  })

  it('marcador sem valor vira string vazia, nunca viaja literal', () => {
    const { text } = renderBody(
      { kind: 'json', value: { s: '{option:nsfw}' } },
      {},
    )
    expect(JSON.parse(text)).toEqual({ s: '' })
  })

  it('texto que só PARECE marcador fica como está', () => {
    const { text } = renderBody(
      { kind: 'json', value: { s: 'antes {term} depois', t: '{outro}' } },
      { term: 'x' },
    )
    expect(JSON.parse(text)).toEqual({
      s: 'antes {term} depois',
      t: '{outro}',
    })
  })
})

describe('o dialeto apicalypse', () => {
  it('interpola no texto e escapa o que quebraria as aspas', () => {
    const { text, contentType } = renderBody(
      {
        kind: 'apicalypse',
        template: 'fields name; search "{term}"; limit 10;',
      },
      { term: 'a "obra"' },
    )

    expect(contentType).toBe('text/plain')
    expect(text).toBe('fields name; search "a \\"obra\\""; limit 10;')
  })

  it('escapa a barra ANTES da aspa, senão ela escaparia a aspa nova', () => {
    const { text } = renderBody(
      { kind: 'apicalypse', template: 'search "{term}";' },
      { term: 'a\\b' },
    )
    expect(text).toBe('search "a\\\\b";')
  })

  it('quebra de linha vira espaço — o parser dele recusa a literal', () => {
    const { text } = renderBody(
      { kind: 'apicalypse', template: 'search "{term}";' },
      { term: 'linha um\nlinha dois' },
    )
    expect(text).toBe('search "linha um linha dois";')
  })

  it('recusa id que não é TOKEN, porque solto na sintaxe ele É a sintaxe', () => {
    /**
     * O escape de aspas não alcança um valor sem aspas em volta: `1 | id = 2`
     * não tem aspa nenhuma pra escapar e mesmo assim reescreve a consulta. O id
     * vem da URL, então é dado de terceiro — a mesma classe do `..` que
     * `pathWithId` recusa num caminho.
     */
    const { text } = renderBody(
      { kind: 'apicalypse', template: 'where id = {id};' },
      { id: '1 | id = 2' },
    )
    expect(text).toBe('where id = ;')
  })

  it('id legítimo passa inteiro', () => {
    const { text } = renderBody(
      { kind: 'apicalypse', template: 'where id = {id};' },
      { id: '1942' },
    )
    expect(text).toBe('where id = 1942;')
  })

  it('o TERMO continua aceitando prosa, porque ele mora entre aspas', () => {
    // A distinção que a função faz: o mesmo caractere é dado num lugar e
    // sintaxe no outro.
    const { text } = renderBody(
      { kind: 'apicalypse', template: 'search "{term}";' },
      { term: 'Rock & Roll Racing | Deluxe' },
    )
    expect(text).toBe('search "Rock & Roll Racing | Deluxe";')
  })

  it('resolve `{id}` e opção pelo mesmo caminho', () => {
    const { text } = renderBody(
      {
        kind: 'apicalypse',
        template: 'where id = {id} & nsfw = {option:nsfw};',
      },
      { id: '1942', 'option:nsfw': 'false' },
    )
    expect(text).toBe('where id = 1942 & nsfw = false;')
  })
})

describe('as opções viradas marcador', () => {
  it('prefixa com `option:` pra não colidir com `term`', () => {
    // Uma opção chamada `term` é nome legítimo, e sem o prefixo ela sequestraria
    // o marcador do termo de busca.
    expect(optionVars({ nsfw: false, term: 'x' })).toEqual({
      'option:nsfw': 'false',
      'option:term': 'x',
    })
  })
})
