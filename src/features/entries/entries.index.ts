import { createRouter } from '../../lib/create-app.js'
import * as artHandlers from '../art/art.handlers.js'
import * as artRoutes from '../art/art.routes.js'
import * as titlesHandlers from '../titles/titles.handlers.js'
import * as titlesRoutes from '../titles/titles.routes.js'
import * as handlers from './entries.handlers.js'
import * as linksHandlers from './entries.links.handlers.js'
import * as linksRoutes from './entries.links.routes.js'
import * as pilesHandlers from './entries.piles.handlers.js'
import * as pilesRoutes from './entries.piles.routes.js'
import * as routes from './entries.routes.js'

const router = createRouter()
  .openapi(routes.list, handlers.list)
  .openapi(routes.create, handlers.create)
  .openapi(routes.getById, handlers.getById)
  .openapi(routes.getHistory, handlers.getHistory)
  .openapi(routes.update, handlers.update)
  .openapi(routes.addProgress, handlers.addProgress)
  .openapi(routes.remove, handlers.remove)
  /**
   * `DELETE /` — a biblioteca inteira. Registrada DEPOIS de `/{id}` só por
   * arrumação; os dois caminhos não se sobrepõem, porque um exige um segmento
   * e o outro exige nenhum.
   */
  .openapi(routes.removeAll, handlers.removeAll)
  .openapi(pilesRoutes.listPiles, pilesHandlers.listPiles)
  // Vincular obra existente a um provedor (brief, 3.10). Mora sob `/entries`
  // porque quem autoriza é a obra, como a arte.
  .openapi(linksRoutes.listLinks, linksHandlers.listLinks)
  .openapi(linksRoutes.createLink, linksHandlers.createLink)
  .openapi(linksRoutes.setPrimaryLink, linksHandlers.setPrimaryLink)
  .openapi(linksRoutes.removeLink, linksHandlers.removeLink)
  // A arte mora sob `/api/entries` porque quem autoriza é a obra. Ver
  // `art.routes.ts`.
  .openapi(artRoutes.getArt, artHandlers.getArt)
  // O contexto do provedor pra obra que já é sua — mesma forma que a rota de
  // `/api/search`, e de propósito (`titles.public.ts`).
  .openapi(titlesRoutes.getEntryDetails, titlesHandlers.getEntryDetails)
  .openapi(titlesRoutes.getEntryUnits, titlesHandlers.getEntryUnits)

export default router
