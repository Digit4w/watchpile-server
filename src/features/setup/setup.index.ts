import { createRouter } from '../../lib/create-app.js'
import { adminMiddleware } from '../../middlewares/admin.js'
import * as handlers from './setup.handlers.js'
import * as routes from './setup.routes.js'

const router = createRouter()

/**
 * **`/status` e `/account` são abertos; `/instance` é do admin.**
 *
 * Os dois primeiros não têm como ser gateados: `/status` é o que a tela lê para
 * saber se existe login a fazer, e `/account` roda num banco sem usuário —
 * exigir sessão de quem vai criar o primeiro usuário é um beco. O que os
 * protege é o próprio estado: os dois recusam quando já houve alguém.
 *
 * `/instance` corre depois de o admin existir, então ali a guarda vale, e vale
 * inteira: sem sessão é 401, com sessão sem cargo é 403 (`middlewares/admin.ts`).
 */
router.use('/instance', adminMiddleware())

router
  .openapi(routes.status, handlers.status)
  .openapi(routes.account, handlers.account)
  .openapi(routes.instance, handlers.instance)

export default router
