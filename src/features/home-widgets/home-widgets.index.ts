import { createRouter } from '../../lib/create-app.js'
import * as handlers from './home-widgets.handlers.js'
import * as routes from './home-widgets.routes.js'

const router = createRouter()
  .openapi(routes.list, handlers.list)
  .openapi(routes.create, handlers.create)
  // antes de /{id}: path estático tem que vencer o param
  .openapi(routes.updateLayout, handlers.updateLayout)
  .openapi(routes.update, handlers.update)
  .openapi(routes.remove, handlers.remove)
  .openapi(routes.listEntries, handlers.listEntries)
  .openapi(routes.moveEntry, handlers.moveEntry)

export default router
