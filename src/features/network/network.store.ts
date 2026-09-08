import { eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { settings } from '../../db/schema/settings.js'
import { env } from '../../env.js'
import { type Bind, type HostControl, resolveBind } from './network.bind.js'

/**
 * O endereço em que este processo REALMENTE subiu.
 *
 * Existe porque "precisa reiniciar" é uma afirmação sobre o processo, não sobre
 * o banco: sem guardar o que foi usado no boot, a tela teria que comparar a
 * configuração com ela mesma e nunca acharia diferença. Gravado uma vez, por
 * `startServer()`.
 */
let boundHost: string | null = null

export function rememberBound(host: string): void {
  boundHost = host
}

/** Em qual endereço este processo está escutando, ou nulo antes do boot. */
export function currentlyBound(): string | null {
  return boundHost
}

export function hostControl(): HostControl {
  return env.WATCHPILE_HOST_CONTROL
}

function storedHost(): string | null {
  return (
    db
      .select({ host: settings.bindHost })
      .from(settings)
      .where(eq(settings.id, 1))
      .get()?.host ?? null
  )
}

/**
 * O endereço que valeria se o servidor subisse AGORA.
 *
 * Comparado com `currentlyBound()`, é o que diz se há um reinício pendente.
 */
export function intendedBind(): Bind {
  return resolveBind({
    override: env.WATCHPILE_HOST,
    stored: storedHost(),
    control: hostControl(),
  })
}

export function storeHost(host: string): void {
  db.update(settings).set({ bindHost: host }).where(eq(settings.id, 1)).run()
}
