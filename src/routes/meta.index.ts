import { createRouter } from '../lib/create-app.js'
import * as handlers from './meta.handlers.js'
import * as routes from './meta.routes.js'

/**
 * Sem `adminMiddleware`: a versão é fato da instalação e `About` fica **fora
 * dos dois grupos** de Settings, porque versão e licença não são de ninguém
 * (design system, seção 5). O que é do admin é decidir sobre ATUALIZAR, e isso
 * é outra rota.
 */
const router = createRouter().openapi(routes.getMeta, handlers.getMeta)

export default router
