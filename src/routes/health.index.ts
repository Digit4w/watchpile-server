import { createRouter } from '../lib/create-app.js'
import * as handlers from './health.handlers.js'
import * as routes from './health.routes.js'

const router = createRouter().openapi(routes.healthCheck, handlers.healthCheck)

export default router
