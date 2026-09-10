import { createRoute, z } from '@hono/zod-openapi'

/**
 * Preferência de USUÁRIO — o que cada um escolhe ver, e não o que a instalação
 * é (brief, 3.9 e 3.12).
 *
 * **Feature própria, e não uma rota dentro de `media-types`**, porque "tipo de
 * mídia" são dois objetos: *definir* o tipo é vocabulário da instância, escrito
 * só pelo admin, e mora lá; *escolher quais tipos eu vejo* é preferência, é de
 * cada um, e mora aqui. Pendurar a preferência na entidade do tipo poria um
 * campo por usuário dentro de um objeto da instância, que é a confusão que o
 * brief desfez em 31/08/2026.
 *
 * É também onde as próximas preferências vão morar — idioma de UI, quando
 * houver biblioteca de i18n. Por isso o recurso é `/api/preferences/…` e cada
 * preferência é um caminho dentro dele, em vez de um objeto único: uma tela que
 * mexe numa não precisa reenviar as outras.
 */

const MessageSchema = z.object({
  message: z.string(),
})

/**
 * Os tipos que este usuário escondeu, por slug.
 *
 * **A lista é a dos ESCONDIDOS, não a dos visíveis**, pelo mesmo motivo da
 * tabela: o padrão é ver tudo, e um tipo criado depois nasce visível sem que
 * ninguém precise reescrever a preferência de todo mundo.
 */
const HiddenMediaTypesSchema = z
  .object({
    hidden: z.array(z.string()),
  })
  .openapi('MediaTypeVisibility')

/**
 * A escrita substitui o conjunto INTEIRO, e por isso a tela mostra o conjunto
 * inteiro (design system, seção 5) — é a mesma régua do mapa de nomes do tipo.
 * A lista de toggles é a tela toda, então não há como mandar metade.
 */
const SetHiddenSchema = z.object({
  hidden: z.array(z.string().min(1)),
})

export const getMediaTypes = createRoute({
  method: 'get',
  path: '/media-types',
  tags: ['Preferences'],
  responses: {
    200: {
      content: { 'application/json': { schema: HiddenMediaTypesSchema } },
      description: 'The media types this user chose to hide',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
  },
})

export const setMediaTypes = createRoute({
  method: 'put',
  path: '/media-types',
  tags: ['Preferences'],
  request: {
    body: { content: { 'application/json': { schema: SetHiddenSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: HiddenMediaTypesSchema } },
      description: 'The selection was saved',
    },
    400: {
      content: { 'application/json': { schema: MessageSchema } },
      description:
        'A slug does not exist on this server, or the selection would hide every media type',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
  },
})

/**
 * A fonte que este usuário prefere para buscar cada tipo.
 *
 * **Um mapa, e a ausência de uma chave é o padrão da instância** — não há
 * entrada nula: quem nunca escolheu não aparece, e a busca cai no efetivo. É a
 * mesma assimetria de `hidden`, e pelo mesmo motivo (tipo criado depois nasce
 * seguindo o admin, sem semear nada).
 *
 * **O que volta já está validado contra a associação:** um par que deixou de
 * existir não aparece aqui, então a tela não desenha um seletor apontando pra
 * uma fonte que a busca recusaria.
 */
const SearchSourcesSchema = z
  .object({
    sources: z.record(z.string(), z.string()),
  })
  .openapi('SearchSources')

/**
 * A escrita é de UM tipo, ao contrário da de visibilidade.
 *
 * **Substituir o conjunto inteiro exige mostrar o conjunto inteiro** (design
 * system, seção 5), e `/search` mostra um tipo por vez: o gesto é *escolher a
 * fonte DESTE tipo*, e mandar o mapa todo faria uma busca em `anime` reafirmar
 * o que vale pra `manga` sem ninguém ter olhado pra isso.
 *
 * `provider: null` desfaz a escolha em vez de gravar "nenhuma" — não ter fonte
 * preferida é um estado, e ele já tem representação: a linha não existe.
 */
const SetSearchSourceSchema = z.object({
  provider: z.string().min(1).nullable(),
})

export const getSearchSources = createRoute({
  method: 'get',
  path: '/search-sources',
  tags: ['Preferences'],
  responses: {
    200: {
      content: { 'application/json': { schema: SearchSourcesSchema } },
      description: 'The search source this user prefers for each media type',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
  },
})

export const setSearchSource = createRoute({
  method: 'put',
  path: '/search-sources/{mediaType}',
  tags: ['Preferences'],
  request: {
    params: z.object({ mediaType: z.string().min(1) }),
    body: {
      content: { 'application/json': { schema: SetSearchSourceSchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SearchSourcesSchema } },
      description: 'The preference was saved',
    },
    400: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'That provider does not serve that media type',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No media type with that slug',
    },
  },
})

export type GetMediaTypesRoute = typeof getMediaTypes
export type SetMediaTypesRoute = typeof setMediaTypes
export type GetSearchSourcesRoute = typeof getSearchSources
export type SetSearchSourceRoute = typeof setSearchSource
