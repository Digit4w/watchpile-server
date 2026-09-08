import type { entries } from '../../db/schema/entries.js'

/**
 * O vocabulário do import (brief, 3.12).
 *
 * Tudo aqui é `kind` — **nunca frase**. A régua é a mesma de
 * `notifications.kinds.ts`, e aqui ela aperta mais: a linha de `import_jobs` é
 * persistida, e alguém abre o resultado de uma importação semanas depois. Uma
 * frase gravada em inglês sobreviveria à tradução do app.
 */

export type ImportMode = 'skip' | 'overwrite'

/**
 * De onde se leu.
 *
 * **Não é um provedor**, e a distinção é real: o provedor procura no CATÁLOGO,
 * a fonte de import lê o PERFIL de uma pessoa — e `csv` é fonte sem ser
 * provedor de coisa nenhuma. O que vira FK é o id que a fonte trouxe, que se
 * pendura em `external_ids`.
 */
export const IMPORT_SOURCES = ['anilist', 'mal', 'csv'] as const
export type ImportSourceSlug = (typeof IMPORT_SOURCES)[number]

type EntryStatus = (typeof entries.$inferSelect)['status']

/**
 * Uma obra como a fonte a entrega, já traduzida pro nosso vocabulário e ainda
 * não escrita.
 *
 * `mediaType` é o **nosso** slug, não o token da fonte: quem traduz `MANGA` em
 * `manga` é `provider_type_token` na junção (brief, 3.10), e ela existe desde o
 * ciclo dos vínculos. Se o slug traduzido não existir nesta instalação, quem
 * recusa é o aplicador — a fonte não sabe o vocabulário da instância.
 *
 * `links` são os ids que vieram junto, e são **a peça inteira do ciclo**: id que
 * bate em `external_ids` casa a obra; id que não bate entra assim mesmo. Lista e
 * não campo único porque uma fonte pode trazer mais de uma identidade — o
 * AniList entrega o id dele **e** o `idMal` na mesma entrada.
 */
export type ImportItem = {
  mediaType: string
  title: string
  status: EntryStatus
  progress: number
  total: number | null
  links: { provider: string; externalId: string }[]
  /**
   * A fonte tinha como trazer mais identidade e **não trouxe**.
   *
   * Não é "não casou com obra existente" — é o que a tela promete ao oferecer o
   * vínculo depois: a obra entrou com um vínculo em vez de dois, e ainda pede
   * um. Só a FONTE sabe disso, porque só ela conhece o que costuma entregar: no
   * AniList é `idMal` nulo (o caso difícil que o brief 3.12 nomeia), no CSV é
   * linha sem `source`/`media_id`. Um cálculo genérico aqui — "menos de dois
   * vínculos" — chamaria de incompleto todo CSV bem preenchido.
   */
  partialIdentity: boolean
  /**
   * Quando a pessoa mexeu nisso pela ÚLTIMA vez na fonte — vira `occurred_at`
   * no `event_log`, que aceita data retroativa desde sempre (brief, 3.11).
   * Nulo quando a fonte não diz, e aí o evento é de agora.
   */
  occurredAt: Date | null
  /** Só o CSV tem: o número da linha, pra a mensagem de problema apontar onde. */
  row?: number
}

/**
 * O que impediu UM item de entrar, com o import seguindo.
 *
 * É diferente de uma falha do job (abaixo): o problema é de um item e o resto
 * continua; a falha para tudo. A separação é a régua da recusa do design system
 * (seção 5) — **o alcance do sinal é o alcance real do fato**.
 */
export const IMPORT_PROBLEM_KINDS = [
  /** O tipo que a fonte trouxe não existe nesta instalação. `{ value }`. */
  'unknown-media-type',
  /** O `source` da linha do CSV não é provedor daqui. `{ value }`. */
  'unknown-source',
  /** Nem título nem id: não há o que procurar nem o que gravar. */
  'missing-identity',
  /** O status não é um dos cinco do enum (brief, 3.16). `{ value }`. */
  'invalid-status',
  /** Um campo numérico não é número. `{ field, value }`. */
  'invalid-number',
] as const
export type ImportProblemKind = (typeof IMPORT_PROBLEM_KINDS)[number]

export type ImportProblem = {
  kind: ImportProblemKind
  /** A linha do CSV, quando a fonte tem linhas. */
  row?: number
  params?: Record<string, string | number>
}

/**
 * O que derrubou o job inteiro.
 *
 * **`source-refused` e `source-down` são dois, e a divisão é a mesma de
 * 02/09/2026** (brief, 3.10): `4xx` é o serviço recusando o nosso pedido — há o
 * que arrumar —, `5xx` é ele falhando do lado dele — há o que esperar. Ali a
 * distinção nasceu porque o 504 do Jikan vinha como "refused" e mandava o admin
 * consertar o que estava certo; aqui ela decide se a copy diz "confira o nome"
 * ou "tente mais tarde".
 *
 * **A severidade, porém, é a mesma nos dois** — e isso não contradiz aquela
 * decisão. Lá o que mudava com a gravidade era se a tela oferecia
 * `Open providers`, uma configuração a consertar. Aqui não há configuração
 * nenhuma: em todos os casos o import não aconteceu e a pessoa precisa refazê-lo.
 * A diferença fica no `kind`, que é onde a copy a lê.
 */
export const IMPORT_FAILURE_KINDS = [
  /** Não existe perfil com esse nome. `{ username }`. */
  'user-not-found',
  /** O perfil existe e é privado. `{ username }`. */
  'private-profile',
  /** `4xx` — o serviço recusou o nosso pedido. */
  'source-refused',
  /** `5xx` ou rede fora — o serviço falhou do lado dele. */
  'source-down',
  /** O arquivo não é um CSV legível, ou não tem as colunas obrigatórias. */
  'invalid-file',
  /**
   * O processo morreu no meio. Não é falha de ninguém e não tem culpado — é o
   * que sobra de uma linha `running` cujo executor não existe mais.
   */
  'interrupted',
  /** Defeito nosso. A frase da tela não promete causa, e o log tem o rastro. */
  'unexpected',
] as const
export type ImportFailureKind = (typeof IMPORT_FAILURE_KINDS)[number]

export class ImportFailure extends Error {
  constructor(
    readonly kind: ImportFailureKind,
    readonly params: Record<string, string | number> = {},
  ) {
    super(kind)
    this.name = 'ImportFailure'
  }
}

/** O que uma fonte entrega: o que deu pra ler, e o que não deu. */
export type SourceReading = {
  items: ImportItem[]
  problems: ImportProblem[]
}

/**
 * A fonte lê TUDO antes de o executor escrever qualquer coisa, e isso é
 * decisão, não simplificação.
 *
 * Ler é I/O de rede: assíncrono, e não segura o event loop. Escrever é
 * `better-sqlite3`, que é **síncrono** e segura — é a escrita que precisa de
 * lotes com cessão no meio (ver `import.runner.ts`). Intercalar leitura e
 * escrita não tornaria a escrita menos bloqueante; só espalharia o bloqueio.
 *
 * O custo é a coleção inteira em memória. Doze mil itens dão alguns MB, e o
 * teto real é o mesmo do `GET /api/entries`, que já devolve a biblioteca toda
 * numa resposta só (brief, 3.12).
 */
export type ImportSource = {
  read(): Promise<SourceReading>
}

/** O que aconteceu com um item. Os quatro alimentam os contadores da linha. */
export type ApplyOutcome =
  | {
      kind: 'added'
      /**
       * Entrou sem o par que a fonte não trouxe — recorte de `added`, não um
       * quinto resultado. É o número que diz quantas obras ainda pedem um
       * vínculo, e ele só existe porque a obra ENTROU: o Yamtrack, medido em
       * 06/09/2026, descarta a obra nesse caso.
       *
       * Vem de `ImportItem.partialIdentity`, que é declaração da FONTE — o
       * aplicador não tem como saber o que o AniList costuma mandar.
       */
      unmatched: boolean
    }
  | { kind: 'skipped' }
  | { kind: 'updated' }
  | { kind: 'problem'; problem: ImportProblem }

/**
 * Escrever um item. O executor não sabe o que isto faz — ele conta resultados,
 * cede o event loop e obedece ao `Stop`.
 *
 * Separado por injeção porque as duas metades falham de jeitos diferentes e
 * têm testes diferentes: a mecânica do laço se prova com uma fonte falsa e
 * doze mil itens, sem tocar em `entries`; a escrita se prova com três itens e
 * o banco de verdade.
 */
export type ApplyItem = (item: ImportItem, mode: ImportMode) => ApplyOutcome
