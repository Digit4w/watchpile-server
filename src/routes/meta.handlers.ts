import type { AppRouteHandler } from '../lib/types.js'
import { APP_VERSION } from '../lib/version.js'
import type { GetMetaRoute } from './meta.routes.js'

export const getMeta: AppRouteHandler<GetMetaRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  return c.json({ version: APP_VERSION }, 200)
}
