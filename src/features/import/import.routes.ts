import { createRoute, z } from '@hono/zod-openapi'
import {
  IMPORT_FAILURE_KINDS,
  IMPORT_PROBLEM_KINDS,
  IMPORT_SOURCES,
} from './import.types.js'

/**
 * O import (brief, 3.12; design system, seções 2, 5, 7 e 8).
 *
 * **A resposta não carrega frase**, nem no resultado nem nos problemas: são
 * `kind` + `params`, e quem monta a copy é o cliente. A régua vale mais forte
 * aqui do que nas notificações porque a linha é persistida E relida — alguém
 * abre o resultado de uma importação semanas depois, com o app talvez noutro
 * idioma.
 *
 * **`GET /status` é a única leitura, e ela responde as duas metades da tela**:
 * o cartão de "rodando", com o contador, e o bloco de "última importação". Uma
 * rota só porque a tela pergunta uma coisa só — "em que pé está o meu import?"
 * — e a resposta a essa pergunta é diferente conforme haja um rodando ou não.
 */

const MessageSchema = z.object({ message: z.string() })

const unauthorized = {
  content: { 'application/json': { schema: MessageSchema } },
  description: 'No active session',
} as const

const ProblemSchema = z
  .object({
    kind: z.enum(IMPORT_PROBLEM_KINDS),
    /** A linha do arquivo, quando a fonte tem linhas. */
    row: z.number().int().optional(),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  })
  .openapi('ImportProblem')

const JobSchema = z
  .object({
    id: z.number().int(),
    source: z.enum(IMPORT_SOURCES),
    mode: z.enum(['skip', 'overwrite']),
    status: z.enum(['running', 'done', 'failed', 'cancelled']),
    /**
     * **Nulo enquanto a fonte não responde**, e a tela esconde o denominador
     * nesse intervalo em vez de mostrar um zero que mentiria. No AniList a
     * coleção vem numa resposta só, no MAL paginada, no CSV depois de ler o
     * arquivo.
     */
    total: z.number().int().nullable(),
    processed: z.number().int(),
    added: z.number().int(),
    skipped: z.number().int(),
    updated: z.number().int(),
    /**
     * Recorte de `added`, nunca um quinto resultado — as obras que entraram
     * com um vínculo em vez de dois, e que ainda pedem o outro. Os quatro
     * números **não somam** `processed`, e é de propósito.
     */
    unmatched: z.number().int(),
    /** A verdade, sem teto. */
    problemCount: z.number().int(),
    /** Os primeiros N. A lista tem teto; a contagem acima não. */
    problems: z.array(ProblemSchema),
    /**
     * Por que o job inteiro caiu. `source-refused` e `source-down` são dois
     * porque a copy muda entre "confira o nome" e "tente mais tarde" — a mesma
     * divisão de 02/09/2026 (brief, 3.10).
     */
    errorKind: z.enum(IMPORT_FAILURE_KINDS).nullable(),
    errorParams: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .nullable(),
    /** Quem apertou `Stop`, e quando. Pedido não é estado: o status segue `running` até o laço reparar. */
    cancelRequestedAt: z.string().nullable(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .openapi('ImportJob')

/**
 * Uma fonte, e **se ela pode rodar AGORA**.
 *
 * Existe porque **a recusa se anuncia antes do clique** (design system, seção
 * 5): o servidor sabe se tem a chave do MyAnimeList, e a tela precisa saber
 * junto. Sem isto, a única forma de descobrir seria clicar e receber um 503 que
 * não teria onde aparecer — o app não tem toast.
 *
 * `reason` é `kind`, não frase, como todo o resto deste contrato.
 */
const SourceSchema = z
  .object({
    slug: z.enum(IMPORT_SOURCES),
    available: z.boolean(),
    /**
     * `not-configured`: falta a credencial da instalação, e quem resolve é o
     * admin em Providers.
     * `unverified`: a fonte existe no servidor mas **nunca foi medida** contra a
     * API real. **Sem emissor desde 07/09/2026**, quando o AniList — o único que
     * o usava — foi ligado por decisão do dono.
     *
     * Ele FICA no vocabulário, e isso não contradiz "vocabulário não exercitado
     * nasce errado": este foi exercitado, renderiza certo, e volta no minuto em
     * que o primeiro import real provar que a leitura do envelope está errada.
     * O que aquela régua recusa é vocabulário que nunca rodou.
     */
    reason: z.enum(['not-configured', 'unverified']).nullable(),
  })
  .openapi('ImportSource')

const StatusSchema = z
  .object({
    /**
     * O que esta instalação consegue importar, e por que não, quando não
     * consegue. A tela desenha uma caixa por fonte e desabilita com o motivo —
     * a recusa mora na PEÇA que a causou.
     */
    sources: z.array(SourceSchema),
    /**
     * O que está rodando **nesta instalação**, de quem quer que seja.
     *
     * O limite de uma importação por vez é do RECURSO — o `better-sqlite3` é
     * síncrono e o banco é um arquivo só —, então a tela de quem não é dono
     * também precisa saber que há uma rodando. `mine` é o que diz se ela pode
     * apertar `Stop`; o nome de quem ocupa **não** viaja, porque o fato que
     * impede é a ocupação, não a identidade de quem ocupa.
     */
    running: JobSchema.nullable(),
    /** Se o que está rodando é desta pessoa. */
    mine: z.boolean(),
    /** A última importação DESTA pessoa, para o bloco de resultado. */
    latest: JobSchema.nullable(),
  })
  .openapi('ImportStatus')

export const status = createRoute({
  method: 'get',
  path: '/status',
  tags: ['Import'],
  responses: {
    200: {
      content: { 'application/json': { schema: StatusSchema } },
      description: 'What is running, and how the last import went',
    },
    401: unauthorized,
  },
})

/**
 * O modo vai na QUERY, e o corpo é o arquivo cru.
 *
 * É a mesma forma da capa de pilha — corpo cru com o mime no `Content-Type`,
 * não `multipart/form-data` —, e o argumento daquela decisão dizia que
 * multipart não se paga "pra transportar um arquivo só, **sem campo nenhum ao
 * lado dele**". Aqui há um campo ao lado, e ele é um enum de dois valores:
 * pequeno demais para justificar um parser de multipart no servidor e um
 * `FormData` no cliente.
 *
 * **202 e não 201**: o pedido foi ACEITO e o trabalho começou; ele não terminou.
 * A resposta devolve o job recém-criado, que é o que a tela precisa pra trocar
 * do formulário para o cartão de "rodando" sem esperar um poll.
 *
 * **409 quando já há uma rodando**, e quem recusa é o índice único parcial da
 * `0035`, não um `SELECT` antes do `INSERT` — a corrida ficaria de pé.
 */
export const importCsv = createRoute({
  method: 'post',
  path: '/csv',
  tags: ['Import'],
  request: {
    query: z.object({
      mode: z.enum(['skip', 'overwrite']).default('skip'),
    }),
    body: {
      content: {
        'text/csv': { schema: z.string() },
        'text/plain': { schema: z.string() },
      },
      description: 'The CSV file, as raw text',
    },
  },
  responses: {
    202: {
      content: { 'application/json': { schema: JobSchema } },
      description: 'The import started, and runs in the background',
    },
    400: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'The body is empty',
    },
    401: unauthorized,
    409: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'An import is already running on this server',
    },
    413: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'The file is larger than the limit',
    },
  },
})

/**
 * `Stop`.
 *
 * **Pede, não desliga.** O laço confere o pedido entre lotes, e o que já entrou
 * FICA: cancelar interrompe, não desfaz. Desfazer é outra feature, e ela tem
 * onde apoiar — o `event_log` registra origem `import` —, mas não é esta.
 *
 * 200 e não 204 porque a tela quer o job de volta pra desenhar o pedido em
 * curso; 409 quando não há o que cancelar, que inclui o job de outra pessoa —
 * distinguir "não é seu" de "já terminou" diria a quem não é dono que existe
 * um job dele, e isso não é dela.
 */
export const cancel = createRoute({
  method: 'post',
  path: '/{id}/cancel',
  tags: ['Import'],
  request: {
    params: z.object({ id: z.coerce.number().int().positive() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: JobSchema } },
      description: 'The stop was requested; the loop obeys at the next batch',
    },
    401: unauthorized,
    409: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'There is nothing of yours running to stop',
    },
  },
})

/**
 * As duas fontes de SERVIÇO — por nome de usuário, não por arquivo.
 *
 * **Perfil público basta**, e é por isso que não há OAuth aqui: o MyAnimeList
 * lê a lista com o `X-MAL-Client-ID` da instalação, e o AniList não pede
 * credencial nenhuma. Perfil privado é outro ciclo (brief, 3.10 — token de
 * conta), e a recusa dele já tem `kind` próprio.
 *
 * **O `mode` vai na QUERY nas TRÊS**, mesmo aqui, onde o corpo é JSON e caberia
 * dentro dele. A uniformidade vale mais que a economia: as três são a mesma
 * operação com a mesma regra de colisão, e o cliente as monta do mesmo jeito.
 */
const UsernameSchema = z.object({
  username: z.string().trim().min(1).max(64),
})

const modeQuery = z.object({
  mode: z.enum(['skip', 'overwrite']).default('skip'),
})

function fromProfile(path: '/anilist' | '/mal', source: string) {
  return createRoute({
    method: 'post',
    path,
    tags: ['Import'],
    request: {
      query: modeQuery,
      body: {
        content: { 'application/json': { schema: UsernameSchema } },
        description: `The public ${source} username to read`,
      },
    },
    responses: {
      202: {
        content: { 'application/json': { schema: JobSchema } },
        description: 'The import started, and runs in the background',
      },
      401: unauthorized,
      409: {
        content: { 'application/json': { schema: MessageSchema } },
        description: 'An import is already running on this server',
      },
      /**
       * **A fonte não está configurada**, e é 409 e não 500 porque o pedido é
       * válido — falta a chave da instalação. Só o MyAnimeList pode responder
       * isto; o AniList não tem credencial.
       */
      503: {
        content: { 'application/json': { schema: MessageSchema } },
        description: 'This server has no key for that source yet',
      },
    },
  })
}

export const importAnilist = fromProfile('/anilist', 'AniList')
export const importMal = fromProfile('/mal', 'MyAnimeList')

export type StatusRoute = typeof status
export type ImportCsvRoute = typeof importCsv
export type CancelRoute = typeof cancel
export type ImportAnilistRoute = typeof importAnilist
export type ImportMalRoute = typeof importMal
