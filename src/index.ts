import { serve } from '@hono/node-server'
import app from './app.js'
import { env } from './env.js'
import {
  intendedBind,
  rememberBound,
} from './features/network/network.store.js'

export type Listening = {
  port: number
  host: string
}

/**
 * Sobe o servidor, **dizendo em qual interface**.
 *
 * Sem `hostname` o Node escuta em todas, que é o padrão do self-hosted e segue
 * sendo o nosso — a mudança é que agora isso é escolha e não omissão. Quem
 * resolve o endereço é `features/network`, porque a resposta depende de três
 * coisas que se sobrepõem: a variável de ambiente, o que o admin gravou e o
 * padrão da instalação.
 *
 * O endereço fica guardado no processo (`rememberBound`) e é o que permite a
 * tela dizer "precisa reiniciar" sem chutar: trocar o controle escreve no
 * banco, e o que está valendo continua sendo o que subiu aqui.
 */
export function startServer(): Promise<Listening> {
  const { host } = intendedBind()

  return new Promise((resolve) => {
    serve({ fetch: app.fetch, port: env.PORT, hostname: host }, (info) => {
      rememberBound(host)
      resolve({ port: info.port, host })
    })
  })
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  const { port, host } = await startServer()
  console.log(`Watchpile server listening on ${host}:${port}`)
}
