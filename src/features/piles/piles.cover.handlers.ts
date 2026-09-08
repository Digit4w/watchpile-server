import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { piles } from '../../db/schema/piles.js'
import type { AppRouteHandler } from '../../lib/types.js'
import {
  COVER_MAX_BYTES,
  COVER_TYPES,
  type GetCoverRoute,
  type PutCoverRoute,
  type RemoveCoverRoute,
} from './piles.cover.routes.js'
import { findPile, withDetails } from './piles.public.js'

type CoverType = (typeof COVER_TYPES)[number]

function isCoverType(value: string): value is CoverType {
  return (COVER_TYPES as readonly string[]).includes(value)
}

/**
 * O validador do cache.
 *
 * `updatedAt` e não um hash do BLOB: subir ou remover capa toca `updated_at`
 * junto, então a data já muda exatamente quando a imagem muda — e calcular um
 * hash de 40KB a cada requisição seria pagar para descobrir o que a linha já
 * sabe. Fraco (`W/`) porque não é o byte-a-byte do corpo, é um carimbo.
 */
function etagFor(id: number, updatedAt: Date): string {
  return `W/"${id}-${updatedAt.getTime()}"`
}

export const getCover: AppRouteHandler<GetCoverRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')

  /**
   * O BLOB só é lido AQUI, e é a única consulta do servidor que o toca —
   * `publicPileColumns` existe justamente pra que nenhuma outra o faça.
   */
  const row = db
    .select({
      cover: piles.cover,
      coverType: piles.coverType,
      updatedAt: piles.updatedAt,
    })
    .from(piles)
    .where(and(eq(piles.id, id), eq(piles.userId, user.id)))
    .get()

  /**
   * Pilha inexistente e pilha sem capa dão a mesma resposta, e é de propósito:
   * separá-las contaria a quem tem sessão quais ids existem na conta de outra
   * pessoa. O cliente não precisa da diferença — ele já sabe por `hasCover` se
   * deve pedir a imagem.
   */
  if (!row?.cover || !row.coverType) {
    return c.json({ message: 'Pile not found' }, 404)
  }

  const etag = etagFor(id, row.updatedAt)
  if (c.req.header('if-none-match') === etag) {
    return c.body(null, 304)
  }

  /**
   * `private` porque a capa é de uma conta, e um proxy compartilhado não pode
   * guardá-la. `must-revalidate` com `max-age=0` porque a imagem se substitui
   * no mesmo endereço: um `max-age` longo mostraria a capa antiga até expirar,
   * e o custo de revalidar contra um SQLite local é um 304 de alguns bytes.
   */
  return c.body(
    // `Buffer` é um `Uint8Array`, mas o `body` pede o `ArrayBuffer` puro — e a
    // fatia importa: um Buffer pequeno costuma ser uma VISTA sobre um pool
    // maior, e mandar `.buffer` inteiro vazaria bytes de outras alocações.
    row.cover.buffer.slice(
      row.cover.byteOffset,
      row.cover.byteOffset + row.cover.byteLength,
    ) as ArrayBuffer,
    200,
    {
      'Content-Type': row.coverType,
      'Cache-Control': 'private, max-age=0, must-revalidate',
      ETag: etag,
    },
  )
}

export const putCover: AppRouteHandler<PutCoverRoute> = async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')

  // O mime vem do header porque o corpo é cru. `split(';')` porque um cliente
  // pode mandar `image/webp; charset=binary`, que é sem sentido mas acontece.
  const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim()
  if (!contentType || !isCoverType(contentType)) {
    return c.json(
      { message: `Cover must be one of: ${COVER_TYPES.join(', ')}` },
      415,
    )
  }

  const bytes = Buffer.from(await c.req.arrayBuffer())

  /**
   * O teto é conferido depois de ler o corpo, e isso é aceitável **aqui**: o
   * servidor é local e o `Content-Length` de um cliente é uma afirmação, não
   * uma garantia — recusar por ele deixaria passar quem mentisse. O que
   * protege o processo de verdade é o limite de corpo do Hono, acima desta
   * camada; este número é o que protege o arquivo de banco.
   */
  if (bytes.byteLength > COVER_MAX_BYTES) {
    return c.json(
      { message: `Cover must be ${COVER_MAX_BYTES} bytes or smaller` },
      413,
    )
  }

  if (bytes.byteLength === 0) {
    // Corpo vazio não é "remover a capa" — remover tem verbo próprio. Aceitá-lo
    // aqui gravaria um BLOB de zero bytes que `hasCover` chamaria de capa.
    return c.json({ message: 'Cover cannot be empty' }, 415)
  }

  const updated = db
    .update(piles)
    .set({ cover: bytes, coverType: contentType, updatedAt: new Date() })
    .where(and(eq(piles.id, id), eq(piles.userId, user.id)))
    .returning({ id: piles.id })
    .get()

  if (!updated) {
    return c.json({ message: 'Pile not found' }, 404)
  }

  // Relê pela forma pública em vez de devolver o que acabou de escrever: é o
  // que garante que o BLOB não volte no JSON por descuido.
  const pile = findPile(id, user.id)
  if (!pile) {
    return c.json({ message: 'Pile not found' }, 404)
  }

  return c.json(withDetails(pile), 200)
}

export const removeCover: AppRouteHandler<RemoveCoverRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')

  /**
   * Os dois campos caem juntos — eles são `NULL` ou têm valor, nunca um só.
   * Um `coverType` órfão faria `GET /{id}/cover` responder 404 de um jeito e
   * `hasCover` dizer outro.
   *
   * Tirar a capa **não** é erro quando não havia nenhuma: a tela chama isto
   * quando a pessoa clica em `Remove`, e o resultado pedido é "esta pilha não
   * tem capa", que já é verdade. O que muda é só a pilha existir ou não.
   */
  const updated = db
    .update(piles)
    .set({ cover: null, coverType: null, updatedAt: new Date() })
    .where(and(eq(piles.id, id), eq(piles.userId, user.id)))
    .returning({ id: piles.id })
    .get()

  if (!updated) {
    return c.json({ message: 'Pile not found' }, 404)
  }

  const pile = findPile(id, user.id)
  if (!pile) {
    return c.json({ message: 'Pile not found' }, 404)
  }

  return c.json(withDetails(pile), 200)
}
