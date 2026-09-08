import { and, asc, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { externalIds } from '../../db/schema/external-ids.js'
import type { AppRouteHandler } from '../../lib/types.js'
import { warmArtInBackground } from '../art/art.warm.js'
import { providerBySlug, providersFor } from '../providers/providers.query.js'
import { ownedByUser } from '../search/search.query.js'
import type {
  CreateLinkRoute,
  ListLinksRoute,
  RemoveLinkRoute,
  SetPrimaryLinkRoute,
} from './entries.links.routes.js'
import { sourceOf } from './entries.source.js'

type OwnedEntry = {
  id: number
  mediaType: string
  primaryProvider: string | null
}

/**
 * A obra, se ela for de quem pediu.
 *
 * Devolve tipo e override juntos porque as rotas precisam dos dois — o tipo pra
 * saber se o provedor serve esta obra, o override pra resolver qual vínculo é o
 * efetivo — e uma segunda consulta pelo mesmo dado é como as duas ficam fora de
 * sincronia.
 */
function ownedEntry(id: number, userId: number): OwnedEntry | undefined {
  return db
    .select({
      id: entries.id,
      mediaType: entries.mediaType,
      primaryProvider: entries.primaryProvider,
    })
    .from(entries)
    .where(and(eq(entries.id, id), eq(entries.userId, userId)))
    .get()
}

/**
 * A lista de vínculos como o contrato a devolve.
 *
 * Uma função só porque **três rotas respondem a mesma forma** — listar,
 * promover e criar —, e três montagens do mesmo objeto é como uma esquece o
 * campo que as outras têm.
 */
function linksOf(entry: OwnedEntry) {
  const effective = sourceOf(entry.id, entry.primaryProvider)

  /**
   * Ordenado por antiguidade — a mesma ordem do desempate de `sourceOf`, e por
   * isso o vínculo marcado é o primeiro da lista sempre que não há override.
   * A caixa lê de cima pra baixo, e a marca não pula.
   */
  return db
    .select({
      provider: externalIds.provider,
      externalId: externalIds.externalId,
    })
    .from(externalIds)
    .where(eq(externalIds.entryId, entry.id))
    .orderBy(asc(externalIds.createdAt), asc(externalIds.id))
    .all()
    .map(({ provider, externalId }) => ({
      provider: {
        slug: provider,
        // O provedor não pode ter sumido: `external_ids.provider` é FK com
        // `onDelete: 'restrict'`. O `??` é pra borda do tipo, não pra um caso.
        name: providerBySlug(provider)?.name ?? provider,
      },
      externalId,
      effective:
        effective?.provider === provider && effective.externalId === externalId,
      chosen: entry.primaryProvider === provider,
    }))
}

export const listLinks: AppRouteHandler<ListLinksRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')
  const entry = ownedEntry(id, user.id)

  if (!entry) {
    return c.json({ message: 'Entry not found' }, 404)
  }

  return c.json(linksOf(entry), 200)
}

/**
 * Promover um vínculo a fonte da obra.
 *
 * A obra é relida DEPOIS da escrita, e não montada a partir do que se acabou de
 * gravar: `linksOf` resolve `effective` por `sourceOf`, e alimentá-lo com um
 * valor presumido seria a segunda conta que diverge da primeira.
 */
export const setPrimaryLink: AppRouteHandler<SetPrimaryLinkRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id, provider } = c.req.valid('param')
  const entry = ownedEntry(id, user.id)

  if (!entry) {
    return c.json({ message: 'Entry not found' }, 404)
  }

  /**
   * Promover exige que a obra ESTEJA vinculada àquele provedor. Sem a guarda, a
   * coluna aceitaria um provedor qualquer que existe na tabela, `sourceOf`
   * ignoraria o degrau, e a escrita teria sido aceita sem efeito nenhum — o
   * pior dos dois mundos, porque a tela diria que deu certo.
   */
  const linked = db
    .select({ id: externalIds.id })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.entryId, entry.id),
        eq(externalIds.provider, provider),
      ),
    )
    .get()

  if (!linked) {
    return c.json({ message: 'This title is not linked to that provider' }, 404)
  }

  db.update(entries)
    .set({ primaryProvider: provider })
    .where(eq(entries.id, entry.id))
    .run()

  return c.json(linksOf({ ...entry, primaryProvider: provider }), 200)
}

export const createLink: AppRouteHandler<CreateLinkRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')
  const { provider, externalId } = c.req.valid('json')
  const entry = ownedEntry(id, user.id)

  if (!entry) {
    return c.json({ message: 'Entry not found' }, 404)
  }

  if (!providerBySlug(provider)) {
    return c.json({ message: 'Unknown provider' }, 400)
  }

  /**
   * O provedor precisa servir o TIPO desta obra.
   *
   * Não é zelo: o id externo só é legível dentro de um par (tipo, provedor) —
   * `1396` é Breaking Bad em série e *Mirror* em filme no mesmo TMDB, defeito
   * que já apareceu rodando em 01/09/2026 e que fez `detail_path` mudar de
   * dono. Um vínculo criado fora do par nasceria ilegível: a tela de detalhe
   * pediria o id ao endpoint errado e mostraria outra obra.
   */
  const serves = providersFor(entry.mediaType).some(
    ({ provider: row }) => row.slug === provider,
  )

  if (!serves) {
    return c.json({ message: 'That provider does not serve this type' }, 400)
  }

  const alreadyLinked = db
    .select({ id: externalIds.id })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.entryId, entry.id),
        eq(externalIds.provider, provider),
      ),
    )
    .get()

  if (alreadyLinked) {
    return c.json({ message: 'This title is already linked to it' }, 409)
  }

  /**
   * O mesmo id externo já vinculado a OUTRA obra desta pessoa.
   *
   * **É rede, como em `POST /api/entries`** (brief, 3.10): a folha de vincular
   * lê o mapa `owned` da busca e desabilita o resultado antes do clique,
   * porque o app não tem toast pra explicar uma falha depois dele. Aqui sobra
   * o caso das duas abas.
   *
   * O `entryId` volta junto pra que a tela ainda consiga apontar pra obra que
   * já tem o vínculo, em vez de só dizer não.
   */
  const fromAnother = ownedByUser({
    userId: user.id,
    provider,
    // O tipo da obra a que se está vinculando — a guarda acima já exigiu que o
    // provedor sirva esse tipo, porque o id só é legível dentro do par.
    mediaType: entry.mediaType,
    candidates: [externalId],
  })[externalId]

  if (fromAnother !== undefined) {
    return c.json(
      {
        message: 'Another title in your library already claims it',
        entryId: fromAnother,
      },
      409,
    )
  }

  db.insert(externalIds)
    /**
     * O tipo é o da OBRA, e é o mesmo que a guarda acima já exigiu do provedor:
     * vincular a um provedor que não serve o tipo da obra é 400, porque o id só
     * é legível dentro do par. Aqui ele passa a ficar gravado (07/09/2026).
     */
    .values({
      entryId: entry.id,
      provider,
      externalId,
      mediaType: entry.mediaType,
    })
    .run()

  /**
   * O `effective` é recalculado DEPOIS da escrita, e não assumido.
   *
   * Desde 02/09/2026 a resposta é quase sempre `false` quando já havia vínculo:
   * **criar não promove**. O vínculo mais antigo continua falando, e trocar a
   * fonte é ato explícito — é isso que impede sinopse e arte de serem
   * reescritas sem ninguém pedir. `true` só no caso da obra que não tinha
   * nenhum, onde não há nada sendo substituído.
   */
  const created = linksOf(entry).find(
    (vínculo) => vínculo.provider.slug === provider,
  )

  if (!created) {
    // Inalcançável: o `INSERT` acabou de acontecer. O `throw` existe pra não
    // devolver um 201 com corpo inventado se algum dia deixar de ser.
    throw new Error(`Link ${provider} vanished right after being written`)
  }

  /**
   * **A arte do vínculo novo é buscada em segundo plano**, sem `await` (brief,
   * 3.10). A obra pode nunca ter tido de onde tirar arte — é o caso da digitada
   * à mão que acaba de ser vinculada —, e esperar alguém rolar até ela pra
   * descobrir isso deixaria a biblioteca sem arte offline por tempo indefinido.
   *
   * Vale mesmo quando o vínculo **não** é o efetivo: `?source=` serve a arte de
   * um vínculo específico, e a tela de detalhe pré-visualiza a troca de fonte —
   * os dois pedem exatamente esta arte.
   */
  warmArtInBackground([{ provider, externalId, mediaType: entry.mediaType }])

  return c.json(created, 201)
}

export const removeLink: AppRouteHandler<RemoveLinkRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id, provider } = c.req.valid('param')
  const entry = ownedEntry(id, user.id)

  if (!entry) {
    return c.json({ message: 'Entry not found' }, 404)
  }

  const deleted = db
    .delete(externalIds)
    .where(and(eq(externalIds.entryId, id), eq(externalIds.provider, provider)))
    .run()

  /**
   * O override some junto quando apontava pro vínculo que acabou de sair.
   *
   * `sourceOf` já ignora override órfão, então isto não muda o que a tela vê —
   * muda o que ela vê DEPOIS: sem a limpeza, revincular aquele mesmo provedor
   * mais tarde o promoveria sozinho, honrando uma escolha que a pessoa desfez
   * quando desvinculou.
   */
  if (deleted.changes > 0 && entry.primaryProvider === provider) {
    db.update(entries)
      .set({ primaryProvider: null })
      .where(eq(entries.id, id))
      .run()
  }

  /**
   * Desvincular o que não estava vinculado é 404 e não 204: o 204 diria que o
   * pedido teve efeito, e quem chamou com o provedor errado ficaria sem saber
   * que errou. Não é idempotência — é o alvo não existir.
   */
  if (deleted.changes === 0) {
    return c.json({ message: 'This title is not linked to that provider' }, 404)
  }

  return c.body(null, 204)
}
