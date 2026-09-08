import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from '../src/db/client.js'

migrate(db, { migrationsFolder: './src/db/migrations' })

/**
 * **A suíte não fala com a rede, e é esta linha que faz valer.**
 *
 * Todo teste que precisa de resposta de provedor já injeta um dublê — por
 * parâmetro (`fetchImpl`) ou por `vi.spyOn(globalThis, 'fetch')`. O que faltava
 * era a rede parar de existir para quem **não** injetou: aí um caminho novo que
 * escapou da injeção sai calado pra internet, e a suíte fica dependendo do humor
 * de um serviço de terceiro sem ninguém saber.
 *
 * Não é hipótese. O aquecimento do cache de arte (07/09/2026) nasceu disparado
 * pelo executor do import **sem `await` e sem injeção**, e os itens do teste do
 * executor carregam vínculo com `anilist`: a suíte passou verde batendo na API
 * deles de verdade, centenas de vezes, sem que nada aparecesse. É a irmã da
 * lição de 02/09 — *injeção que não alcança o caminho novo não é injeção* —, e
 * aqui ela vira rede de segurança em vez de vigilância.
 *
 * Atribuição direta, e não `vi.spyOn`, de propósito: um `mockRestore()` de outro
 * teste volta para ESTE valor, e não para o `fetch` do Node.
 */
globalThis.fetch = (async (input: RequestInfo | URL) => {
  throw new Error(
    `Teste tentou alcançar a rede: ${String(input)}. ` +
      'Injete um dublê (`fetchImpl`) ou espione `globalThis.fetch`.',
  )
}) as typeof fetch
