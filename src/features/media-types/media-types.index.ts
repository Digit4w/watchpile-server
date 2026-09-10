import { createRouter } from '../../lib/create-app.js'
import { adminMiddleware } from '../../middlewares/admin.js'
import * as handlers from './media-types.handlers.js'
import * as routes from './media-types.routes.js'

const router = createRouter()

/**
 * **Ler é de todo mundo; escrever é do admin** (brief, 3.9 — infraestrutura da
 * instância é do admin, conteúdo é do usuário).
 *
 * A lista alimenta os chips de `/library`, o selo da carta e a folha de obra:
 * gatear a leitura deixaria o app inteiro sem vocabulário para quem não é
 * admin. O que é do admin é definir o vocabulário, e é o que estas três linhas
 * protegem.
 *
 * A guarda vai por MÉTODO e caminho, e não no router inteiro, exatamente por
 * isso. `POST /` e as duas de `/:slug` cobrem tudo que escreve.
 *
 * **`GET /templates` cai sob a guarda de `/:slug`, e isso é intencional.** Ele
 * casa o padrão de um segmento, e o efeito é o certo: template só serve pra
 * criar tipo, e criar tipo é do admin. Fica declarado aqui porque é o tipo de
 * coisa que, sem estar escrita, um dia alguém "conserta" achando que foi
 * descuido.
 */
router.use('/', async (c, next) => {
  if (c.req.method === 'GET') {
    return next()
  }
  return adminMiddleware()(c, next)
})
router.use('/:slug', adminMiddleware())
/**
 * **A linha acima NÃO cobre `/:slug/providers/:provider`** — 10/09/2026.
 *
 * `use('/:slug')` casa um segmento e para ali; sub-caminho é outro padrão. Sem
 * esta segunda linha, vincular e desvincular provedor ficariam abertos a
 * qualquer sessão, e a guarda pareceria estar cobrindo o que não cobre. É a
 * mesma forma do `htmlFor` apontando pra id inexistente: escrito, plausível, e
 * sem efeito.
 */
router.use('/:slug/*', adminMiddleware())

router
  .openapi(routes.list, handlers.list)
  .openapi(routes.templates, handlers.templates)
  .openapi(routes.create, handlers.create)
  .openapi(routes.update, handlers.update)
  .openapi(routes.remove, handlers.remove)
  .openapi(routes.link, handlers.link)
  .openapi(routes.unlink, handlers.unlink)

export default router
