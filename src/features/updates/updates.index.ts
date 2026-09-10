import { createRouter } from '../../lib/create-app.js'
import { adminMiddleware } from '../../middlewares/admin.js'
import * as handlers from './updates.handlers.js'
import * as routes from './updates.routes.js'

/**
 * **Guarda no caminho INTEIRO**, como em `storage` e ao contrário de
 * `media-types`, que gateia por método.
 *
 * Lá a leitura fica aberta porque a lista de tipos alimenta os chips de
 * `/library` e o selo da carta — gatear a leitura deixaria o app sem
 * vocabulário. Aqui não há consumidor além da seção do admin: **a versão que
 * todo mundo lê é `GET /api/meta`**, e esta rota responde outra pergunta —
 * *há o que atualizar, e esta instalação vai atrás disso?*, que é decisão de
 * quem hospeda.
 */
const router = createRouter()

router.use('*', adminMiddleware())

router
  .openapi(routes.getUpdates, handlers.getUpdates)
  .openapi(routes.setCheck, handlers.setCheck)
  .openapi(routes.checkNow, handlers.checkNow)

export default router
