import { createRoute, z } from '@hono/zod-openapi'
import { ICON_NAMES } from './media-types.icons.js'
import {
  LocaleSchema,
  MediaTypeSchema,
  NameMapSchema,
} from './media-types.public.js'

const MessageSchema = z.object({
  message: z.string(),
})

/**
 * A recusa de apagar carrega a CONTAGEM, não só a negativa.
 *
 * "Não dá" manda o admin adivinhar o tamanho do problema; "3 obras usam este
 * tipo" diz o que ele precisa saber pra decidir o que fazer. A tela já mostra
 * esse número na linha antes do clique (design system, seção 5), e a resposta
 * repete porque a tela pode estar desatualizada e o servidor é quem sabe.
 */
const InUseSchema = z.object({
  message: z.string(),
  entryCount: z.number().int(),
})

const SlugParamSchema = z.object({
  slug: z.string().min(1),
})

const ListQuerySchema = z.object({
  /**
   * O idioma de quem lê — degrau 1 da queda (brief, 3.12). Opcional porque o
   * servidor não conhece a preferência de UI de ninguém: quem sabe é o cliente,
   * e ele diz. Ausente, a queda começa no degrau 2.
   */
  locale: LocaleSchema.optional(),
})

const CreateBodySchema = z.object({
  /**
   * Enum, e não string livre. Duas coisas saem daí de uma vez: o servidor
   * recusa um glifo que não existe, e **o cliente recebe o acervo pelos tipos
   * gerados** — sem uma segunda rota só pra listar ícone, e sem uma segunda
   * cópia da lista escrita à mão do outro lado (brief, 3.7).
   *
   * O custo é que ampliar o acervo vira mudança de contrato. É o certo: o
   * acervo é infraestrutura do produto, não conteúdo de usuário.
   */
  icon: z.enum(ICON_NAMES),
  /**
   * Há o que contar? Padrão `true` porque contar é o caso comum — dos seis
   * embarcados, só `movie` e `game` dizem que não (07/09/2026).
   */
  countsProgress: z.boolean().default(true),
  /**
   * Registra tempo investido? Padrão `false`, ao contrário de `countsProgress`:
   * a maioria dos tipos não tem tempo a registrar, e um campo a mais em toda
   * obra de toda instalação seria o oposto de *preferência existe onde o
   * sistema não tem opinião*.
   */
  tracksTime: z.boolean().default(false),
  names: NameMapSchema,
})

/**
 * Um template embarcado — o CONTEÚDO de um formulário, não uma segunda forma
 * de criar tipo.
 *
 * Os três primeiros campos são exatamente o corpo do `POST`, e é de propósito:
 * escolher um template preenche a folha, e salvar passa pelo mesmo caminho que
 * o formulário em branco. Um endpoint que criasse o tipo direto do template
 * seria o "embutido com atalho" que o brief 3.10 recusa.
 *
 * `installed` é a única coisa que o servidor sabe e o template não: com os seis
 * semeados numa instalação normal, oferecer "Movie" sem dizer que ele já existe
 * levaria o admin a criar um `movie-2` sem perceber. Quem responde isso é o
 * servidor porque é ele que tem a lista instalada — o cliente teria que
 * reimplementar `slugify` pra chegar na mesma resposta.
 */
const TemplateSchema = z.object({
  slug: z.string(),
  icon: z.enum(ICON_NAMES),
  countsProgress: z.boolean(),
  tracksTime: z.boolean(),
  names: NameMapSchema,
  installed: z.boolean(),
})

/**
 * Parcial, e **sem `slug`**. Ele é derivado do primeiro nome na criação e
 * imutável depois: a FK de `entries` aponta pra ele, a URL de `/library` o
 * carrega e o filtro de widget o guarda em JSON (`media-types.slug.ts`).
 * Renomear o tipo muda o NOME, que é texto por idioma.
 */
const UpdateBodySchema = CreateBodySchema.partial().extend({
  /**
   * O provedor padrão do tipo — quem responde a busca dele (brief, 3.10).
   *
   * `null` **limpa** a escolha, e é diferente de ausente: ausente não mexe.
   * Mesma distinção que o `PATCH` de credencial faz entre "não mandei" e
   * "mandei vazio", e pela mesma razão — sem ela não há como desfazer.
   */
  defaultProvider: z.string().nullish(),
})

export const list = createRoute({
  method: 'get',
  path: '/',
  tags: ['Media types'],
  request: { query: ListQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(MediaTypeSchema) } },
      description: 'The media types this server can track',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
  },
})

/**
 * **Do admin, e a guarda é a mesma de escrever.**
 *
 * Template só serve pra criar tipo, e criar tipo é do admin (brief, 3.9) —
 * então esta leitura não segue a regra de "ler é de todo mundo" que vale pra
 * `list`. Ela cai sob `router.use('/:slug', adminMiddleware())` por casar o
 * padrão de um segmento, e isso está DECLARADO em `media-types.index.ts` em vez
 * de acontecer por acaso.
 */
export const templates = createRoute({
  method: 'get',
  path: '/templates',
  tags: ['Media types'],
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(TemplateSchema) } },
      description: 'The media types this product ships with',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    403: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Only an admin sets the vocabulary of this server',
    },
  },
})

export const create = createRoute({
  method: 'post',
  path: '/',
  tags: ['Media types'],
  request: {
    body: { content: { 'application/json': { schema: CreateBodySchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: MediaTypeSchema } },
      description: 'The media type was created',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    403: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Only an admin sets the vocabulary of this server',
    },
  },
})

export const update = createRoute({
  method: 'patch',
  path: '/{slug}',
  tags: ['Media types'],
  request: {
    params: SlugParamSchema,
    body: { content: { 'application/json': { schema: UpdateBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: MediaTypeSchema } },
      description: 'The updated media type',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    403: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Only an admin sets the vocabulary of this server',
    },
    400: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'That provider does not serve this media type',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Media type not found',
    },
  },
})

export const remove = createRoute({
  method: 'delete',
  path: '/{slug}',
  tags: ['Media types'],
  request: { params: SlugParamSchema },
  responses: {
    204: { description: 'The media type was deleted' },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    403: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Only an admin sets the vocabulary of this server',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Media type not found',
    },
    409: {
      content: { 'application/json': { schema: InUseSchema } },
      description: 'Titles still use this type, so it cannot be deleted',
    },
  },
})

const PairParamSchema = z.object({
  slug: z.string().min(1),
  provider: z.string().min(1),
})

/**
 * O corpo de vincular: **de qual tipo copiar a receita** — 10/09/2026.
 *
 * ── Por que copiar, e não uma linha em branco ───────────────────────────────
 * A junção não é uma associação, é uma RECEITA: `search_path`, `search_body`,
 * `field_map`, `detail_path`, `provider_type_token`, `units_path` e mais. Uma
 * linha vazia cai no endpoint do PROVEDOR, e **medido: nenhum dos doze pares
 * semeados funciona assim** — todos sobrescrevem alguma coisa.
 *
 * O caso que decide é o do pedido: um `Light Novel` vinculado ao AniList com a
 * linha em branco herdaria `anilistSearch('ANIME')` do provedor e devolveria
 * **anime** para toda busca de light novel — resultado plausível, na coluna
 * certa, sem erro em lugar nenhum. É o mesmo formato de defeito que o
 * `first_release_date` do IGDB tinha ao ler quatro dígitos de um timestamp.
 *
 * ── Por que copiar FUNCIONA, e não é gambiarra ──────────────────────────────
 * Uma receita que já serve outro tipo é uma receita **provada** — ela está
 * respondendo agora. E o caso do pedido é literalmente esse: o AniList põe
 * light novel **dentro** de `MANGA`, então clonar o par `(manga, anilist)` dá
 * o `search_body` certo, o `field_map` certo e o token certo.
 *
 * A alternativa era um editor de par — a superfície de "definir provedor" do
 * brief 3.10 um nível abaixo. Ela resolve o caso geral e **ninguém acerta um
 * `field_map` sem ver a resposta do provedor**, então ela não é o primeiro
 * passo. Decisão do dono.
 */
const LinkBodySchema = z.object({
  /**
   * O slug do tipo cuja receita se copia. Precisa ser um tipo que **este
   * provedor já serve** — é o que torna a cópia uma promessa e não um chute.
   */
  copyFrom: z.string().min(1),
})

/**
 * A recusa de desvincular carrega a contagem, como a de apagar tipo.
 *
 * E ela é sobre uma consequência que não se vê: `bindingFor` é o que serve
 * **arte, detalhe e resolução de obra**. Tirar a linha deixa toda obra daquele
 * tipo vinculada àquele provedor sem receita — a arte para de carregar e o
 * detalhe para de abrir, sem nada na tela dizendo por quê.
 */
const PairInUseSchema = z.object({
  message: z.string(),
  entryCount: z.number().int(),
})

export const link = createRoute({
  method: 'put',
  path: '/{slug}/providers/{provider}',
  tags: ['Media types'],
  request: {
    params: PairParamSchema,
    body: {
      content: { 'application/json': { schema: LinkBodySchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: MediaTypeSchema } },
      description: 'The provider now serves this media type',
    },
    400: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'There is no recipe to copy from',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    403: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Only an admin sets the vocabulary of this server',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Media type or provider not found',
    },
  },
})

export const unlink = createRoute({
  method: 'delete',
  path: '/{slug}/providers/{provider}',
  tags: ['Media types'],
  request: { params: PairParamSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: MediaTypeSchema } },
      description: 'The provider no longer serves this media type',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    403: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Only an admin sets the vocabulary of this server',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'That provider does not serve this media type',
    },
    409: {
      content: { 'application/json': { schema: PairInUseSchema } },
      description: 'Titles of this type already point at this provider',
    },
  },
})

export type ListRoute = typeof list
export type TemplatesRoute = typeof templates
export type CreateRoute = typeof create
export type UpdateRoute = typeof update
export type RemoveRoute = typeof remove
export type LinkRoute = typeof link
export type UnlinkRoute = typeof unlink
