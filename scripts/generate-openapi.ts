import { writeFileSync } from 'node:fs'
import app from '../src/app.js'

const res = await app.request('/doc')
const doc = await res.json()

/**
 * O contrato é o que o cliente consome (brief, 3.7) — e este script já o
 * destruiu uma vez, em 31/08/2026.
 *
 * O que aconteceu: a capa de pilha entrou como `blob`, drizzle-zod a mapeou pra
 * `z.custom`, e o `/doc` respondeu **200 com um objeto de erro no corpo**. Sem
 * a verificação abaixo, `openapi.json` passou de 3375 linhas para 10 — e o
 * `biome format` que roda em seguida formatou o destroço sem reclamar. A única
 * razão de o erro ter aparecido foi eu ter olhado o diff.
 *
 * Duas guardas, porque uma só não pega os dois modos de falha:
 * `status` cobre o dia em que o `/doc` responder 500, e a forma do documento
 * cobre este caso — 200 com corpo que não é um documento OpenAPI.
 */
if (!res.ok) {
  console.error(`GET /doc respondeu ${res.status}:`)
  console.error(JSON.stringify(doc, null, 2))
  process.exit(1)
}

const looksLikeOpenApi =
  typeof doc === 'object' &&
  doc !== null &&
  'openapi' in doc &&
  'paths' in doc &&
  Object.keys((doc as { paths: object }).paths).length > 0

if (!looksLikeOpenApi) {
  console.error(
    'GET /doc respondeu 200, mas o corpo não é um documento OpenAPI:',
  )
  console.error(JSON.stringify(doc, null, 2))
  console.error(
    '\nCausa provável: alguma rota expõe um schema que o gerador não sabe\n' +
      'serializar. Uma coluna `blob` vira `z.custom` em drizzle-zod, e é\n' +
      'preciso omiti-la do schema da resposta — ver features/piles/piles.public.ts.',
  )
  process.exit(1)
}

writeFileSync('openapi.json', `${JSON.stringify(doc, null, 2)}\n`)
