/**
 * Popula o banco com obras e pilhas de mentira, para ter o que olhar enquanto
 * as telas são construídas — o provedor de metadados (brief, 3.10) ainda não
 * existe, então não há como trazer catálogo de verdade.
 *
 * NÃO é migration nem fixture de teste. É ferramenta de desenvolvimento: roda
 * à mão, escreve no banco apontado por `WATCHPILE_DB_PATH`, e se recusa a
 * rodar em produção. Os testes têm o próprio banco em memória e não passam
 * por aqui.
 *
 *   bun run db:seed              # não faz nada se já houver obra
 *   bun run db:seed --reset      # apaga as obras e pilhas do usuário antes
 *   bun run db:seed --home       # TAMBÉM refaz a home: um widget de cada tipo
 *
 * `--home` é separado porque APAGA o layout que o usuário arrumou na tela, e
 * isso não é efeito colateral aceitável de "quero ver umas obras". Serve pra
 * quando a home está com um tipo só de widget e você quer ver os outros sem
 * trocar cada um na mão.
 *
 * As obras são títulos reais de propósito: nome inventado não mostra o que
 * acontece com título longo, com "?" de total desconhecido, nem com a mistura
 * dos seis tipos de mídia na mesma grade.
 */
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client.js'
import { entries } from '../src/db/schema/entries.js'
import { homeWidgets } from '../src/db/schema/home-widgets.js'
import { pileEntries } from '../src/db/schema/pile-entries.js'
import { piles } from '../src/db/schema/piles.js'
import { users } from '../src/db/schema/users.js'
import { widgetPiles } from '../src/db/schema/widget-piles.js'
import { env } from '../src/env.js'

type SeedEntry = {
  mediaType: 'movie' | 'tv' | 'anime' | 'manga' | 'game' | 'book'
  title: string
  status: 'watching' | 'completed' | 'dropped' | 'planned' | 'on-hold'
  rating: number | null
  progress: number
  /** `null` é obra em publicação — o "12 / ?" que a UI precisa aguentar. */
  total: number | null
  piles: string[]
}

type SeedPile = {
  name: string
  /** `null` é pilha sem descrição — a lista precisa aguentar a coluna vazia. */
  description: string | null
}

/**
 * As três primeiras carregam obra; as três últimas existem pelos casos que
 * quebram `/piles` e que nenhuma pilha "normal" produz: pilha VAZIA (que só
 * tem o ladrilho neutro), pilha de UMA obra (que não faz mosaico 2×2 e cai no
 * terceiro nível de identidade), e nome longo demais somado a nome que não é
 * latino.
 */
const PILES: SeedPile[] = [
  { name: 'Watching now', description: 'The three or four I keep up with.' },
  { name: 'Weekend queue', description: null },
  {
    name: 'Finished this year',
    description: 'Everything I got to the end of in 2026.',
  },
  { name: 'Empty pile', description: null },
  { name: 'ベルセルク reread', description: 'One volume a week.' },
  {
    name: 'Backlog: the pile of shame I will absolutely get to before the heat death of the universe',
    description:
      'A name long enough to prove the tile truncates instead of pushing the grid around.',
  },
]

const ENTRIES: SeedEntry[] = [
  // Em andamento, com denominador conhecido
  {
    mediaType: 'anime',
    title: 'Frieren: Beyond Journey’s End',
    status: 'watching',
    rating: 9.1,
    progress: 17,
    total: 28,
    piles: ['Watching now'],
  },
  {
    mediaType: 'tv',
    title: 'Severance',
    status: 'watching',
    rating: 8.7,
    progress: 4,
    total: 10,
    piles: ['Watching now'],
  },
  {
    mediaType: 'anime',
    title: 'The Apothecary Diaries',
    status: 'watching',
    rating: 8.4,
    progress: 5,
    total: 24,
    piles: ['Watching now'],
  },
  {
    mediaType: 'tv',
    title: 'Shogun',
    status: 'watching',
    rating: 8.9,
    progress: 6,
    total: 10,
    piles: ['Watching now'],
  },

  // Em publicação: total desconhecido, o caso "12 / ?"
  {
    mediaType: 'manga',
    title: 'One Piece',
    status: 'watching',
    rating: 9.3,
    progress: 1094,
    total: null,
    piles: ['Watching now'],
  },
  {
    mediaType: 'manga',
    title: 'Vinland Saga',
    status: 'on-hold',
    rating: 9.0,
    progress: 187,
    total: null,
    piles: [],
  },
  {
    mediaType: 'manga',
    title: 'Berserk',
    status: 'on-hold',
    rating: 9.4,
    progress: 364,
    total: null,
    piles: ['ベルセルク reread'],
  },

  // Título longo de propósito — é o que quebra layout dimensionado no olho
  {
    mediaType: 'game',
    title: 'The Legend of Zelda: Tears of the Kingdom',
    status: 'watching',
    rating: 9.2,
    progress: 61,
    total: 152,
    piles: ['Watching now'],
  },
  {
    mediaType: 'movie',
    title: 'Everything Everywhere All at Once',
    status: 'completed',
    rating: 8.8,
    progress: 1,
    total: 1,
    piles: ['Finished this year'],
  },

  // Fila: progresso zerado
  {
    mediaType: 'movie',
    title: 'Dune: Part Two',
    status: 'planned',
    rating: null,
    progress: 0,
    total: 1,
    piles: ['Weekend queue'],
  },
  {
    mediaType: 'movie',
    title: 'Poor Things',
    status: 'planned',
    rating: null,
    progress: 0,
    total: 1,
    piles: ['Weekend queue'],
  },
  {
    mediaType: 'game',
    title: 'Baldur’s Gate 3',
    status: 'planned',
    rating: null,
    progress: 0,
    total: 3,
    piles: ['Weekend queue'],
  },
  {
    mediaType: 'book',
    title: 'Piranesi',
    status: 'planned',
    rating: null,
    progress: 0,
    total: 245,
    piles: [
      'Weekend queue',
      'Backlog: the pile of shame I will absolutely get to before the heat death of the universe',
    ],
  },
  {
    mediaType: 'tv',
    title: 'The Bear',
    status: 'planned',
    rating: null,
    progress: 0,
    total: 10,
    piles: ['Weekend queue'],
  },

  // Terminadas
  {
    mediaType: 'anime',
    title: 'Cyberpunk: Edgerunners',
    status: 'completed',
    rating: 8.6,
    progress: 10,
    total: 10,
    piles: ['Finished this year'],
  },
  {
    mediaType: 'book',
    title: 'The Left Hand of Darkness',
    status: 'completed',
    rating: 8.5,
    progress: 304,
    total: 304,
    piles: [
      'Finished this year',
      'Backlog: the pile of shame I will absolutely get to before the heat death of the universe',
    ],
  },
  {
    mediaType: 'game',
    title: 'Outer Wilds',
    status: 'completed',
    rating: 9.5,
    progress: 1,
    total: 1,
    piles: [
      'Finished this year',
      'Backlog: the pile of shame I will absolutely get to before the heat death of the universe',
    ],
  },
  {
    mediaType: 'movie',
    title: 'Past Lives',
    status: 'completed',
    rating: 8.2,
    progress: 1,
    total: 1,
    piles: ['Finished this year'],
  },

  // Abandonada — o status que quase nunca é testado
  {
    mediaType: 'tv',
    title: 'Westworld',
    status: 'dropped',
    rating: 6.4,
    progress: 22,
    total: 36,
    piles: [
      'Backlog: the pile of shame I will absolutely get to before the heat death of the universe',
    ],
  },
]

/**
 * Uma home de demonstração: um widget de cada tipo que renderiza conteúdo.
 *
 * As alturas saem da escada de encaixe do cliente (`domain/home-metrics.ts`,
 * 29/08/2026) — lista anda de 1 em 1, grade para em 4/7/10, e `scroll` é uma
 * fileira só. Escrever `h` fora dela aqui não quebraria nada (o cliente
 * arredonda na montagem), mas deixaria o seed ensinando o número errado.
 */
const WIDGETS = [
  // fileira de cima: lista larga à esquerda, rolagem à direita
  { type: 'list' as const, x: 0, y: 0, w: 5, h: 5, pile: 'Watching now' },
  { type: 'scroll' as const, x: 5, y: 0, w: 7, h: 4, pile: null },
  // fileira de baixo: a grade, com duas fileiras de cartas
  { type: 'grid' as const, x: 0, y: 5, w: 12, h: 7, pile: null },
]

/** Índice fracionário, como o resto do projeto (brief, 3.14): posição é
 * `1, 2, 3…` no seed porque não há reordenação aqui, mas o tipo é `real` e
 * inserir no meio depois continua sendo uma média entre dois vizinhos. */
const positionOf = (index: number) => index + 1

async function main() {
  if (env.NODE_ENV === 'production') {
    console.error('Refusing to seed a production database.')
    process.exit(1)
  }

  const reset = process.argv.includes('--reset')
  const rebuildHome = process.argv.includes('--home')

  const [user] = await db.select().from(users).orderBy(users.id).limit(1)
  if (!user) {
    console.error(
      'No user yet. Finish the first-run wizard in the UI, then seed.',
    )
    process.exit(1)
  }

  if (reset) {
    // `pile_entries` sai por cascade dos dois lados; apagar as duas pontas
    // basta.
    await db.delete(entries).where(eq(entries.userId, user.id))
    await db.delete(piles).where(eq(piles.userId, user.id))
    console.log(`Cleared existing entries and piles for ${user.username}.`)
  }

  await seedLibrary(user.id, user.username)

  if (rebuildHome) {
    await seedHome(user.id)
  }
}

/** As obras e as pilhas. Não faz nada se já houver obra — semear duas vezes
 * daria uma biblioteca com tudo duplicado. */
async function seedLibrary(userId: number, username: string) {
  const existing = await db
    .select({ id: entries.id })
    .from(entries)
    .where(eq(entries.userId, userId))
    .limit(1)

  if (existing.length > 0) {
    console.log('Database already has entries — skipping. Use --reset.')
    return
  }

  const createdPiles = await db
    .insert(piles)
    .values(
      PILES.map(({ name, description }) => ({ userId, name, description })),
    )
    .returning({ id: piles.id, name: piles.name })

  const pileIdByName = new Map(createdPiles.map((p) => [p.name, p.id]))

  const createdEntries = await db
    .insert(entries)
    .values(
      ENTRIES.map(({ piles: _piles, ...entry }) => ({ ...entry, userId })),
    )
    .returning({ id: entries.id, title: entries.title })

  const entryIdByTitle = new Map(createdEntries.map((e) => [e.title, e.id]))

  const links = PILES.flatMap(({ name: pileName }) => {
    const pileId = pileIdByName.get(pileName)
    if (pileId === undefined) {
      return []
    }
    return ENTRIES.filter((entry) => entry.piles.includes(pileName)).map(
      (entry, index) => ({
        pileId,
        entryId: entryIdByTitle.get(entry.title) as number,
        position: positionOf(index),
      }),
    )
  })

  if (links.length > 0) {
    await db.insert(pileEntries).values(links)
  }

  console.log(
    `Seeded ${createdEntries.length} entries and ${createdPiles.length} piles ` +
      `for ${username} (${links.length} pile links).`,
  )
}

/**
 * A home de demonstração. Lê as pilhas do BANCO em vez de reusar as que
 * acabaram de ser criadas: `--home` também roda sozinho, num banco que já
 * tinha biblioteca, e nesse caso nada foi criado nesta execução.
 */
async function seedHome(userId: number) {
  const existingPiles = await db
    .select({ id: piles.id, name: piles.name })
    .from(piles)
    .where(eq(piles.userId, userId))

  const pileIdByName = new Map(existingPiles.map((p) => [p.name, p.id]))

  // `widget_piles` sai por cascade junto com o widget.
  const removed = await db
    .delete(homeWidgets)
    .where(eq(homeWidgets.userId, userId))
    .returning({ id: homeWidgets.id })

  const createdWidgets = await db
    .insert(homeWidgets)
    .values(
      WIDGETS.map(({ pile: _pile, ...widget }) => ({ ...widget, userId })),
    )
    .returning({ id: homeWidgets.id })

  const sources = WIDGETS.flatMap((widget, index) => {
    const pileId = widget.pile ? pileIdByName.get(widget.pile) : undefined
    const widgetId = createdWidgets[index]?.id
    return pileId !== undefined && widgetId !== undefined
      ? [{ widgetId, pileId }]
      : []
  })

  if (sources.length > 0) {
    await db.insert(widgetPiles).values(sources)
  }

  console.log(
    `Replaced ${removed.length} home widgets with ${createdWidgets.length} ` +
      `(${sources.length} bound to a pile).`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
