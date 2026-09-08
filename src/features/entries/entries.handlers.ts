import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { externalIds } from '../../db/schema/external-ids.js'
import type { AppRouteHandler } from '../../lib/types.js'
import { warmArtInBackground } from '../art/art.warm.js'
import { mediaTypeExists } from '../media-types/media-types.query.js'
import { dropFromAutoClearingPiles } from '../piles/piles.auto-remove.js'
import { appendToPiles, ownedPilesAmong } from '../piles/piles.membership.js'
import { providerBySlug } from '../providers/providers.query.js'
import { ownedByUser } from '../search/search.query.js'
import { historyOf } from './entries.history.js'
import { toPublicEntries, toPublicEntry } from './entries.public.js'
import { orderFor, titleContains } from './entries.query.js'
import { drizzleEntriesRepository } from './entries.repository.drizzle.js'
import type {
  AddProgressRoute,
  CreateRoute,
  GetByIdRoute,
  GetHistoryRoute,
  ListRoute,
  RemoveAllRoute,
  RemoveRoute,
  UpdateRoute,
} from './entries.routes.js'
import { recordProgress } from './entries.use-cases.js'

const progressFailureResponse = {
  'entry-not-found': { status: 404, message: 'Entry not found' },
  'progress-below-zero': {
    status: 422,
    message: 'Progress cannot go below zero',
  },
  'progress-above-total': {
    status: 422,
    message: 'Progress cannot go past the known total',
  },
} as const

export const list: AppRouteHandler<ListRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { mediaType, status, q, sort } = c.req.valid('query')

  const rows = db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.userId, user.id),
        mediaType ? eq(entries.mediaType, mediaType) : undefined,
        status ? eq(entries.status, status) : undefined,
        q ? titleContains(q) : undefined,
      ),
    )
    .orderBy(...orderFor(sort))
    .all()

  return c.json(toPublicEntries(rows), 200)
}

export const create: AppRouteHandler<CreateRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const body = c.req.valid('json')

  /**
   * O tipo saiu do enum do Zod quando virou linha de tabela (brief, 3.12),
   * então a borda deixou de recusar sozinha o que não existe. Sem isto o
   * pedido só falharia na chave estrangeira, como 500 — e mandar um tipo que
   * este servidor não tem é pedido inválido, não defeito nosso.
   */
  if (!mediaTypeExists(body.mediaType)) {
    return c.json({ message: 'Unknown media type' }, 400)
  }

  const { source, pileIds, ...campos } = body

  /**
   * Repetido no corpo é o mesmo pedido, não dois: o par (pilha, obra) é único
   * no schema, e recusar `[3, 3]` seria transformar um descuido de quem chama
   * numa falha que a tela teria de explicar sem ter como.
   */
  const targets = [...new Set(pileIds ?? [])]

  /**
   * Pilha desconhecida é 400 pelo mesmo motivo que tipo e provedor: a FK
   * falharia lá embaixo como 500.
   *
   * **Uma pilha de outra pessoa também é "desconhecida" aqui**, e não ganha
   * resposta própria: distinguir "não existe" de "não é sua" é o que deixaria
   * descobrir o acervo alheio por tentativa. E é 400, não 404 — o 404 desta
   * rota se leria como "não existe POST /api/entries".
   */
  if (ownedPilesAmong(targets, user.id).size !== targets.length) {
    return c.json({ message: 'Unknown pile' }, 400)
  }

  if (source) {
    /**
     * Provedor desconhecido é 400 pelo mesmo motivo que tipo desconhecido: a
     * FK de `external_ids.provider` falharia lá embaixo como 500, e mandar um
     * provedor que este servidor não tem é pedido inválido, não defeito nosso.
     */
    if (!providerBySlug(source.provider)) {
      return c.json({ message: 'Unknown provider' }, 400)
    }

    /**
     * A guarda de duplicata, e ela é REDE (brief, 3.10). A defesa principal é
     * a busca, que devolve `owned` e faz a tela desabilitar o resultado antes
     * do clique — o app não tem toast pra explicar uma falha depois dele. Aqui
     * só sobra o caso das duas abas clicando junto.
     */
    const alreadyHas = ownedByUser({
      userId: user.id,
      provider: source.provider,
      // O tipo da obra que está sendo criada: o id só identifica dentro dele.
      mediaType: body.mediaType,
      candidates: [source.externalId],
    })[source.externalId]

    if (alreadyHas !== undefined) {
      return c.json(
        {
          message: 'That title is already in your library',
          entryId: alreadyHas,
        },
        409,
      )
    }
  }

  /**
   * As três escritas nascem juntas, e a transação é o que impede o acerto pela
   * metade:
   *
   * - **`external_ids`**, sem o qual a obra veio do provedor e não sabe mais
   *   de onde veio — e o reparo dela, hoje, seria apagar e re-adicionar,
   *   levando progresso e log junto (brief, 3.11)
   * - **`pile_entries`**, porque escolher a pilha na folha é o mesmo gesto de
   *   adicionar a obra (brief, 3.17). Uma obra que nascesse fora da pilha
   *   escolhida seria pior que um erro: um acerto pela metade, sem nada na
   *   tela dizendo qual metade falhou
   *
   * O caminho de quem digita à mão sem pilha nenhuma passa por aqui também —
   * uma transação de uma escrita só, que é o preço de não ter dois caminhos
   * para a mesma criação.
   */
  const created = db.transaction((tx) => {
    const row = tx
      .insert(entries)
      .values({ ...campos, userId: user.id })
      .returning()
      .get()

    if (source) {
      tx.insert(externalIds)
        .values({
          entryId: row.id,
          provider: source.provider,
          externalId: source.externalId,
          /**
           * **O tipo faz parte da identidade externa** (07/09/2026): o id de um
           * provedor é único dentro do tipo, não entre tipos. Ele é o da obra
           * que acabou de nascer, porque é sob esse tipo que o id foi resolvido.
           */
          mediaType: row.mediaType,
        })
        .run()
    }

    appendToPiles(row.id, targets, tx)

    return row
  })

  /**
   * **Depois da transação e sem `await`.** A obra nasceu com um vínculo, então
   * já se sabe de onde vem a arte dela — e enchê-la agora é o que faz a
   * biblioteca abrir offline em vez de só a parte dela que alguém já rolou
   * (brief, 3.10).
   *
   * Adicionar continua sem esperar a rede: isto é disparado, não aguardado, e a
   * resposta 201 sai na mesma hora que saía antes.
   */
  if (source) {
    warmArtInBackground([
      {
        provider: source.provider,
        externalId: source.externalId,
        mediaType: created.mediaType,
      },
    ])
  }

  return c.json(toPublicEntry(created), 201)
}

export const getById: AppRouteHandler<GetByIdRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')

  const entry = db
    .select()
    .from(entries)
    .where(and(eq(entries.id, id), eq(entries.userId, user.id)))
    .get()

  if (!entry) {
    return c.json({ message: 'Entry not found' }, 404)
  }

  return c.json(toPublicEntry(entry), 200)
}

export const update: AppRouteHandler<UpdateRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')
  const body = c.req.valid('json')

  // `PATCH` é parcial, então só vale checar quando o tipo veio no corpo.
  if (body.mediaType !== undefined && !mediaTypeExists(body.mediaType)) {
    return c.json({ message: 'Unknown media type' }, 400)
  }

  const updated = db
    .update(entries)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(entries.id, id), eq(entries.userId, user.id)))
    .returning()
    .get()

  if (!updated) {
    return c.json({ message: 'Entry not found' }, 404)
  }

  /**
   * A obra recém-marcada como concluída sai das pilhas que pediram pra se
   * esvaziar sozinhas (brief, 3.17). A regra mora na feature de pilha; aqui só
   * se avisa que o status mudou.
   *
   * `body.status` e não `updated.status`: o gatilho é a ESCRITA, não o estado.
   * Uma obra já concluída que recebe um PATCH de nota continuaria batendo em
   * `updated.status === 'completed'` e tentaria sair de pilhas em que ela pode
   * ter sido posta de propósito depois — pôr à mão é uma escolha explícita, e
   * escolha explícita não se desfaz por efeito colateral de outra edição.
   */
  if (body.status === 'completed') {
    dropFromAutoClearingPiles(updated.id, user.id)
  }

  return c.json(toPublicEntry(updated), 200)
}

export const addProgress: AppRouteHandler<AddProgressRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')
  const { delta, occurredAt, origin } = c.req.valid('json')

  const result = recordProgress(drizzleEntriesRepository, {
    entryId: id,
    userId: user.id,
    delta,
    occurredAt: occurredAt ?? new Date(),
    origin: origin ?? 'manual',
  })

  if (!result.ok) {
    const { status, message } = progressFailureResponse[result.reason]
    return c.json({ message }, status)
  }

  return c.json(toPublicEntry(result.entry), 200)
}

export const remove: AppRouteHandler<RemoveRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')

  const deleted = db
    .delete(entries)
    .where(and(eq(entries.id, id), eq(entries.userId, user.id)))
    .returning({ id: entries.id })
    .get()

  if (!deleted) {
    return c.json({ message: 'Entry not found' }, 404)
  }

  return c.body(null, 204)
}

/**
 * Apaga a biblioteca inteira desta pessoa.
 *
 * **Um `DELETE` só, e o cascade faz o resto.** Escrever a limpeza das quatro
 * tabelas dependentes à mão aqui seria uma segunda declaração do que já está
 * no schema — e a que ficaria para trás no dia em que uma quinta tabela
 * pendurasse em `entries`.
 *
 * **A cláusula carrega `user_id`**, como toda escrita deste repo. Sem ela esta
 * rota apagaria o servidor inteiro em vez de uma conta.
 *
 * `returning` para contar o que de fato saiu: `changes` daria o mesmo número,
 * mas o número aqui é a resposta da tela, e é ele que precisa ser o que
 * aconteceu, não uma estimativa feita antes.
 */
export const removeAll: AppRouteHandler<RemoveAllRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const deleted = db
    .delete(entries)
    .where(eq(entries.userId, user.id))
    .returning({ id: entries.id })
    .all()

  return c.json({ deleted: deleted.length }, 200)
}

export const getHistory: AppRouteHandler<GetHistoryRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')
  const history = historyOf(id, user.id)

  if (!history) {
    return c.json({ message: 'Entry not found' }, 404)
  }

  return c.json(
    {
      startedAt: history.startedAt?.toISOString() ?? null,
      lastAt: history.lastAt?.toISOString() ?? null,
      events: history.events,
    },
    200,
  )
}
