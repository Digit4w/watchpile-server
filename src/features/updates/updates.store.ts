import { eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { settings } from '../../db/schema/settings.js'
import { APP_VERSION } from '../../lib/version.js'
import { isNewer } from './updates.compare.js'
import { readReleases } from './updates.feed.js'

/** Uma vez por dia. Release não sai de hora em hora, e a cota anônima do GitHub
 * é por IP — uma consulta diária cabe nela com folga mesmo num NAT com várias
 * instalações atrás. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export type UpdateState = {
  /** A versão deste servidor. Nula quando o layout não trouxe o `package.json`. */
  current: string | null
  enabled: boolean
  /** A mais nova que a última consulta viu — **mesmo que não seja mais nova
   * que a instalada**. Guardar só quando há novidade faria a tela não ter o
   * que dizer no caso comum, que é "você está em dia". */
  latest: string | null
  latestUrl: string | null
  checkedAt: Date | null
  /** A conta que a tela **não** refaz: quem compara é o servidor. */
  updateAvailable: boolean
}

function row() {
  return db.select().from(settings).where(eq(settings.id, 1)).get()
}

export function updateState(): UpdateState {
  const s = row()
  const latest = s?.updateLatestVersion ?? null

  return {
    current: APP_VERSION,
    enabled: s?.updateCheckEnabled ?? true,
    latest,
    latestUrl: s?.updateLatestUrl ?? null,
    checkedAt: s?.updateCheckedAt ?? null,
    updateAvailable:
      latest !== null && APP_VERSION !== null && isNewer(latest, APP_VERSION),
  }
}

export function setCheckEnabled(enabled: boolean): void {
  db.update(settings)
    .set({ updateCheckEnabled: enabled })
    .where(eq(settings.id, 1))
    .run()

  /**
   * Desligar **esquece o que já foi visto**. Sem isso, a instalação continuaria
   * mostrando "há a versão 0.2.0" pra sempre, a partir de uma consulta que a
   * pessoa acabou de dizer que não queria — e a notificação nascida daquela
   * consulta continuaria de pé, porque a condição segue verdadeira. Desligar é
   * o gesto de não querer saber, e ele tem que apagar a resposta junto com a
   * pergunta.
   */
  if (!enabled) {
    db.update(settings)
      .set({ updateLatestVersion: null, updateLatestUrl: null })
      .where(eq(settings.id, 1))
      .run()
  }
}

/**
 * Consulta o feed e grava o que achou.
 *
 * **Carimba `checkedAt` mesmo quando falha**, e é o ponto: sem isso uma
 * instalação sem rede tentaria a cada leitura do sino, que é exatamente o que a
 * cadência existe pra evitar. O preço é que uma queda momentânea adia a próxima
 * tentativa em um dia — e a tela tem o botão de conferir agora, que é o
 * caminho de quem está esperando por uma versão.
 */
export async function runCheck(fetchImpl: typeof fetch = fetch): Promise<void> {
  const result = await readReleases(fetchImpl)
  const now = new Date()

  if (!result.ok) {
    db.update(settings)
      .set({ updateCheckedAt: now })
      .where(eq(settings.id, 1))
      .run()
    return
  }

  /**
   * A mais nova por VERSÃO, e não a primeira da lista: a API ordena por data de
   * criação, e o CI deste produto reaproveita uma release existente quando a
   * `main` é repromovida sem subir a versão.
   */
  let newest: { version: string; url: string } | null = null
  for (const release of result.releases) {
    if (!newest || isNewer(release.version, newest.version)) {
      newest = release
    }
  }

  db.update(settings)
    .set({
      updateCheckedAt: now,
      updateLatestVersion: newest?.version ?? null,
      updateLatestUrl: newest?.url ?? null,
    })
    .where(eq(settings.id, 1))
    .run()
}

/**
 * Dispara uma consulta se a última for velha — **e não espera por ela**.
 *
 * Chamado de onde as notificações de instância são reconciliadas, que é a
 * leitura que todo admin faz ao abrir o app. Mesma forma do cache de arte
 * (brief, 3.10): uma leitura que se reconcilia, sem job e sem varredura — um
 * agendador seria uma peça a manter, a testar e a desligar no Electron.
 *
 * **A consequência é assumida e é honesta:** a leitura que encontra o cache
 * velho ainda responde com o dado velho, e a versão nova aparece na leitura
 * seguinte. Esperar pela rede faria o sino — que é chrome — depender da
 * internet pra abrir.
 */
export function checkIfStale(fetchImpl: typeof fetch = fetch): void {
  const s = row()
  if (!s?.updateCheckEnabled) {
    return
  }

  const last = s.updateCheckedAt?.getTime() ?? 0
  if (Date.now() - last < MAX_AGE_MS) {
    return
  }

  /**
   * O `catch` é obrigatório mesmo com `runCheck` já engolindo a falha de rede:
   * sem dono, uma rejeição vinda do banco vira `unhandledRejection` e mata o
   * processo por causa de uma checagem de versão. É a mesma régua do
   * aquecimento do cache de arte.
   */
  void runCheck(fetchImpl).catch(() => {})
}
