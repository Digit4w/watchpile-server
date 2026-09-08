import type { AppRouteHandler } from '../lib/types.js'
import type { HealthCheckRoute } from './health.routes.js'

export const healthCheck: AppRouteHandler<HealthCheckRoute> = (c) => {
  return c.json({ status: 'ok' as const }, 200)
}
