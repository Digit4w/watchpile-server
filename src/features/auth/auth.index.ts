import { createRouter } from '../../lib/create-app.js'
import * as handlers from './auth.handlers.js'
import * as routes from './auth.routes.js'

const router = createRouter()
  .openapi(routes.login, handlers.login)
  .openapi(routes.logout, handlers.logout)
  .openapi(routes.me, handlers.me)

export default router
