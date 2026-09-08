import { createRouter } from '../../lib/create-app.js'
import { adminMiddleware } from '../../middlewares/admin.js'
import * as handlers from './network.handlers.js'
import * as routes from './network.routes.js'

/**
 * **Admin no caminho inteiro, leitura inclusive** — ao contrário de
 * `media-types`, que abre o `GET` por método.
 *
 * Lá a leitura fica aberta porque a lista alimenta os chips de `/library` e o
 * selo da carta: gatear tiraria o vocabulário de quem não é admin. Aqui não há
 * nada que sirva a quem não pode mudar — em qual interface o servidor escuta
 * não muda uma tela sequer de quem só usa o app, e é informação sobre a rede de
 * quem hospeda.
 */
const router = createRouter()
router.use('/*', adminMiddleware())

router.openapi(routes.get, handlers.get).openapi(routes.set, handlers.set)

export default router
