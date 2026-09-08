import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { env } from '../../env.js'
import type { AppRouteHandler } from '../../lib/types.js'
import { sourceOf } from '../entries/entries.source.js'
import { bindingFor, providerBySlug } from '../providers/providers.query.js'
import { fetchArt } from './art.fetch.js'
import type { GetArtRoute } from './art.routes.js'
import { readArt, writeArt } from './art.store.js'

/**
 * O validador do cache: a chave da arte, que muda quando a arte muda.
 *
 * **O tipo entra aqui junto** (`0038`): sem ele, o anime `21` e o mangá `21` do
 * mesmo provedor devolveriam o mesmo `ETag`, e o navegador serviria do cache
 * dele a arte de um para o outro — o defeito sobreviveria ao conserto do banco,
 * uma camada acima.
 */
function etagFor(
  provider: string,
  externalId: string,
  mediaType: string,
): string {
  return `W/"${createHash('sha256')
    .update(`${provider} ${externalId} ${mediaType}`)
    .digest('hex')
    .slice(0, 16)}"`
}

/**
 * Serve a arte da obra — **cache de leitura** (brief, 3.10).
 *
 * Em disco, serve; fora, busca no provedor, grava e serve. **Uma rota, sem job
 * e sem varredura**, que é o "sob demanda, não em varredura" do brief ao pé da
 * letra.
 *
 * ── Por que enche AQUI, e não ao adicionar a obra ───────────────────────────
 * Adicionar não pode esperar a rede — a folha fecha na hora —, e buscar em
 * segundo plano pediria uma fila que este servidor não tem (brief, 3.1). Então
 * o cache enche **na primeira vez que a arte é pedida**, e a promessa honesta
 * é *"a arte que você já viu abre offline"*, não *"sua biblioteca inteira abre
 * offline"*.
 *
 * ── Por que a rota é por OBRA e o arquivo é da INSTÂNCIA ────────────────────
 * Quem diz se a pessoa pode ver é a obra, que tem dono. O que se guarda é por
 * (provedor, id externo), porque arte não é dado pessoal: duas contas com o
 * mesmo filme dividem um arquivo, e é isso que faz o teto valer pro servidor
 * inteiro em vez de por conta.
 */
export const getArt: AppRouteHandler<GetArtRoute> = async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')
  const { source } = c.req.valid('query')

  const entry = db
    .select({
      id: entries.id,
      mediaType: entries.mediaType,
      primaryProvider: entries.primaryProvider,
    })
    .from(entries)
    .where(and(eq(entries.id, id), eq(entries.userId, user.id)))
    .get()

  if (!entry) {
    return c.json({ message: 'Entry not found' }, 404)
  }

  /**
   * O `source` refina qual vínculo responde; sem ele, o efetivo.
   *
   * Passá-lo como se fosse o override da obra reusa a cadeia inteira em vez de
   * escrever uma segunda escolha aqui — e ganha de graça a regra que já existe
   * lá: vínculo que a obra não tem é **ignorado**, e a resposta volta a ser a
   * de sempre. Um `?source=` errado não vira 404 nem imagem quebrada.
   */
  const resolvedSource = sourceOf(entry.id, source ?? entry.primaryProvider)
  /**
   * Obra sem vínculo e obra inexistente respondem igual, pelo mesmo motivo da
   * capa de pilha: separá-las contaria quais ids existem na conta de outra
   * pessoa. O cliente também não precisa da diferença — `art` já vem nulo na
   * listagem quando não há de onde tirar.
   */
  if (!resolvedSource) {
    return c.json({ message: 'Entry not found' }, 404)
  }

  const etag = etagFor(
    resolvedSource.provider,
    resolvedSource.externalId,
    entry.mediaType,
  )
  if (c.req.header('if-none-match') === etag) {
    return c.body(null, 304)
  }

  let art = env.WATCHPILE_ART_CACHE
    ? readArt(
        resolvedSource.provider,
        resolvedSource.externalId,
        entry.mediaType,
      )
    : null

  if (!art) {
    const provider = providerBySlug(resolvedSource.provider)
    if (!provider) {
      return c.json({ message: 'Entry not found' }, 404)
    }

    const fetched = await fetchArt({
      provider,
      // Sem o par, a arte de uma SÉRIE vinha do detalhe do filme de mesmo id.
      binding: bindingFor(entry.mediaType, resolvedSource.provider),
      externalId: resolvedSource.externalId,
    })

    if (!fetched.ok) {
      /**
       * **404 para toda falha, e é decisão.** Isto é um `<img src>`: o
       * navegador não lê corpo de erro, não mostra mensagem e não tem como
       * explicar `rate-limited` a ninguém. O que a tela faz em qualquer um dos
       * casos é o mesmo — desenhar o ladrilho com a inicial —, e um 5xx só
       * encheria o console de vermelho para dizer a mesma coisa.
       *
       * O motivo não se perde: ele vai para o log do servidor, que é onde quem
       * hospeda vai procurar.
       */
      c.var.logger.info(
        {
          entryId: entry.id,
          provider: resolvedSource.provider,
          reason: fetched.reason,
        },
        'art unavailable',
      )
      return c.json({ message: 'Entry not found' }, 404)
    }

    if (env.WATCHPILE_ART_CACHE) {
      writeArt({
        provider: resolvedSource.provider,
        externalId: resolvedSource.externalId,
        mediaType: entry.mediaType,
        bytes: fetched.art.bytes,
        contentType: fetched.art.contentType,
      })
    }

    art = fetched.art
  }

  /**
   * `private` porque a rota é de uma conta, e um proxy compartilhado não pode
   * guardá-la. `max-age` longo, ao contrário da capa de pilha: a arte do
   * provedor **não se substitui neste endereço** — o vínculo é fixo, e trocar
   * de pôster no TMDB é evento raro que o `ETag` pega na revalidação seguinte.
   */
  return c.body(
    art.bytes.buffer.slice(
      art.bytes.byteOffset,
      art.bytes.byteOffset + art.bytes.byteLength,
    ) as ArrayBuffer,
    200,
    {
      'Content-Type': art.contentType,
      'Cache-Control': 'private, max-age=604800',
      ETag: etag,
    },
  )
}
