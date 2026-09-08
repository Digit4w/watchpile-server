import type { IconName } from './media-types.icons.js'
import type { NameMap } from './media-types.resolve.js'

/**
 * Os tipos que o produto EMBARCA — a lista que `Add type` oferece antes do
 * formulário em branco, e que o wizard de primeiro uso vai semear (brief, 3.9).
 *
 * ── Por que isto existe, e por que aqui ─────────────────────────────────────
 * "Onde o produto embarca conjunto pronto, criar mostra o conjunto primeiro"
 * (design system, seção 5, 31/08/2026). A regra nasceu de uma consequência do
 * wizard: se o admin semear só três dos seis, os outros três precisam de um
 * caminho de volta — e formulário em branco não é caminho de volta, porque
 * quem nunca viu "Manga" não sabe que ele existia pra ser recriado. **Semear
 * parcial não pode ser porta de mão única.**
 *
 * ── A relação com a migration, e como ela é verificada ──────────────────────
 * `0006_media_types.sql` semeia exatamente estes seis. Este arquivo **não é uma
 * segunda cópia à mão** no sentido que o brief 3.7 proíbe: a migration é o
 * retrato CONGELADO deste conjunto no dia em que ela rodou, e migration não se
 * reescreve. Daqui pra frente a fonte viva é este módulo — é ele que o wizard
 * vai ler.
 *
 * O que impede os dois de divergirem é um TESTE, não disciplina
 * (`media-types.test.ts`): ele compara este módulo com o que um banco recém
 * migrado contém, campo por campo. Mudar um nome aqui sem uma migration que o
 * acompanhe quebra a suíte.
 *
 * ── O que um template NÃO tem ───────────────────────────────────────────────
 * Slug de verdade. `slug` aqui é o que `slugify` DERIVARIA do nome em inglês, e
 * viaja só pra que a tela saiba se o tipo já está instalado — criar continua
 * passando pelo mesmo `POST` que o formulário em branco usa, com o slug saindo
 * do primeiro nome preenchido como em qualquer criação. Template é conteúdo de
 * formulário, não uma segunda forma de criar tipo.
 */
export type MediaTypeTemplate = {
  /** O que `slugify` derivaria do nome em inglês. Só pra casar com o instalado. */
  slug: string
  icon: IconName
  /** Há o que contar? `movie` e `game` dizem que não (07/09/2026). */
  countsProgress: boolean
  names: NameMap
}

/**
 * Os seis, em inglês e português — os dois idiomas que o produto sai falando
 * (brief, 3.8). Um catálogo que ganhe um terceiro idioma acrescenta a chave
 * aqui, e a queda de idioma cobre quem lê nos outros.
 *
 * `progressUnit` nulo em `movie` e `game`, e por muito tempo **por motivos
 * DIFERENTES**: filme não conta nada (é 1/1), jogo contava sem ter unidade
 * natural — uns contam horas, outros capítulos, outros conquistas —, e impor
 * "horas" decidiria pelo usuário (brief, 3.12).
 *
 * **Desde 07/09/2026 os dois motivos viraram um**, por decisão do dono olhando
 * a tela: jogo também não conta (`0044`). O nulo de `progressUnit` passou a
 * dizer a mesma coisa nos dois, e o comentário fica como registro de que a
 * distinção existiu — ela é o argumento a favor de reabrir, se o dono voltar
 * atrás.
 */
export const MEDIA_TYPE_TEMPLATES: readonly MediaTypeTemplate[] = [
  {
    slug: 'movie',
    icon: 'clapperboard',
    countsProgress: false,
    names: {
      en: { name: 'Movie', plural: 'Movies', progressUnit: null },
      'pt-BR': { name: 'Filme', plural: 'Filmes', progressUnit: null },
    },
  },
  {
    slug: 'tv',
    icon: 'monitor',
    countsProgress: true,
    names: {
      en: { name: 'Series', plural: 'Series', progressUnit: 'Episodes' },
      'pt-BR': { name: 'Série', plural: 'Séries', progressUnit: 'Episódios' },
    },
  },
  {
    slug: 'anime',
    icon: 'sparkles',
    countsProgress: true,
    names: {
      en: { name: 'Anime', plural: 'Anime', progressUnit: 'Episodes' },
      'pt-BR': { name: 'Anime', plural: 'Animes', progressUnit: 'Episódios' },
    },
  },
  {
    slug: 'manga',
    icon: 'message-square',
    countsProgress: true,
    names: {
      en: { name: 'Manga', plural: 'Manga', progressUnit: 'Chapters' },
      'pt-BR': { name: 'Mangá', plural: 'Mangás', progressUnit: 'Capítulos' },
    },
  },
  {
    slug: 'game',
    icon: 'gamepad-2',
    countsProgress: false,
    names: {
      en: { name: 'Game', plural: 'Games', progressUnit: null },
      'pt-BR': { name: 'Jogo', plural: 'Jogos', progressUnit: null },
    },
  },
  {
    slug: 'book',
    icon: 'book-open',
    countsProgress: true,
    names: {
      en: { name: 'Book', plural: 'Books', progressUnit: 'Pages' },
      'pt-BR': { name: 'Livro', plural: 'Livros', progressUnit: 'Páginas' },
    },
  },
]
