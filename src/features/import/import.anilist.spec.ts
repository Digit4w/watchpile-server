import { describe, expect, it } from 'vitest'
import { anilistSource } from './import.anilist.js'
import type { ImportFailure } from './import.types.js'

/**
 * A fonte do AniList, contra um `fetch` dublê.
 *
 * ── O que estes testes NÃO provam ───────────────────────────────────────────
 * **A forma das respostas aqui não foi medida.** O AniList desativou a própria
 * API em 07/09/2026, e ela veio da documentação deles mais o
 * `integrations/imports/anilist.py` do Yamtrack, que é implementação em
 * produção.
 *
 * Então estes testes provam o MAPEAMENTO contra a forma que eu acredito ser a
 * certa — não contra a que ela é. Quando a API voltar, a verificação é um passo
 * só: rodar `read()` contra um perfil público e conferir contagem, status e
 * progresso, como foi feito com o MyAnimeList. Se a forma for outra, é aqui que
 * se conserta, e estes testes passam a valer.
 */

function dublê(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as typeof fetch
}

const entrada = (over = {}) => ({
  status: 'COMPLETED',
  progress: 12,
  updatedAt: 1_700_000_000,
  media: {
    id: 154587,
    idMal: 52991,
    title: { userPreferred: 'Sousou no Frieren' },
    episodes: 28,
  },
  ...over,
})

const corpo = (
  anime: unknown[] = [],
  manga: unknown[] = [],
  custom: unknown[] = [],
) => ({
  data: {
    anime: {
      lists: [
        { isCustomList: false, entries: anime },
        { isCustomList: true, entries: custom },
      ],
    },
    manga: { lists: [{ isCustomList: false, entries: manga }] },
  },
})

describe('o caso difícil do import', () => {
  it('com `idMal`, a obra entra com DOIS vínculos', async () => {
    // É o que a faz casar com a mesma obra vinda de um import de MyAnimeList,
    // em vez de entrar duplicada.
    const { items } = await anilistSource('f', dublê(corpo([entrada()]))).read()

    expect(items[0]).toMatchObject({
      links: [
        { provider: 'anilist', externalId: '154587' },
        { provider: 'mal', externalId: '52991' },
      ],
      partialIdentity: false,
    })
  })

  it('SEM `idMal`, a obra ENTRA — e é a diferença medida contra o Yamtrack', async () => {
    /**
     * Lá: `if idMal is None: warning; return` — a obra se perde, porque anime e
     * mangá vivem sob fonte única e o id do AniList não tem onde morar. Aqui
     * `external_ids` é tabela, então ela entra com um vínculo e o número diz
     * quantas ainda pedem o outro.
     */
    const { items } = await anilistSource(
      'f',
      dublê(corpo([entrada({ media: { ...entrada().media, idMal: null } })])),
    ).read()

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      links: [{ provider: 'anilist', externalId: '154587' }],
      partialIdentity: true,
    })
  })

  it('`idMal` zero conta como ausente', async () => {
    const { items } = await anilistSource(
      'f',
      dublê(corpo([entrada({ media: { ...entrada().media, idMal: 0 } })])),
    ).read()

    expect(items[0]?.partialIdentity).toBe(true)
  })
})

describe('as listas customizadas', () => {
  it('ficam de fora, porque a obra aparece nas DUAS', async () => {
    // Sem filtrar, a obra numa lista customizada seria processada duas vezes: a
    // conciliação por id evita a duplicata no banco, mas o resultado contaria
    // errado — e contar errado num número que a pessoa lê é pior.
    const { items } = await anilistSource(
      'f',
      dublê(corpo([entrada()], [], [entrada()])),
    ).read()

    expect(items).toHaveLength(1)
  })
})

describe('o mapeamento', () => {
  it('traduz os status, e `REPEATING` é assistindo', async () => {
    const ent = (s: string) => entrada({ status: s })
    const { items } = await anilistSource(
      'f',
      dublê(
        corpo([
          ent('CURRENT'),
          ent('REPEATING'),
          ent('COMPLETED'),
          ent('PAUSED'),
          ent('DROPPED'),
          ent('PLANNING'),
        ]),
      ),
    ).read()

    expect(items.map((i) => i.status)).toEqual([
      'watching',
      'watching',
      'completed',
      'on-hold',
      'dropped',
      'planned',
    ])
  })

  it('lê episódios no anime e capítulos no mangá', async () => {
    const { items } = await anilistSource(
      'f',
      dublê(
        corpo(
          [entrada()],
          [
            entrada({
              media: {
                id: 30002,
                idMal: 2,
                title: { userPreferred: 'Berserk' },
                chapters: null,
              },
            }),
          ],
        ),
      ),
    ).read()

    expect(items).toEqual([
      expect.objectContaining({ mediaType: 'anime', total: 28 }),
      // Mangá em publicação não tem último capítulo: nulo é legítimo.
      expect.objectContaining({ mediaType: 'manga', total: null }),
    ])
  })

  it('`updatedAt` é UNIX em SEGUNDOS', async () => {
    // A mesma armadilha que `yearFormat` resolveu no IGDB: ler o timestamp como
    // outra coisa dá um valor plausível, na coluna certa, sem erro nenhum.
    const { items } = await anilistSource(
      'f',
      dublê(corpo([entrada({ updatedAt: 1_700_000_000 })])),
    ).read()

    expect(items[0]?.occurredAt?.toISOString()).toBe('2023-11-14T22:13:20.000Z')
  })

  it('`updatedAt` zero vira nulo, não 1970', async () => {
    const { items } = await anilistSource(
      'f',
      dublê(corpo([entrada({ updatedAt: 0 })])),
    ).read()

    expect(items[0]?.occurredAt).toBeNull()
  })
})

describe('as falhas, e em GraphQL elas vêm no CORPO', () => {
  const falha = async (body: unknown, status = 200) =>
    anilistSource('f', dublê(body, status))
      .read()
      .then(
        () => null,
        (e: unknown) => e as ImportFailure,
      )

  it('"User not found" com status 200 NÃO vira coleção vazia', async () => {
    /**
     * Conferir só `response.ok` deixaria isto passar como zero obras — e a
     * pessoa veria "0 importadas" achando que a conta dela está vazia, em vez de
     * que digitou o nome errado.
     */
    expect(
      (await falha({ errors: [{ message: 'User not found' }] }))?.kind,
    ).toBe('user-not-found')
  })

  it('"Private User" é perfil privado', async () => {
    expect((await falha({ errors: [{ message: 'Private User' }] }))?.kind).toBe(
      'private-profile',
    )
  })

  it('o 403 de API desativada NÃO é do admin', async () => {
    /**
     * É o estado real do AniList em 07/09/2026. A régua é a do conserto de
     * recusa do mesmo dia: o AniList não pede credencial pra ler perfil público,
     * então não há o que o admin configure — mandá-lo pra Settings seria pedir
     * que arrume o que está certo.
     */
    expect(
      (
        await falha(
          {
            errors: [
              { message: 'The AniList API has been temporarily disabled' },
            ],
          },
          403,
        )
      )?.kind,
    ).toBe('source-down')
  })

  it('rede fora não vira recusa', async () => {
    const impl: typeof fetch = async () => {
      throw new TypeError('fetch failed')
    }
    expect(
      (
        await anilistSource('f', impl)
          .read()
          .then(
            () => null,
            (e: unknown) => e as ImportFailure,
          )
      )?.kind,
    ).toBe('source-down')
  })
})
