import type { AppRouteHandler } from '../../lib/types.js'
import type {
  CheckNowRoute,
  GetUpdatesRoute,
  SetCheckRoute,
} from './updates.routes.js'
import { runCheck, setCheckEnabled, updateState } from './updates.store.js'

/** A data vai como ISO, porque o contrato é JSON e `Date` não atravessa. */
function shape() {
  const state = updateState()
  return { ...state, checkedAt: state.checkedAt?.toISOString() ?? null }
}

export const getUpdates: AppRouteHandler<GetUpdatesRoute> = (c) => {
  return c.json(shape(), 200)
}

export const setCheck: AppRouteHandler<SetCheckRoute> = (c) => {
  setCheckEnabled(c.req.valid('json').enabled)
  return c.json(shape(), 200)
}

export const checkNow: AppRouteHandler<CheckNowRoute> = async (c) => {
  if (!updateState().enabled) {
    return c.json({ message: 'Update checking is turned off' }, 409)
  }

  /**
   * **Este é o único caminho que ESPERA a rede**, e é o que separa "conferir
   * agora" da reconciliação: lá o sino não pode ficar preso na internet, aqui
   * a pessoa apertou um botão e está olhando pra ele.
   *
   * Falha de rede não vira erro HTTP: `runCheck` já a engole e carimba a data,
   * e a resposta é o estado — a tela lê "conferido agora, nada novo" da mesma
   * forma nos dois casos. Distinguir pediria vocabulário de falha que a tela
   * não usaria pra nada além de uma frase.
   */
  await runCheck()
  return c.json(shape(), 200)
}
