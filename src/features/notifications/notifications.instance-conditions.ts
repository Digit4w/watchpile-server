import { inArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { mediaTypeProviders } from '../../db/schema/media-type-providers.js'
import { providers } from '../../db/schema/providers.js'
import { resolveCredential } from '../providers/providers.credentials.js'
import { checkIfStale, updateState } from '../updates/updates.store.js'
import { dedupeKey, type NotificationKind } from './notifications.kinds.js'
import * as store from './notifications.store.js'

/**
 * As condições de INSTÂNCIA que o produto sabe detectar hoje, reconciliadas
 * contra o que está no banco.
 *
 * ── Por que reconciliar na LEITURA, e não num job ──────────────────────────
 * Mesma forma do cache de arte (brief, 3.10): uma rota, sem job e sem
 * varredura. O servidor é um arquivo SQLite local e a conta é sobre meia dúzia
 * de linhas — um agendador seria uma peça a manter, a testar e a desligar no
 * Electron, pra responder uma pergunta que a leitura já faz.
 *
 * **Só reconcilia quando quem lê é admin**, porque só ele vê notificação de
 * instância (brief, 3.9). Numa instalação onde nenhum admin abre o app, a
 * condição não é emitida — e também não seria vista, então não há nada a
 * perder.
 *
 * ── Por que isto NÃO substitui o contador da coluna de Settings ─────────────
 * A régua do "em uso" é a mesma dos dois lados — provedor que serve algum tipo,
 * porque provedor sem tipo é *ocioso, não quebrado* (brief, 3.10) —, e mesmo
 * assim as duas peças ficam separadas. O motivo é do design system (seção 5,
 * 31/08): **notificação é evento e se dispensa; condição é estado e não.** Se o
 * selo da coluna passasse a contar notificação aberta, o admin dispensaria o
 * aviso e o selo apagaria com a chave ainda faltando — que é exatamente o
 * defeito que aquela decisão veio evitar.
 *
 * Duas contas da mesma regra é como uma fica pra trás (seção 8), então a
 * duplicação fica registrada aqui em vez de ficar implícita: se o recorte de
 * "em uso" mudar, muda nos dois.
 */

/** O prefixo cobre os dois `kind` de propósito — ver `reconcile` abaixo. */
const PREFIX = 'instance:provider-'

/**
 * A atualização tem prefixo PRÓPRIO, e isso não é arrumação.
 *
 * `dismissResolved` dispensa tudo que casa o prefixo e não está entre as
 * condições verdadeiras. Com um prefixo só, o reconcile de provedores
 * dispensaria o aviso de versão nova — e vice-versa — porque cada metade só
 * conhece as suas condições. **Dois assuntos, duas varreduras.**
 */
const UPDATE_PREFIX = 'instance:update-'

type Condition = {
  kind: NotificationKind
  subject: string
  params: Record<string, string | number>
}

/**
 * Pura de propósito: a decisão de o que é condição não depende do relógio nem
 * do que já está gravado, e é isso que a torna testável sem banco de escrita.
 */
export function conditionsOf(
  list: {
    slug: string
    name: string
    servesAnyType: boolean
    credentialSources: string[]
  }[],
): Condition[] {
  const out: Condition[] = []

  for (const provider of list) {
    if (!provider.servesAnyType) {
      continue
    }

    const params = { provider: provider.name, providerSlug: provider.slug }

    /**
     * Faltar vence estar na embutida, e não é ordem arbitrária: sem chave a
     * busca daquele tipo **não funciona**; na embutida ela funciona e o limite
     * é compartilhado. Dois avisos pro mesmo provedor diriam a mesma coisa
     * duas vezes, e o mais grave é o que precisa ser lido.
     */
    if (provider.credentialSources.includes('none')) {
      out.push({ kind: 'provider-missing-key', subject: provider.slug, params })
      continue
    }

    if (provider.credentialSources.includes('embedded')) {
      out.push({
        kind: 'provider-embedded-key',
        subject: provider.slug,
        params,
      })
    }
  }

  return out
}

/** Lê os provedores no formato que `conditionsOf` espera. */
function readProviders() {
  const rows = db.select().from(providers).all()
  if (rows.length === 0) {
    return []
  }

  const joins = db
    .select({ providerSlug: mediaTypeProviders.providerSlug })
    .from(mediaTypeProviders)
    .where(
      inArray(
        mediaTypeProviders.providerSlug,
        rows.map((p) => p.slug),
      ),
    )
    .all()

  const serving = new Set(joins.map((j) => j.providerSlug))

  return rows.map((provider) => ({
    slug: provider.slug,
    name: provider.name,
    servesAnyType: serving.has(provider.slug),
    credentialSources: provider.credentials.map(
      (spec) =>
        resolveCredential(provider.slug, spec.key, provider.credentialValues)
          .source,
    ),
  }))
}

/**
 * Emite o que virou verdade e dispensa o que deixou de ser.
 *
 * As duas metades usam **um prefixo só**, que cobre `provider-missing-key` e
 * `provider-embedded-key` juntos. É o que faz um provedor que sai de "sem
 * chave" pra "na embutida" trocar de aviso em vez de acumular dois: o primeiro
 * some porque a chave dele não está mais entre as verdadeiras.
 *
 * Emitir antes de dispensar não muda o resultado, e a ordem escolhida é a que
 * nunca deixa o painel vazio no meio: quem olhar entre as duas escritas vê o
 * aviso novo já lá, não um instante sem nada.
 */
export function reconcileInstanceConditions(): void {
  reconcileProviders()
  reconcileUpdate()
}

/**
 * A versão nova, derivada de ESTADO e sem tocar na rede.
 *
 * Quem consulta o GitHub é `checkIfStale`, que dispara e **não é esperado**:
 * isto aqui roda em toda leitura de admin, e uma condição que dependesse de
 * `fetch` faria o sino — que é chrome — esperar a internet pra abrir.
 *
 * **O sujeito da chave é a VERSÃO**, não uma constante. É o que faz o aviso
 * nascer uma vez por versão e se dispensar sozinho ao atualizar: depois do
 * upgrade a condição some, porque a instalada deixou de ser mais velha.
 */
function reconcileUpdate(): void {
  checkIfStale()

  const state = updateState()
  const open = new Set(store.openKeys(UPDATE_PREFIX))

  const keys: string[] = []
  if (state.enabled && state.updateAvailable && state.latest) {
    const key = dedupeKey('instance', 'update-available', state.latest)
    keys.push(key)

    if (!open.has(key)) {
      store.emit({
        audience: 'instance',
        /** Nada está quebrado: o degrau neutro, como `import-finished`. */
        severity: 'info',
        kind: 'update-available',
        params: { version: state.latest, url: state.latestUrl ?? '' },
        dedupeKey: key,
      })
    }
  }

  store.dismissResolved(UPDATE_PREFIX, keys)
}

function reconcileProviders(): void {
  const conditions = conditionsOf(readProviders())
  const already = new Set(store.openKeys(PREFIX))

  for (const condition of conditions) {
    const key = dedupeKey('instance', condition.kind, condition.subject)
    /**
     * Pular o que já está aberto é economia com um motivo visível: em SQLite o
     * `onConflictDoNothing` **consome o autoincrement mesmo sem inserir**, e
     * isto roda em toda leitura de admin. Sem o `if`, os ids saltavam de quatro
     * em quatro entre duas notificações de verdade — visto rodando.
     *
     * Quem garante a unicidade continua sendo o índice, não este `if`: duas
     * requisições concorrentes passariam as duas por aqui.
     */
    if (already.has(key)) {
      continue
    }

    store.emit({
      audience: 'instance',
      severity: 'warning',
      kind: condition.kind,
      params: condition.params,
      dedupeKey: key,
    })
  }

  store.dismissResolved(
    PREFIX,
    conditions.map((c) => dedupeKey('instance', c.kind, c.subject)),
  )
}
