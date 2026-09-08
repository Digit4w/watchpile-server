import { createRouter } from '../../lib/create-app.js'
import * as titlesHandlers from '../titles/titles.handlers.js'
import * as titlesRoutes from '../titles/titles.routes.js'
import * as handlers from './search.handlers.js'
import * as routes from './search.routes.js'

const router = createRouter()

/**
 * **Buscar é de todo usuário, não só do admin.** Configurar o provedor é do
 * admin (brief, 3.9); usar o que ele configurou é de quem tem conta — a chave é
 * da instância justamente pra que todos se beneficiem dela sem nunca vê-la.
 */
router.openapi(routes.search, handlers.search)

/**
 * O detalhe de uma obra do provedor mora sob `/api/search` porque é de lá que
 * se chega nela — e porque um pai neutro seria um destino que não existe na
 * navegação. Ver `titles.routes.ts`.
 */
router.openapi(titlesRoutes.getProviderTitle, titlesHandlers.getProviderTitle)
router.openapi(titlesRoutes.getProviderUnits, titlesHandlers.getProviderUnits)

export default router
