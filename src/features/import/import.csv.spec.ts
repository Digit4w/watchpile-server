import { describe, expect, it } from 'vitest'
import { csvSource, parseCsv } from './import.csv.js'
import { ImportFailure } from './import.types.js'

/**
 * O CSV é a única fonte que não depende de rede, então é a única que se prova
 * inteira — sem banco, sem servidor de terceiro, sem chave.
 */

const CABECALHO =
  'media_type,title,status,progress,total,source,external_id,updated_at'

async function ler(...linhas: string[]) {
  return csvSource([CABECALHO, ...linhas].join('\n')).read()
}

describe('o parser', () => {
  it('não quebra em título com vírgula', () => {
    // O motivo de existir um parser em vez de `split(',')`: título com vírgula
    // é a regra, não a exceção.
    expect(parseCsv('a,b\n"Rock, Paper, Scissors",2')).toEqual([
      ['a', 'b'],
      ['Rock, Paper, Scissors', '2'],
    ])
  })

  it('aceita quebra de linha DENTRO das aspas', () => {
    expect(parseCsv('a,b\n"linha 1\nlinha 2",x')).toEqual([
      ['a', 'b'],
      ['linha 1\nlinha 2', 'x'],
    ])
  })

  it('desdobra aspas escapadas', () => {
    expect(parseCsv('a\n"ele disse ""oi"""')).toEqual([
      ['a'],
      ['ele disse "oi"'],
    ])
  })

  it('aceita CRLF e CR solto', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsv('a,b\r1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('come o BOM do Excel', () => {
    // Sem isto o primeiro cabeçalho vira `﻿media_type` e a coluna
    // obrigatória "some" — o arquivo inteiro seria recusado por um caractere
    // invisível.
    expect(parseCsv('﻿media_type,title')).toEqual([['media_type', 'title']])
  })

  it('não inventa uma linha vazia no fim', () => {
    expect(parseCsv('a,b\n1,2\n')).toHaveLength(2)
  })
})

describe('o arquivo inteiro cai quando não é o nosso', () => {
  it('sem cabeçalho', async () => {
    await expect(csvSource('').read()).rejects.toBeInstanceOf(ImportFailure)
  })

  it('faltando coluna obrigatória, e diz qual', async () => {
    // Falha do JOB, não problema de linha: não há uma linha ruim, há um arquivo
    // que não é o nosso. O alcance do sinal é o alcance real do fato.
    await expect(
      csvSource('media_type,title\nanime,Frieren').read(),
    ).rejects.toMatchObject({
      kind: 'invalid-file',
      params: { missing: 'status' },
    })
  })
})

describe('a linha', () => {
  it('lê a obra completa', async () => {
    const { items, problems } = await ler(
      'anime,Frieren,watching,4,28,anilist,154587,2019-04-07',
    )

    expect(problems).toEqual([])
    expect(items[0]).toMatchObject({
      mediaType: 'anime',
      title: 'Frieren',
      status: 'watching',
      progress: 4,
      total: 28,
      links: [{ provider: 'anilist', externalId: '154587' }],
      partialIdentity: false,
      row: 2,
    })
    expect(items[0]?.occurredAt?.toISOString()).toBe(
      new Date('2019-04-07').toISOString(),
    )
  })

  it('vazio em `progress` é 0, e vazio em `total` é desconhecido', async () => {
    // Os dois vazios significam coisas diferentes: não registrar progresso é
    // começar do zero; não saber o total é legítimo — mangá em publicação não
    // tem último capítulo (brief, 3.12).
    const { items } = await ler('manga,Berserk,on-hold,,,,,')
    expect(items[0]).toMatchObject({ progress: 0, total: null })
  })

  it('aceita o status em qualquer caixa, e com espaço no lugar do hífen', async () => {
    const { items } = await ler(
      'anime,A,Watching,,,,,',
      'anime,B,On Hold,,,,,',
      'anime,C,COMPLETED,,,,,',
    )
    expect(items.map((i) => i.status)).toEqual([
      'watching',
      'on-hold',
      'completed',
    ])
  })

  it('recusa status que não é um dos cinco, com o valor e a LINHA', async () => {
    const { items, problems } = await ler(
      'anime,A,watching,,,,,',
      'anime,B,Rewatching,,,,,',
    )

    expect(items).toHaveLength(1)
    expect(problems).toEqual([
      { kind: 'invalid-status', row: 3, params: { value: 'Rewatching' } },
    ])
  })

  it('recusa número que não é número, dizendo qual campo', async () => {
    const { problems } = await ler(
      'anime,A,watching,twelve,,,,',
      'anime,B,watching,,muitos,,,',
    )

    expect(problems).toEqual([
      {
        kind: 'invalid-number',
        row: 2,
        params: { field: 'progress', value: 'twelve' },
      },
      {
        kind: 'invalid-number',
        row: 3,
        params: { field: 'total', value: 'muitos' },
      },
    ])
  })

  it('recusa linha sem título ou sem tipo', async () => {
    const { problems } = await ler(
      ',Frieren,watching,,,,,',
      'anime,,watching,,,,,',
    )
    expect(problems).toEqual([
      { kind: 'missing-identity', row: 2 },
      { kind: 'missing-identity', row: 3 },
    ])
  })

  it('a linha ruim não derruba as boas', async () => {
    // A régua da recusa: o alcance do sinal é o alcance real do fato. Uma linha
    // ilegível é problema DELA.
    const { items, problems } = await ler(
      'anime,A,watching,,,,,',
      'anime,B,Rewatching,,,,,',
      'anime,C,completed,,,,,',
    )
    expect(items.map((i) => i.title)).toEqual(['A', 'C'])
    expect(problems).toHaveLength(1)
  })
})

describe('a identidade', () => {
  it('sem id, a obra entra com `partialIdentity`', async () => {
    const { items } = await ler('anime,Digitada à mão,planned,,,,,')
    expect(items[0]).toMatchObject({ links: [], partialIdentity: true })
  })

  it('par incompleto vale como ausente, e não vira problema', async () => {
    // `source` sem `external_id` não é linha ruim: a obra é importável, e o
    // resultado já diz o que houve em "came in without a match".
    const { items, problems } = await ler(
      'anime,Só a fonte,planned,,,anilist,,',
      'anime,Só o id,planned,,,,154587,',
    )
    expect(problems).toEqual([])
    expect(items.every((i) => i.links.length === 0 && i.partialIdentity)).toBe(
      true,
    )
  })

  it('com o par completo, NÃO é identidade parcial', async () => {
    // A régua que separa o CSV do AniList: aqui um vínculo já é completo, lá
    // completo são dois. É por isso que `partialIdentity` é declaração da FONTE.
    const { items } = await ler('anime,Frieren,watching,4,28,anilist,154587,')
    expect(items[0]?.partialIdentity).toBe(false)
  })
})

describe('o formato aguenta arquivo de gente de verdade', () => {
  it('ignora coluna desconhecida e ordem trocada', async () => {
    // Acrescentar nota e notas depois não pode quebrar arquivo já escrito.
    const texto = [
      'title,status,media_type,nota_futura',
      'Frieren,watching,anime,9.5',
    ].join('\n')

    const { items, problems } = await csvSource(texto).read()
    expect(problems).toEqual([])
    expect(items[0]).toMatchObject({ title: 'Frieren', mediaType: 'anime' })
  })

  it('pula linha em branco no meio', async () => {
    const { items, problems } = await ler(
      'anime,A,watching,,,,,',
      '',
      'anime,B,watching,,,,,',
    )
    expect(items).toHaveLength(2)
    expect(problems).toEqual([])
  })

  it('data ilegível vira nulo, não derruba a linha', async () => {
    // O evento passa a ser de agora. Perder a data retroativa é menos grave que
    // perder a obra.
    const { items, problems } = await ler(
      'anime,A,watching,3,,,,ontem de manhã',
    )
    expect(problems).toEqual([])
    expect(items[0]?.occurredAt).toBeNull()
  })

  it('título com vírgula, japonês e 90 caracteres atravessam inteiros', async () => {
    const longo =
      'The Disastrous Life of Saiki K. Reawakened: Season II, Part 3 — Extra Long Edition'
    const { items } = await csvSource(
      [
        CABECALHO,
        `anime,"${longo}",watching,,,,,`,
        'anime,転生したらスライムだった件,completed,24,24,,,',
      ].join('\n'),
    ).read()

    expect(items[0]?.title).toBe(longo)
    expect(items[1]?.title).toBe('転生したらスライムだった件')
  })
})
