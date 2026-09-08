import { createRouter } from '../../lib/create-app.js'
import { adminMiddleware } from '../../middlewares/admin.js'
import * as handlers from './providers.handlers.js'
import * as routes from './providers.routes.js'

const router = createRouter()

/**
 * **Ler é de todo mundo; escrever é do admin** (brief, 3.9 — infraestrutura da
 * instância é do admin, conteúdo é do usuário; e 3.10 — provedor inteiro é do
 * admin: definição, credencial e opções).
 *
 * A leitura fica aberta porque duas coisas dependem dela e nenhuma é de
 * administração: a **atribuição** do TMDB é condição de uso e renderiza pra
 * quem olha a tela, e saber que um tipo não tem provedor é o que deixa a busca
 * dizer isso em voz alta em vez de devolver lista vazia. O segredo não viaja na
 * leitura de jeito nenhum.
 *
 * A guarda vai por caminho, e `/:slug` cobre tanto o `PATCH` quanto o
 * `/:slug/test` — que também é do admin, porque testar consome cota da chave da
 * instância.
 */
router.use('/:slug', adminMiddleware())
router.use('/:slug/*', adminMiddleware())

router
  .openapi(routes.list, handlers.list)
  .openapi(routes.update, handlers.update)
  .openapi(routes.test, handlers.test)

export default router
