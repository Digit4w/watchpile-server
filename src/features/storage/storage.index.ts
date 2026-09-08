import { createRouter } from '../../lib/create-app.js'
import { adminMiddleware } from '../../middlewares/admin.js'
import * as handlers from './storage.handlers.js'
import * as routes from './storage.routes.js'

/**
 * A guarda cobre a feature INTEIRA, e não por método como em `media-types`.
 *
 * Lá a leitura fica aberta porque a lista de tipos alimenta os chips de
 * `/library` e o selo da carta — o app inteiro precisa daquele vocabulário.
 * Aqui não há consumidor além desta seção: quanto o cache ocupa não muda uma
 * tela sequer para quem não é admin, e é fato sobre a MÁQUINA de quem hospeda.
 */
const router = createRouter()

router.use('/*', adminMiddleware())

router
  .openapi(routes.usage, handlers.usage)
  .openapi(routes.clearProviderCache, handlers.clearProviderCache)
  .openapi(routes.clearArtCache, handlers.clearArtCache)

export default router
