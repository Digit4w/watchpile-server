import { createHash } from 'node:crypto'
import { and, eq, lt, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { providerCache } from '../../db/schema/providers.js'

/**
 * Quanto tempo uma resposta de busca continua valendo.
 *
 * Seis horas é longo pra uma busca e curto pra um catálogo: título novo no TMDB
 * aparece no mesmo dia, e ninguém procura duas vezes a mesma coisa em seis
 * horas esperando resultado diferente. O número mora aqui e não na definição
 * porque ainda não há provedor que precise de outro — quando houver, ele vira
 * campo e este vira o default.
 */
const TTL_MS = 6 * 60 * 60 * 1000

/**
 * A chave da entrada: caminho + query resolvida, **sem a credencial**.
 *
 * Tirar a credencial é as duas coisas ao mesmo tempo:
 *
 * - **correção** — rotacionar a chave não invalida respostas que continuam
 *   válidas, e o cache existe justamente pra proteger a cota
 * - **segurança** — no TMDB a chave viaja na query, e gravá-la aqui a copiaria
 *   pra uma segunda tabela do banco. O brief é explícito em manter a credencial
 *   num lugar só, write-only na API
 *
 * As OPÇÕES ficam, e isso não contradiz o brief: o que ele decidiu é que elas
 * são da instância pra que a chave não se multiplique **por usuário**. Sendo
 * constantes entre usuários, keyar pela query resolvida continua dando uma
 * entrada por consulta — e é o que mantém o cache honesto quando o admin troca
 * o idioma dos metadados.
 *
 * Os parâmetros vão ordenados: a mesma consulta montada em ordem diferente é a
 * mesma consulta, e sem ordenar viraria duas entradas.
 *
 * ── O CORPO entra na chave — 02/09/2026 ────────────────────────────────────
 * Com `POST`, a URL para de identificar a consulta: o AniList atende tudo em
 * `POST /`, e o IGDB atende toda busca de jogo em `POST /v4/games`. Sem o
 * corpo, a primeira busca cachearia a resposta e **toda busca seguinte
 * receberia o resultado dela** — o defeito mais silencioso possível, porque a
 * tela mostra resultados plausíveis para a palavra errada.
 *
 * Vai como HASH e não literal, pelo mesmo motivo do nome de arquivo do cache de
 * arte: o corpo carrega uma consulta GraphQL inteira, e a chave é coluna de
 * chave primária, não lugar de guardar meio kilobyte por linha.
 *
 * **Só quando há corpo**, e isso não é economia: um sufixo constante em `GET`
 * mudaria toda chave já gravada, esvaziando o cache dos quatro provedores atuais
 * numa mudança que não é sobre eles.
 */
export function cacheKeyFor(
  url: string,
  credentialParam: string | null,
  body?: string,
): string {
  const parsed = new URL(url)
  if (credentialParam) {
    parsed.searchParams.delete(credentialParam)
  }
  parsed.searchParams.sort()
  const base = `${parsed.pathname}?${parsed.searchParams.toString()}`
  if (!body) {
    return base
  }
  return `${base}#${createHash('sha256').update(body).digest('hex')}`
}

/** O corpo cru guardado, ou `null` se não há entrada válida. */
export function readCache(
  providerSlug: string,
  requestKey: string,
  now = new Date(),
): string | null {
  const row = db
    .select()
    .from(providerCache)
    .where(
      and(
        eq(providerCache.providerSlug, providerSlug),
        eq(providerCache.requestKey, requestKey),
      ),
    )
    .get()

  if (!row) {
    return null
  }

  // Expirada é o mesmo que ausente pra quem lê. A linha morta sai na próxima
  // escrita (o `INSERT OR REPLACE` a substitui) ou na limpeza — apagá-la aqui
  // faria uma leitura virar escrita, e leitura é o caminho quente.
  return row.expiresAt.getTime() > now.getTime() ? row.body : null
}

export function writeCache(
  providerSlug: string,
  requestKey: string,
  body: string,
  now = new Date(),
): void {
  db.insert(providerCache)
    .values({
      providerSlug,
      requestKey,
      body,
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + TTL_MS),
    })
    // A mesma consulta feita de novo depois de expirar substitui a linha velha
    // em vez de criar uma segunda — a chave primária é (provedor, consulta).
    .onConflictDoUpdate({
      target: [providerCache.providerSlug, providerCache.requestKey],
      set: {
        body,
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + TTL_MS),
      },
    })
    .run()
}

/**
 * Joga fora o que já venceu.
 *
 * **Chamada oportunista, na escrita**, e não por timer: um `setInterval` num
 * processo que também roda dentro do Electron é trabalho acontecendo com a
 * janela fechada. Quem escreve no cache já está numa requisição lenta, e uma
 * deleção por índice não se soma a ela de forma perceptível.
 */
export function pruneExpired(now = new Date()): number {
  return db.delete(providerCache).where(lt(providerCache.expiresAt, now)).run()
    .changes
}

/**
 * Esquece tudo de um provedor.
 *
 * Chamada quando a configuração dele muda: trocar a credencial ou uma opção
 * pode mudar o que ele responde, e servir a resposta antiga faria o admin achar
 * que salvar não teve efeito — a mesma família de erro que o campo travado por
 * env evita do outro lado.
 */
export function forgetProvider(providerSlug: string): number {
  return db
    .delete(providerCache)
    .where(eq(providerCache.providerSlug, providerSlug))
    .run().changes
}

export type ProviderCacheUsage = {
  responses: number
  bytes: number
}

/**
 * Quantas respostas o cache guarda, e quanto elas ocupam.
 *
 * O tamanho sai de `length(cast(body as blob))` porque `length()` sobre texto
 * conta CARACTERES no SQLite, e a sinopse de uma obra é cheia de acentuada —
 * o número mostrado na tela seria menor que o do disco, sem dizer por quê.
 *
 * **Conta a linha vencida junto.** Ela ainda ocupa espaço até alguém escrever
 * por cima, e é justamente ela que quem clica em "limpar" quer ver ir embora.
 */
export function providerCacheUsage(): ProviderCacheUsage {
  const row = db
    .select({
      responses: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(length(cast(${providerCache.body} as blob))), 0)`,
    })
    .from(providerCache)
    .get()

  return { responses: row?.responses ?? 0, bytes: row?.bytes ?? 0 }
}

/**
 * Esquece tudo, de todos os provedores.
 *
 * **É seguro por natureza, e é isso que o separa das ações destrutivas:** o
 * cache é derivado, e a próxima busca o reconstrói. O que se paga é cota de
 * requisição — que é compartilhada por quem usa este servidor, e é por isso
 * que a ação é do admin (brief, 3.9).
 */
export function forgetEverything(): ProviderCacheUsage {
  const usage = providerCacheUsage()
  db.delete(providerCache).run()
  return usage
}
