import { rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/client.js'
import { artCache } from '../../db/schema/art-cache.js'
import { providerCache, providers } from '../../db/schema/providers.js'
import { titleSnapshots } from '../../db/schema/title-snapshots.js'
import { env } from '../../env.js'
import { resetLimiter } from '../providers/providers.limiter.js'
import { type ArtTarget, warmArt } from './art.warm.js'

/**
 * O aquecimento do cache de arte (brief, 3.10).
 *
 * **O que ele conserta foi medido na tela, não deduzido:** uma biblioteca
 * recém importada abria com um terço das cartas em branco, porque cada carta
 * pede a arte ao mesmo tempo e o limitador só serve a rajada.
 *
 * Ele nasceu no import e vale pros três chamadores — o import, a obra criada
 * com fonte e a obra que ganha vínculo depois —, e é por isso que ele mora aqui
 * e não lá.
 */

/** O detalhe do TMDB, com o campo que o `field_map` semeado lê. */
const DETAIL = JSON.stringify({
  id: 550,
  // O título entrou em 07/09/2026: sem ele o snapshot não grava, e metade do
  // que este laço faz deixaria de acontecer sem nada acusar.
  title: 'Fight Club',
  poster_path: '/pB8B.jpg',
})
const PIXEL = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08])

function target(over: Partial<ArtTarget> = {}): ArtTarget {
  return { provider: 'tmdb', externalId: '550', mediaType: 'movie', ...over }
}

/**
 * Um dublê que conta e responde as duas idas à rede de cada obra: o detalhe
 * (JSON) e a imagem (bytes).
 */
function fetchDouble() {
  const urls: string[] = []
  const impl: typeof fetch = async (input) => {
    const url = String(input)
    urls.push(url)
    if (url.includes('image.tmdb.org')) {
      return new Response(new Uint8Array(PIXEL), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      })
    }
    return new Response(DETAIL, { status: 200 })
  }
  return { impl, urls }
}

beforeEach(() => {
  db.delete(titleSnapshots).run()
  db.delete(artCache).run()
  db.delete(providerCache).run()
  db.update(providers)
    .set({ credentialValues: { api_key: 'chave-de-teste' } })
    .where(eq(providers.slug, 'tmdb'))
    .run()
  /**
   * **O MyAnimeList precisa de credencial aqui desde 08/09/2026**, e antes não
   * precisava: o Client ID embarcado no repositório o deixava configurado por
   * padrão, e o teste de colisão de id (`mal/21` anime × mangá) pegava carona
   * nisso sem dizer.
   *
   * A suíte passava por causa de uma chave de PRODUÇÃO, e é o tipo de
   * acoplamento que só aparece quando ela sai. O que o teste quer provar é a
   * colisão, não o que o produto embarca — então ele passa a declarar a
   * credencial que precisa, como o TMDB acima sempre fez.
   */
  db.update(providers)
    .set({ credentialValues: { client_id: 'chave-de-teste' } })
    .where(eq(providers.slug, 'mal'))
    .run()
  rmSync(env.WATCHPILE_ART_CACHE_PATH, { recursive: true, force: true })
  resetLimiter()
})

describe('o aquecimento', () => {
  it('grava a arte das obras importadas', async () => {
    const { impl } = fetchDouble()

    const gravadas = await warmArt([target()], impl)

    expect(gravadas).toBe(1)
    expect(db.select().from(artCache).all()).toHaveLength(1)
  })

  it('NÃO refaz o que já está em disco', async () => {
    const { impl, urls } = fetchDouble()
    await warmArt([target()], impl)
    const idas = urls.length

    await warmArt([target()], impl)

    // Nenhuma ida a mais: quem já tem arte **e** snapshot não paga cota de
    // novo. As duas condições, desde 07/09/2026 — ver `needsArt`/`needsSnapshot`.
    expect(urls.length).toBe(idas)
  })

  it('não deixa a arte do anime responder pela do mangá', async () => {
    /**
     * **É a colisão que `0037` fechou, um andar acima.** No MyAnimeList `21` é
     * o anime One Piece e o mangá Death Note; se o alvo fosse só (provedor, id),
     * o segundo sairia da lista por "já tem arte" e a carta dele mostraria o
     * pôster do primeiro — plausível, na coluna certa, sem erro nenhum.
     */
    const { impl } = fetchDouble()

    await warmArt(
      [
        target({ mediaType: 'movie', externalId: '21' }),
        target({ mediaType: 'tv', externalId: '21' }),
      ],
      impl,
    )

    // Duas obras diferentes, duas linhas — e não uma servindo as duas.
    expect(db.select().from(artCache).all()).toHaveLength(2)
  })

  it('alvo repetido é UMA ida, não duas', async () => {
    // Dois vínculos da mesma obra, ou a mesma obra vinda duas vezes de um CSV:
    // o dedupe é o que impede o aquecimento de pagar a cota duas vezes pelo
    // mesmo arquivo.
    const { impl, urls } = fetchDouble()

    const gravadas = await warmArt([target(), target()], impl)

    expect(gravadas).toBe(1)
    // Duas idas: o detalhe e a imagem. Não quatro.
    expect(urls).toHaveLength(2)
  })

  it('falha de uma obra não derruba as outras', async () => {
    // O import já terminou quando isto roda: uma CDN fora do ar não pode
    // interromper o aquecimento das obras seguintes.
    let primeira = true
    const impl: typeof fetch = async (input) => {
      if (primeira) {
        primeira = false
        throw new TypeError('fetch failed')
      }
      return String(input).includes('image.tmdb.org')
        ? new Response(new Uint8Array(PIXEL), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          })
        : new Response(DETAIL, { status: 200 })
    }

    const gravadas = await warmArt(
      [target({ externalId: '1' }), target({ externalId: '2' })],
      impl,
    )

    expect(gravadas).toBe(1)
  })

  it('provedor que não existe é ignorado, não é erro', async () => {
    const { impl, urls } = fetchDouble()

    const gravadas = await warmArt(
      [target({ provider: 'inexistente', externalId: '1' })],
      impl,
    )

    expect(gravadas).toBe(0)
    expect(urls).toHaveLength(0)
  })
})

/**
 * **O mesmo laço enche o snapshot da obra** — 07/09/2026.
 *
 * Ele é o que fecha o intervalo entre TER a obra e ABRIR a obra: sem isto, uma
 * biblioteca de quatrocentas obras recém importadas ficaria inteira sem
 * snapshot até alguém abrir cada uma, e o provedor caindo no dia seguinte a
 * deixaria inteira em recusa.
 *
 * E é de graça: as duas coisas saem da MESMA resposta de detalhe, que o
 * `provider_cache` já guardou quando a arte passou por aqui.
 */
describe('o aquecimento também grava o snapshot', () => {
  it('grava a obra junto com a arte', async () => {
    const { impl } = fetchDouble()

    await warmArt([target()], impl)

    const linhas = db.select().from(titleSnapshots).all()
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toMatchObject({
      provider: 'tmdb',
      externalId: '550',
      mediaType: 'movie',
      title: 'Fight Club',
    })
  })

  /**
   * **Duas perguntas, não uma.** Toda obra adicionada antes desta tabela tem
   * arte em disco e nenhum snapshot; uma condição só as pularia para sempre.
   */
  it('busca por uma obra que tem arte e não tem snapshot', async () => {
    const { impl, urls } = fetchDouble()
    await warmArt([target()], impl)
    db.delete(titleSnapshots).run()
    db.delete(providerCache).run()
    const idas = urls.length

    await warmArt([target()], impl)

    expect(urls.length).toBeGreaterThan(idas)
    expect(db.select().from(titleSnapshots).all()).toHaveLength(1)
  })

  /**
   * O id de um provedor é único DENTRO do tipo — a mesma colisão que a `0037` e
   * a `0038` tiraram de `external_ids` e de `art_cache`. Esta tabela nasceu
   * sabendo, e este teste é o que garante que ela continue sabendo.
   */
  it('não deixa o snapshot do anime responder pelo do mangá', async () => {
    const { impl } = fetchDouble()

    await warmArt(
      [
        target({ provider: 'mal', externalId: '21', mediaType: 'anime' }),
        target({ provider: 'mal', externalId: '21', mediaType: 'manga' }),
      ],
      impl,
    )

    expect(db.select().from(titleSnapshots).all()).toHaveLength(2)
  })
})
