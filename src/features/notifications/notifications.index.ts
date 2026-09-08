import { createRouter } from '../../lib/create-app.js'
import * as handlers from './notifications.handlers.js'
import * as routes from './notifications.routes.js'

/**
 * Sem `adminMiddleware`, e é decisão e não esquecimento: a central é de quem
 * está logado. O que é do admin não é a ROTA, é a AUDIÊNCIA — a notificação de
 * instância só entra na consulta de quem tem `is_admin` (`visibleTo`, em
 * `notifications.store.ts`), porque quem não pode resolver a condição não deve
 * receber um sinal que não consegue apagar (brief, 3.9).
 *
 * Guardar a rota inteira por admin trancaria "o import terminou", que é de
 * quem importou.
 */
const router = createRouter()
  .openapi(routes.unreadCount, handlers.unreadCount)
  .openapi(routes.markRead, handlers.markRead)
  .openapi(routes.dismiss, handlers.dismiss)
  .openapi(routes.list, handlers.list)

export default router
