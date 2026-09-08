import { createRouter } from '../../lib/create-app.js'
import * as handlers from './export.handlers.js'
import * as routes from './export.routes.js'

/**
 * O outro lado do laço que `/api/import` abriu (brief, 3.12).
 *
 * O servidor emite o que ele mesmo aceita, e o teste que prova isso é um ciclo
 * — `export.test.ts` exporta, importa de volta e confere que nada mudou.
 */
const router = createRouter().openapi(routes.entriesCsv, handlers.entriesCsv)

export default router
