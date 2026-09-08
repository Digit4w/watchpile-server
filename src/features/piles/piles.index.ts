import { createRouter } from '../../lib/create-app.js'
import * as coverHandlers from './piles.cover.handlers.js'
import * as coverRoutes from './piles.cover.routes.js'
import * as entriesHandlers from './piles.entries.handlers.js'
import * as entriesRoutes from './piles.entries.routes.js'
import * as handlers from './piles.handlers.js'
import * as routes from './piles.routes.js'

const router = createRouter()
  .openapi(routes.list, handlers.list)
  .openapi(routes.create, handlers.create)
  .openapi(routes.getById, handlers.getById)
  .openapi(routes.update, handlers.update)
  .openapi(routes.remove, handlers.remove)
  .openapi(entriesRoutes.listEntries, entriesHandlers.listEntries)
  .openapi(entriesRoutes.addEntry, entriesHandlers.addEntry)
  .openapi(entriesRoutes.moveEntry, entriesHandlers.moveEntry)
  .openapi(entriesRoutes.removeEntry, entriesHandlers.removeEntry)
  .openapi(coverRoutes.getCover, coverHandlers.getCover)
  .openapi(coverRoutes.putCover, coverHandlers.putCover)
  .openapi(coverRoutes.removeCover, coverHandlers.removeCover)

export default router
