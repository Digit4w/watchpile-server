import { createRouter } from '../../lib/create-app.js'
import * as handlers from './import.handlers.js'
import * as routes from './import.routes.js'

/**
 * `YOU / Import` (brief, 3.12).
 *
 * **Sem `adminMiddleware`, e é decisão.** Import é conteúdo, e conteúdo é do
 * usuário (brief, 3.9) — quem importa é cada pessoa, para a própria
 * biblioteca. O que é infraestrutura da instalação, e portanto do admin, é a
 * chave do provedor, que mora em `/settings/providers` e já é guardada lá.
 *
 * **As três fontes estão aqui, e uma delas não foi MEDIDA.** O MyAnimeList foi
 * verificado contra a API real em 07/09/2026 — 426 obras de um perfil de
 * verdade, com os quatro caminhos de falha conferidos. O AniList não: eles
 * desativaram a própria API no mesmo dia, e a fonte saiu da documentação mais a
 * implementação do Yamtrack.
 *
 * A rota dele existe porque `dev` com API sem consumidor é inofensivo, e porque
 * escrever a fonte agora é o que torna a verificação um passo só quando eles
 * voltarem. **Quem não a oferece é a TELA** — affordance descreve o que existe,
 * e uma caixa que hoje só sabe falhar não descreve nada.
 */
const router = createRouter()
  .openapi(routes.status, handlers.status)
  .openapi(routes.importCsv, handlers.importCsv)
  .openapi(routes.importAnilist, handlers.importAnilist)
  .openapi(routes.importMal, handlers.importMal)
  .openapi(routes.cancel, handlers.cancel)

export default router
