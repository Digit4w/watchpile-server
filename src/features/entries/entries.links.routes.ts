import { createRoute, z } from '@hono/zod-openapi'

const MessageSchema = z.object({
  message: z.string(),
})

const IdParamSchema = z.object({
  id: z.coerce.number().int(),
})

const LinkParamSchema = IdParamSchema.extend({
  provider: z.string().min(1),
})

/**
 * Um vínculo da obra com um provedor.
 *
 * O `name` viaja junto pelo mesmo motivo de sempre — **slug é chave, não
 * rótulo** (design system, seção 8, sexta leva). Sem ele a caixa escreveria
 * `tmdb` onde devia escrever `TMDB`.
 */
const LinkSchema = z.object({
  provider: z.object({ slug: z.string(), name: z.string() }),
  externalId: z.string(),
  /**
   * Se é DESTE vínculo que a obra fala — de onde saem sinopse, ano e arte.
   *
   * **`effective` e não `primary`, e a diferença é uma afirmação a menos.**
   * `sourceOf` escolhe o override da obra quando ele existe e o vínculo mais
   * antigo quando não existe; marcar o segundo caso como "primary" prometeria
   * uma decisão que ninguém tomou — quem promove um vínculo é o `PUT` abaixo.
   * O que este campo diz é o que de fato acontece.
   *
   * Sai de `sourceOf`, e não de uma segunda conta aqui: **onde o servidor
   * decide, quem lê LÊ a decisão** — e esta é a mesma regra que já mordeu na
   * escolha da fonte de busca, quando a tela reimplementou o desempate e as
   * duas pontas divergiram no dia em que nasceu o primeiro provedor padrão.
   */
  effective: z.boolean(),
})

/**
 * De quais provedores esta obra fala.
 *
 * Rota própria e não campo de `EntrySchema`: a lista é da tela de detalhe, e
 * `GET /api/entries` devolve a biblioteca inteira — pendurar os vínculos na
 * obra faria toda listagem pagar por uma caixa que só uma tela mostra.
 */
export const listLinks = createRoute({
  method: 'get',
  path: '/{id}/links',
  tags: ['Entries'],
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(LinkSchema) } },
      description: 'The providers this entry is linked to',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Entry not found',
    },
  },
})

const CreateLinkSchema = z.object({
  provider: z.string().min(1),
  externalId: z.string().min(1),
})

/**
 * Vincular uma obra que JÁ EXISTE a um provedor (brief, 3.10).
 *
 * ── Por que ela existe ──────────────────────────────────────────────────────
 * Sem ela, anexar metadados a uma obra existente só se faz **apagando e
 * re-adicionando**, o que leva progresso e log junto (brief, 3.11). Contorno
 * com formato de perda de dado não é contorno.
 *
 * Cobre **dois casos com o mesmo mecanismo**: a obra digitada à mão antes de
 * haver provedor — que é toda biblioteca montada até aqui —, e o
 * enriquecimento entre provedores, o anime que quer AniList *e* TMDB.
 *
 * ── É a escrita que ACORDA o desempate de `sourceOf` ────────────────────────
 * `sourceOf` já sabe desempatar entre vínculos desde 01/09/2026, e nunca teve
 * o que desempatar: nada no app criava obra com dois vínculos. Esta rota é o
 * primeiro caminho que cria o segundo.
 *
 * **O vínculo é sempre ato explícito** — casar por título fica descartado
 * (brief, 3.10), então quem manda o par (provedor, id) é quem escolheu o
 * resultado na tela.
 */
export const createLink = createRoute({
  method: 'post',
  path: '/{id}/links',
  tags: ['Entries'],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: CreateLinkSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: LinkSchema } },
      description: 'The entry was linked to that provider',
    },
    /**
     * Provedor que não existe, ou que existe e **não serve o tipo desta obra**.
     *
     * Os dois são pedido inválido pelo mesmo motivo que em `POST /api/entries`:
     * a FK de `external_ids.provider` falharia lá embaixo como 500. O segundo
     * caso ganha a mesma resposta que `GET /api/search` já dá — pedir ao TMDB
     * um id de mangá não é indisponibilidade, é pedido que nunca vai valer.
     */
    400: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'That provider does not exist, or does not serve this type',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Entry not found',
    },
    /**
     * Duas recusas diferentes com o mesmo código, e `entryId` é quem as separa.
     *
     * **Presente**: aquele id externo já é de OUTRA obra sua, e a tela consegue
     * apontar pra ela — é o mesmo contrato de `POST /api/entries`, e a mesma
     * guarda de rede, já que a folha desabilita o resultado antes do clique.
     *
     * **Ausente**: esta obra já tem vínculo com este provedor. É o único de
     * `(obra, provedor)` do schema, que é o que garante uma obra ter id em dois
     * provedores e não dois ids no mesmo — trocar de id é desvincular e
     * vincular de novo, que são dois atos explícitos.
     */
    409: {
      content: {
        'application/json': {
          schema: MessageSchema.extend({
            entryId: z.number().int().optional(),
          }),
        },
      },
      description: 'This entry, or another one, already claims that link',
    },
  },
})

/**
 * Desvincular.
 *
 * **Não apaga a obra**, e a copy da confirmação diz isso com todas as letras:
 * progresso, nota e log são da obra e sobrevivem — ao contrário de
 * `DELETE /api/entries/{id}`. É a mesma régua de `/piles/:id`, onde tirar de um
 * container não é apagar o objeto (design system, seção 5).
 *
 * É o caminho de reparo de quem vinculou o resultado errado. Sem ele o único
 * conserto voltaria a ser apagar e re-adicionar, que é justamente a perda de
 * dado que esta feature veio tirar.
 *
 * O provedor vai no caminho e não no corpo: o alvo é o vínculo, e ele é
 * identificado por (obra, provedor) — que é o único do schema.
 */
export const removeLink = createRoute({
  method: 'delete',
  path: '/{id}/links/{provider}',
  tags: ['Entries'],
  request: { params: LinkParamSchema },
  responses: {
    204: { description: 'The link was removed' },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    /**
     * Obra que não é sua e vínculo que não existe respondem igual, e a
     * indistinção é de propósito — a mesma de `POST /api/entries` com pilha
     * alheia: separar "não existe" de "não é seu" deixaria descobrir o acervo
     * dos outros por tentativa.
     */
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Entry not found, or it is not linked to that provider',
    },
  },
})

/**
 * Escolher de qual vínculo a obra fala (brief, 3.10).
 *
 * ── Por que ela é da OBRA e não do tipo ─────────────────────────────────────
 * Até 02/09/2026 essa escolha era do provedor padrão do tipo, que é vocabulário da
 * instância e portanto do admin (brief, 3.9) — e o resultado era que uma obra
 * com dois vínculos não tinha como discordar, deixando o segundo invisível. A
 * régua põe cada um do seu lado: qual provedor responde a BUSCA é
 * infraestrutura; de qual vínculo esta OBRA fala é conteúdo.
 *
 * **Idempotente e sem corpo**: o alvo inteiro está no caminho, e promover duas
 * vezes o mesmo vínculo é o mesmo pedido.
 *
 * Devolve a LISTA e não só o vínculo promovido, porque a escrita move o
 * `effective` de um item para outro — responder só o promovido faria a tela
 * remendar um item e deixar o antigo mentindo até a próxima leitura.
 */
export const setPrimaryLink = createRoute({
  method: 'put',
  path: '/{id}/links/{provider}/primary',
  tags: ['Entries'],
  request: { params: LinkParamSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(LinkSchema) } },
      description: 'The entry now speaks from that provider',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    /**
     * Obra que não é sua e vínculo que não existe respondem igual — a mesma
     * indistinção de `removeLink`, e pelo mesmo motivo: separar "não existe" de
     * "não é seu" deixaria descobrir o acervo dos outros por tentativa.
     *
     * **Promover um provedor a que a obra não está vinculada é 404 e não 400**:
     * o alvo do pedido é o VÍNCULO, e ele é que não existe.
     */
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Entry not found, or it is not linked to that provider',
    },
  },
})

export type ListLinksRoute = typeof listLinks
export type SetPrimaryLinkRoute = typeof setPrimaryLink
export type CreateLinkRoute = typeof createLink
export type RemoveLinkRoute = typeof removeLink
