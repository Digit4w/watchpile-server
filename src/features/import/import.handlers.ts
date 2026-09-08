import { eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { providers } from '../../db/schema/providers.js'
import type { AppRouteHandler } from '../../lib/types.js'
import { resolveCredential } from '../providers/providers.credentials.js'
import { anilistSource } from './import.anilist.js'
import { createApplier } from './import.apply.js'
import { csvSource } from './import.csv.js'
import * as jobs from './import.jobs.js'
import { malSource } from './import.mal.js'
import type {
  CancelRoute,
  ImportAnilistRoute,
  ImportCsvRoute,
  ImportMalRoute,
  StatusRoute,
} from './import.routes.js'
import { reconcileInterrupted, run } from './import.runner.js'
import type {
  ImportFailureKind,
  ImportMode,
  ImportProblem,
  ImportSource,
  ImportSourceSlug,
} from './import.types.js'

/**
 * As rotas do import (brief, 3.12).
 *
 * **Nenhuma delas é de admin**, e é decisão: import é conteúdo, e conteúdo é do
 * usuário (brief, 3.9). O que é da instalação — a chave do provedor — mora em
 * Settings, que já é guardado.
 */

/**
 * Teto do arquivo, em bytes.
 *
 * Existe pelo mesmo motivo do teto da capa de pilha: contra um cliente que não
 * seja o nosso. 20 MB comportam uma biblioteca de mais de cem mil linhas — o
 * limite prático do modelo é bem antes disso (brief, 3.12, sobre paginação).
 */
export const CSV_MAX_BYTES = 20 * 1024 * 1024

/**
 * JSON numa coluna de texto, e JSON quebrado não pode derrubar a tela: uma
 * linha ilegível vira o valor vazio e o resto responde. Mesma forma do
 * `parseParams` das notificações — falha nossa não vira tela quebrada quando há
 * resposta parcial honesta (design system, seção 8).
 */
function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed === null || typeof parsed !== 'object'
      ? fallback
      : (parsed as T)
  } catch {
    return fallback
  }
}

function toPublic(row: jobs.Job) {
  return {
    id: row.id,
    source: row.source as ImportSourceSlug,
    mode: row.mode,
    status: row.status,
    total: row.total,
    processed: row.processed,
    added: row.added,
    skipped: row.skipped,
    updated: row.updated,
    unmatched: row.unmatched,
    problemCount: row.problemCount,
    problems: parseJson<ImportProblem[]>(row.problems, []),
    errorKind: row.errorKind as ImportFailureKind | null,
    errorParams: row.errorKind
      ? parseJson<Record<string, string | number>>(row.errorParams, {})
      : null,
    cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }
}

/**
 * **A reconciliação de zumbis roda na LEITURA**, e é aqui e no start que ela
 * entra — mesma forma do reconciliador de condições de instância.
 *
 * Um boot hook pegaria o processo morto; isto pega também o executor que morreu
 * sozinho, de um `throw` que escapou. Sem alguém pra limpar, o índice único
 * parcial da `0035` — que existe pra proteger o servidor — trancaria a
 * instalação pra sempre depois de um `docker restart` infeliz.
 */
/**
 * O Client ID do MyAnimeList, resolvido pela cadeia de sempre — env > arquivo de
 * secret > banco > literal embutido.
 */
function malClientId(): string {
  const row = db
    .select({ credentialValues: providers.credentialValues })
    .from(providers)
    .where(eq(providers.slug, 'mal'))
    .get()

  return resolveCredential('mal', 'client_id', row?.credentialValues ?? {})
    .value
}

/**
 * O que esta instalação consegue importar agora.
 *
 * ── O AniList era `unverified` por uma CONSTANTE, e não por uma checagem ────
 * Ele nasceu desligado porque a fonte foi escrita **sem poder ser medida** —
 * eles desativaram a própria API em 07/09/2026 —, e essa cautela era minha, não
 * um fato que o servidor observasse: nada ali reagia à API voltar.
 *
 * **Ligado por decisão do dono, no mesmo dia.** O primeiro import de verdade
 * passa a ser a medição, e o raciocínio é o mesmo que fez o AniList voltar a ser
 * o provedor padrão: a indisponibilidade é temporária e do lado deles, e a
 * escolha de produto não se faz contra o estado de um dia ruim.
 *
 * **O risco assumido tem nome:** a FORMA da consulta é confiável (o servidor
 * deles valida GraphQL por inteiro, então query errada volta como erro
 * explícito), e o que pode estar errado é a LEITURA do envelope. Se estiver, o
 * import não grava nada torto — ele termina com "0 adicionadas", e o zero calado
 * é o modo de falha a vigiar.
 *
 * Enquanto a API estiver fora, clicar em `Import` falha com `source-down` e
 * avisa pelo sino, que é a resposta honesta: não há o que configurar.
 */
function sourcesOf() {
  return [
    { slug: 'csv' as const, available: true, reason: null },
    {
      slug: 'mal' as const,
      available: malClientId() !== '',
      reason: malClientId() !== '' ? null : ('not-configured' as const),
    },
    { slug: 'anilist' as const, available: true, reason: null },
  ]
}

export const status: AppRouteHandler<StatusRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  reconcileInterrupted()

  const running = jobs.running()
  const latest = jobs.latestFor(user.id)

  return c.json(
    {
      sources: sourcesOf(),
      running: running ? toPublic(running) : null,
      mine: running?.userId === user.id,
      latest: latest ? toPublic(latest) : null,
    },
    200,
  )
}

export const importCsv: AppRouteHandler<ImportCsvRoute> = async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const text = await c.req.text()

  if (text.trim() === '') {
    return c.json({ message: 'The request body is empty' }, 400)
  }

  // Em bytes, não em caracteres: um arquivo em japonês tem três bytes por
  // caractere, e o que o teto protege é a memória, não a contagem de letras.
  if (Buffer.byteLength(text, 'utf8') > CSV_MAX_BYTES) {
    return c.json({ message: 'The file is larger than the limit' }, 413)
  }

  reconcileInterrupted()

  const { mode } = c.req.valid('query')

  let job: jobs.Job
  try {
    job = jobs.start({ userId: user.id, source: 'csv', mode })
  } catch (error) {
    /**
     * **A recusa vem do BANCO**, do índice único parcial — não de um `SELECT`
     * antes do `INSERT`, que deixaria a corrida de pé. Só esta constraint pode
     * falhar aqui, e traduzi-la em 409 é o que faz "uma importação por vez"
     * chegar na tela como fato em vez de 500.
     */
    if (String(error).includes('UNIQUE constraint failed')) {
      return c.json(
        { message: 'An import is already running on this server' },
        409,
      )
    }
    throw error
  }

  /**
   * **Disparado sem `await`**: a rota responde 202 e sai, e o laço segue
   * rodando entre as requisições seguintes. `run` nunca rejeita — tudo que dá
   * errado vira `status = 'failed'` com um `kind` —, então não há
   * `unhandledRejection` esperando pra derrubar o processo num container.
   */
  void run(job.id, csvSource(text), createApplier(user.id), mode)

  return c.json(toPublic(job), 202)
}

export const cancel: AppRouteHandler<CancelRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')

  /**
   * **Uma resposta só para "não é seu" e para "já terminou"**, e é escolha de
   * privacidade, não preguiça: distinguir as duas diria a quem não é dono que
   * existe um job daquele id, e isso não é dela. Mesma forma do 400 de pilha
   * desconhecida em `POST /api/entries`.
   */
  if (!jobs.requestCancel(id, user.id)) {
    return c.json({ message: 'There is nothing of yours running to stop' }, 409)
  }

  const job = jobs.byId(id)
  if (!job) {
    return c.json({ message: 'There is nothing of yours running to stop' }, 409)
  }

  return c.json(toPublic(job), 200)
}

/**
 * O que as duas fontes de serviço compartilham, e ele recebe VALORES — não o
 * contexto do Hono.
 *
 * A primeira versão era uma fábrica que recebia o contexto e devolvia um
 * handler, com um tipo de contexto escrito à mão; o `tsc` recusou, e os `as`
 * que a fariam passar eram o sintoma. Quem sabe ler o pedido é o handler
 * tipado; o que se compartilha é a REGRA — o zumbi, o índice único e o disparo
 * sem `await`.
 *
 * Compartilhar importa: a segunda cópia é onde `reconcileInterrupted()` seria
 * esquecido, e o sintoma disso é a instalação travada depois de um restart.
 */
type StartOutcome =
  | { ok: true; job: jobs.Job }
  | { ok: false; status: 409 | 503; message: string }

function startFromProfile(
  userId: number,
  source: ImportSourceSlug,
  mode: ImportMode,
  built: ImportSource | { missing: string },
): StartOutcome {
  if ('missing' in built) {
    /**
     * **503 e não 500**: o pedido é válido e o servidor está bem — falta a
     * chave da instalação. É a mesma forma que a busca usa pra
     * `not-configured`, e a tela manda o admin pra Providers.
     */
    return {
      ok: false,
      status: 503,
      message: `This server has no ${built.missing} for that source yet`,
    }
  }

  reconcileInterrupted()

  let job: jobs.Job
  try {
    job = jobs.start({ userId, source, mode })
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed')) {
      return {
        ok: false,
        status: 409,
        message: 'An import is already running on this server',
      }
    }
    throw error
  }

  void run(job.id, built, createApplier(userId), mode)
  return { ok: true, job }
}

/**
 * **O AniList não pede credencial nenhuma** — perfil público é leitura aberta.
 *
 * **Esta fonte NÃO FOI MEDIDA**: eles desativaram a própria API em 07/09/2026, e
 * ela saiu da documentação mais a implementação do Yamtrack. A rota existe
 * porque `dev` com API sem consumidor é inofensivo, e porque escrevê-la agora é
 * o que torna a verificação um passo só quando eles voltarem. **A tela não a
 * oferece** até lá.
 */
export const importAnilist: AppRouteHandler<ImportAnilistRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { mode } = c.req.valid('query')
  const { username } = c.req.valid('json')

  const outcome = startFromProfile(
    user.id,
    'anilist',
    mode,
    anilistSource(username),
  )

  return outcome.ok
    ? c.json(toPublic(outcome.job), 202)
    : c.json({ message: outcome.message }, outcome.status)
}

/**
 * O MyAnimeList lê a lista pública com o Client ID da INSTALAÇÃO — não do
 * usuário. A precedência é a de sempre: env > arquivo de secret > banco >
 * literal embutido.
 */
export const importMal: AppRouteHandler<ImportMalRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { mode } = c.req.valid('query')
  const { username } = c.req.valid('json')

  const value = malClientId()

  const outcome = startFromProfile(
    user.id,
    'mal',
    mode,
    value ? malSource(username, value) : { missing: 'Client ID' },
  )

  return outcome.ok
    ? c.json(toPublic(outcome.job), 202)
    : c.json({ message: outcome.message }, outcome.status)
}
