import type { AppRouteHandler } from '../../lib/types.js'
import { allowsRemote, hostFor, hostLock } from './network.bind.js'
import type { GetRoute, SetRoute } from './network.routes.js'
import {
  currentlyBound,
  hostControl,
  intendedBind,
  storeHost,
} from './network.store.js'

/**
 * O estado de rede como a tela precisa dele.
 *
 * **`host` é o que ESTÁ valendo e `intended` é o que valeria num boot** — os
 * dois são necessários porque a escrita não age na hora, e sem os dois a tela
 * não teria como dizer que há um reinício pendente sem guardar essa afirmação
 * por conta própria.
 */
function state() {
  const intended = intendedBind()
  const bound = currentlyBound() ?? intended.host
  const control = hostControl()

  return {
    host: bound,
    allowsRemote: allowsRemote(bound),
    intendedAllowsRemote: allowsRemote(intended.host),
    restartPending: bound !== intended.host,
    lock: hostLock(control, intended.source),
  }
}

export const get: AppRouteHandler<GetRoute> = (c) => {
  return c.json(state(), 200)
}

export const set: AppRouteHandler<SetRoute> = (c) => {
  const lock = hostLock(hostControl(), intendedBind().source)

  /**
   * A tela já desabilitou o controle com este motivo — o `lock` vem no `GET`.
   * Isto é a rede para quem fala com a API direto, e por isso a frase é curta:
   * quem chega aqui não está lendo uma tela.
   */
  if (lock === 'not-offered') {
    return c.json(
      { message: 'This installation does not decide its bind address here' },
      409,
    )
  }
  if (lock === 'set-by-environment') {
    return c.json({ message: 'WATCHPILE_HOST is set in the environment' }, 409)
  }

  storeHost(hostFor(c.req.valid('json').allowRemote))

  /**
   * Responde o estado NOVO, e nele `restartPending` já é verdadeiro — o
   * processo continua escutando onde subiu. É a resposta dizendo o que a
   * escrita fez e o que ela ainda não fez.
   */
  return c.json(state(), 200)
}
