import type { MiddlewareHandler } from 'hono'
import type { AppBindings } from '../lib/types.js'

/**
 * A guarda de admin — a primeira do projeto, nascida com a tela de Settings
 * (brief, 3.9).
 *
 * **Esconder o item na navegação do cliente não é proteção.** O cliente é
 * agnóstico de host e qualquer um fala HTTP com esta API: sem isto, um usuário
 * comum criaria tipo de mídia com um `curl`. É por isso que a guarda nasce no
 * servidor, e no mesmo ciclo da primeira tela que precisa dela.
 *
 * **401 e 403 são coisas diferentes, e a diferença importa pra tela.** Sem
 * sessão é 401, e o cliente manda pro login; com sessão e sem cargo é 403, e o
 * cliente mostra "isto é do admin deste servidor" — mandar essa pessoa pro
 * login seria dizer que ela entrou errado, quando ela entrou certo.
 *
 * Depende de `sessionMiddleware` ter rodado antes: é ele quem popula
 * `c.get('user')`. Ordem invertida faria esta guarda recusar todo mundo.
 */
export function adminMiddleware(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const user = c.get('user')

    if (!user) {
      return c.json({ message: 'No active session' }, 401)
    }

    if (!user.isAdmin) {
      return c.json({ message: 'This is set by the server admin' }, 403)
    }

    await next()
  }
}
