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

export type GetMediaTypesRoute = typeof getMediaTypes
export type SetMediaTypesRoute = typeof setMediaTypes
