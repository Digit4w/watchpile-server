import { createRoute, z } from '@hono/zod-openapi'
import {
  ProviderPatchSchema,
  ProviderSchema,
  ProviderTestSchema,
} from './providers.public.js'

const MessageSchema = z.object({ message: z.string() })

const SlugParamSchema = z.object({ slug: z.string().min(1) })

export const list = createRoute({
  method: 'get',
  path: '/',
  tags: ['Providers'],
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(ProviderSchema) } },
      description: 'The metadata providers this server knows',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
  },
})

/**
 * **Sem `slug` no corpo, e sem rota de criar ou apagar — escopo deste ciclo.**
 *
 * O v1 é só TMDB (brief, 3.12) e ele é semeado, então nada aqui precisa de
 * criação. Provedor definido pelo usuário é o que a definição declarativa
 * existe pra permitir (3.10), e ele chega com a superfície que falta: validar
 * uma definição inteira vinda de fora — URL base, endpoints, mapa de campos —
 * é outro problema, e maior que este.
 *
 * A ausência não é acidente: `external_ids.provider` já aponta pra cá com
 * `ON DELETE restrict` justamente porque apagar provedor levaria junto a
 * informação de que uma obra é `tmdb/550`.
 */
export const update = createRoute({
  method: 'patch',
  path: '/{slug}',
  tags: ['Providers'],
  request: {
    params: SlugParamSchema,
    body: { content: { 'application/json': { schema: ProviderPatchSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ProviderSchema } },
      description: 'The updated provider',
    },
    400: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'A credential or option this provider does not declare',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    403: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Only an admin configures the providers of this server',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Provider not found',
    },
  },
})

/**
 * O que testar, quando não é o que está guardado.
 *
 * **Testar só a credencial salva obriga a salvar a errada primeiro** — e ela
 * fica valendo até alguém consertar, que é o oposto de "validar no salvamento"
 * (brief, 3.10). Com o override, o admin cola a chave, testa, e só então
 * decide salvar.
 *
 * Ele entra no degrau **guardado** da cadeia (env > arquivo > guardado >
 * embutido), e é a única posição possível: quando env ou arquivo vencem, o
 * campo aparece desabilitado na tela, então não há o que digitar pra
 * sobrepor. String vazia continua contando como **ausente**, então testar uma
 * credencial marcada pra apagar cai no degrau seguinte — que é exatamente o
 * que vai acontecer depois de salvar.
 *
 * **Nada disto é gravado.** O override vale pela duração da tentativa.
 */
const TestBodySchema = z.object({
  credentials: z.record(z.string(), z.string()).optional(),
})

export const test = createRoute({
  method: 'post',
  path: '/{slug}/test',
  tags: ['Providers'],
  request: {
    params: SlugParamSchema,
    body: {
      required: false,
      content: { 'application/json': { schema: TestBodySchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ProviderTestSchema } },
      /**
       * 200 mesmo quando o provedor recusa a chave, e é de propósito: a
       * requisição NOSSA deu certo — quem falhou foi a credencial contra o
       * terceiro. Devolver 4xx faria o cliente tratar como erro de rede e
       * mostrar "não foi possível alcançar o servidor", que é a frase errada.
       */
      description: 'The connection was attempted; `ok` says whether it worked',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    403: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Only an admin configures the providers of this server',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Provider not found',
    },
  },
})

export type ListRoute = typeof list
export type UpdateRoute = typeof update
export type TestRoute = typeof test
