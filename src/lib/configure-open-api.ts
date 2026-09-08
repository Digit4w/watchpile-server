import { Scalar } from '@scalar/hono-api-reference'
import packageJSON from '../../package.json' with { type: 'json' }
import type { AppOpenAPI } from './types.js'

export function configureOpenAPI(app: AppOpenAPI) {
  app.doc('/doc', {
    openapi: '3.1.0',
    info: {
      title: 'Watchpile API',
      version: packageJSON.version,
    },
  })

  app.get('/reference', Scalar({ url: '/doc' }))
}
