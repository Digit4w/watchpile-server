import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { titleSnapshots } from '../../db/schema/title-snapshots.js'
import {
  detailFieldMapOf,
  fetchDetail,
  type MappedDetail,
  mapDetail,
} from '../providers/providers.detail.js'
import type { ProviderRow, TypeBinding } from '../providers/providers.query.js'

/**
 * O snapshot da obra — ler, gravar, e saber se já existe.
 *
 * A tabela e o porquê dela estão em `db/schema/title-snapshots.ts`. Aqui só
 * mora o acesso, e ele é deliberadamente pequeno: **quem decide quando gravar
 * são os dois caminhos que já tinham o detalhe na mão** — `resolveTitle`, que
 * responde a tela, e o aquecimento do cache de arte, que já busca o detalhe
 * para achar o pôster.
 */

/** A identidade inteira: o id de um provedor só é único DENTRO do tipo. */
export type SnapshotKey = {
  provider: string
  externalId: string
  mediaType: string
}

export type TitleSnapshot = {
  title: string
  year: number | null
  synopsis: string | null
  art: string | null
  total: number | null
  subtype: string | null
  score: number | null
  votes: number | null
  fetchedAt: Date
}

export function readSnapshot(key: SnapshotKey): TitleSnapshot | null {
  const row = db
    .select()
    .from(titleSnapshots)
    .where(
      and(
        eq(titleSnapshots.provider, key.provider),
        eq(titleSnapshots.externalId, key.externalId),
        eq(titleSnapshots.mediaType, key.mediaType),
      ),
    )
    .get()

  if (!row) {
    return null
  }

  return {
    title: row.title,
    year: row.year,
    synopsis: row.synopsis,
    art: row.art,
    total: row.total,
    subtype: row.subtype,
    score: row.score,
    votes: row.votes,
    fetchedAt: row.fetchedAt,
  }
}

/**
 * Se já há snapshot, **sem trazer o conteúdo** — o irmão de `hasArt`, e existe
 * pelo mesmo motivo que ele: o aquecimento pergunta isso por obra, e uma
 * pergunta que só precisa de sim ou não não deveria carregar uma sinopse
 * inteira pra memória a cada volta do laço.
 */
export function hasSnapshot(key: SnapshotKey): boolean {
  const row = db
    .select({ id: titleSnapshots.id })
    .from(titleSnapshots)
    .where(
      and(
        eq(titleSnapshots.provider, key.provider),
        eq(titleSnapshots.externalId, key.externalId),
        eq(titleSnapshots.mediaType, key.mediaType),
      ),
    )
    .get()

  return row !== undefined
}

/**
 * Grava o que o provedor acabou de dizer.
 *
 * **Toda resposta bem-sucedida escreve, e substitui a anterior inteira.** Não
 * há mesclagem campo a campo, e é decisão: uma sinopse que o provedor apagou
 * tem que sumir daqui também, senão o snapshot vira um acúmulo de tudo que já
 * foi verdade — que é pior que estar velho, porque nunca esteve certo junto.
 *
 * **`title` vazio não grava.** O mapeador devolve string vazia quando o caminho
 * do título não resolve, e uma linha com título em branco degradaria a tela pra
 * uma obra sem nome — que é menos legível que a recusa que o snapshot veio
 * evitar. Sem título não há o que preservar.
 */
export function writeSnapshot(
  key: SnapshotKey,
  fields: MappedDetail,
  now = new Date(),
): void {
  if (!fields.title) {
    return
  }

  const values = {
    title: fields.title,
    year: fields.year,
    synopsis: fields.synopsis,
    art: fields.art,
    total: fields.total,
    subtype: fields.subtype,
    score: fields.score,
    votes: fields.votes,
    fetchedAt: now,
  }

  db.insert(titleSnapshots)
    .values({ ...key, ...values })
    .onConflictDoUpdate({
      target: [
        titleSnapshots.provider,
        titleSnapshots.externalId,
        titleSnapshots.mediaType,
      ],
      set: values,
    })
    .run()
}

/**
 * Buscar o detalhe **só para gravar o snapshot**, sem ninguém olhando.
 *
 * ── Por que ele existe, quando `resolveTitle` já grava ──────────────────────
 * Porque `resolveTitle` só roda quando alguém ABRE a obra, e o snapshot precisa
 * existir antes disso: importar quatrocentas obras e o provedor cair no dia
 * seguinte deixaria a biblioteca inteira sem nada, porque nenhuma delas chegou a
 * ser aberta. É o mesmo intervalo que o aquecimento do cache de arte fecha — o
 * que vai entre **ter** a obra e **olhar** para ela.
 *
 * ── Por que ele não é uma ida à rede a mais ─────────────────────────────────
 * O aquecimento já busca o detalhe: é de lá que `fetchArt` tira o caminho do
 * pôster. Esta chamada acontece logo depois, com o mesmo par, e cai no
 * `provider_cache` que aquela acabou de encher. Quando a arte já está em disco e
 * só o snapshot falta, aí sim é uma requisição — e é a requisição certa, porque
 * é a única forma de saber o que o provedor diz.
 *
 * **Não é o cliente quem manda os campos.** Chegou a ser considerado — o
 * resultado da busca já tem título, ano, arte e subtipo, e mandá-los no `POST`
 * custaria zero rede. Duas coisas derrubaram: o snapshot é linha COMPARTILHADA
 * pela instalação inteira (a chave não tem dono), então um cliente qualquer
 * escreveria o que os outros leem; e o que a busca traz é metade do núcleo —
 * sem sinopse, sem total, sem nota. Aqui vem inteiro e vem do provedor.
 */
export async function captureSnapshot({
  provider,
  binding,
  externalId,
  mediaType,
  waitForTokenMs,
  fetchImpl,
}: {
  provider: ProviderRow
  binding?: TypeBinding | null
  externalId: string
  mediaType: string
  waitForTokenMs?: number
  fetchImpl?: typeof fetch
}): Promise<boolean> {
  const detail = await fetchDetail({
    provider,
    binding,
    externalId,
    waitForTokenMs,
    fetchImpl,
  })

  if (!detail.ok) {
    /**
     * **Falhar aqui não vira nova tentativa**, como no aquecimento da arte: a
     * rede de segurança é `resolveTitle`, que grava quando a pessoa finalmente
     * abrir a obra. Repetir gastaria cota de todo mundo por uma obra que talvez
     * ninguém abra.
     */
    return false
  }

  const map = detailFieldMapOf(provider, binding)
  const fields = mapDetail(detail.body, provider, externalId, map)

  writeSnapshot({ provider: provider.slug, externalId, mediaType }, fields)
  return true
}
