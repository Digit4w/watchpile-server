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

export type ListRoute = typeof list
export type TemplatesRoute = typeof templates
export type CreateRoute = typeof create
export type UpdateRoute = typeof update
export type RemoveRoute = typeof remove
