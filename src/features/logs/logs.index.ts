import { createRouter } from '../../lib/create-app.js'
import { adminMiddleware } from '../../middlewares/admin.js'
import * as handlers from './logs.handlers.js'
import * as routes from './logs.routes.js'

/**
 * A guarda cobre a feature INTEIRA, como em `storage`: o log não alimenta tela
 * nenhuma de quem não é admin, e ele carrega o que acontece com a instalação de
 * todo mundo. `/*` casa também `/download` — `router.use('/:x')` não cobriria
 * um segundo segmento (10/09/2026), e aqui não há parâmetro nenhum.
 */
const router = createRouter()

router.use('/*', adminMiddleware())

router
  .openapi(routes.read, handlers.read)
  .openapi(routes.download, handlers.download)

export default router
