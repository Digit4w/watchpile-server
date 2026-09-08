import type { ErrorHandler, NotFoundHandler } from 'hono'
import type { AppBindings } from './types.js'

export const notFound: NotFoundHandler<AppBindings> = (c) =>
  c.json({ message: `Not found: ${c.req.path}` }, 404)

export const onError: ErrorHandler<AppBindings> = (err, c) => {
  c.get('logger')?.error(err)
  return c.json({ message: err.message || 'Internal Server Error' }, 500)
}
