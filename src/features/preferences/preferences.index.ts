import { createRouter } from '../../lib/create-app.js'
import * as handlers from './preferences.handlers.js'
import * as routes from './preferences.routes.js'

/**
 * Sem `adminMiddleware`: preferência é de quem está logado, e a guarda que
 * importa é a de sessão — cada handler lê `c.get('user')` e responde 401 sem
 * ela. Não há como um usuário ler nem escrever a preferência de outro: o
 * `user_id` sai da sessão, nunca do corpo.
 */
const router = createRouter()
  .openapi(routes.getMediaTypes, handlers.getMediaTypes)
  .openapi(routes.setMediaTypes, handlers.setMediaTypes)

export default router
