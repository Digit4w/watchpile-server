/**
 * Imprime o SQL de semeadura de UM provedor, a partir de `providers.seed.ts`.
 *
 * A migration é o retrato congelado do módulo, e este script é a câmera: sem
 * ele o retrato é digitado à mão, e foi assim que `detail_path` nasceu torto
 * num dos dois lados em 01/09/2026. Uso: `bun run scripts/print-provider-seed.ts <slug>`
 */
import { DEFAULT_TIMEOUT_MS } from '../src/db/schema/providers.js'
import { PROVIDER_SEEDS } from '../src/features/providers/providers.seed.js'

const slug = process.argv[2]
const seed = PROVIDER_SEEDS.find((p) => p.slug === slug)
if (!seed) {
  console.error(`sem semente para "${slug}"`)
  process.exit(1)
}

/**
 * `--update` imprime UPDATEs em vez de INSERTs, pra quando a definição muda
 * DEPOIS de a semente já ter sido aplicada em algum lugar. Migration não se
 * reescreve — a correção é uma nova.
 */
const modoUpdate = process.argv.includes('--update')
/** Só a linha de `providers` — pra corrigir endpoints de um já semeado. */
const soProvedor = process.argv.includes('--provider-only')

const q = (v: unknown) =>
  v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
const j = (v: unknown) => (v === undefined ? 'NULL' : q(JSON.stringify(v)))

if (!modoUpdate) {
  console.log(
    `INSERT INTO \`providers\` (\`slug\`, \`name\`, \`base_url\`, \`attribution\`, \`art_template\`, \`auth\`, \`rate_limit\`, \`timeout_ms\`, \`endpoints\`, \`field_map\`, \`credentials\`, \`options\`) VALUES (${q(seed.slug)}, ${q(seed.name)}, ${q(seed.baseUrl)}, ${q(seed.attribution)}, ${q(seed.artTemplate ?? null)}, ${j(seed.auth)}, ${j(seed.rateLimit)}, ${seed.timeoutMs ?? DEFAULT_TIMEOUT_MS}, ${j(seed.endpoints)}, ${j(seed.fieldMap)}, ${j(seed.credentials)}, ${j(seed.options)});`,
  )
  console.log('--> statement-breakpoint')
}
if (modoUpdate && soProvedor) {
  console.log(
    `UPDATE \`providers\` SET \`endpoints\` = ${j(seed.endpoints)}, \`field_map\` = ${j(seed.fieldMap)}, \`rate_limit\` = ${j(seed.rateLimit)}, \`timeout_ms\` = ${seed.timeoutMs ?? DEFAULT_TIMEOUT_MS} WHERE \`slug\` = ${q(seed.slug)};`,
  )
  process.exit(0)
}
// **Uma instrução por statement.** `better-sqlite3` recusa string com mais de
// uma, e o Open Library escondia isso por ter UM tipo só — o segundo par foi
// quem descobriu.
let first = true
for (const t of seed.mediaTypes) {
  if (!first) {
    console.log('--> statement-breakpoint')
  }
  first = false
  if (modoUpdate) {
    console.log(
      `UPDATE \`media_type_providers\` SET \`search_path\` = ${q(t.searchPath ?? null)}, \`search_body\` = ${j(t.searchBody)}, \`field_map\` = ${j(t.fieldMap)}, \`detail_path\` = ${q(t.detailPath ?? null)}, \`detail_body\` = ${j(t.detailBody)}, \`detail_field_map\` = ${j(t.detailFieldMap)}, \`provider_type_token\` = ${q(t.providerTypeToken ?? null)}, \`relations_path\` = ${q(t.relationsPath ?? null)}, \`units_path\` = ${q(t.unitsPath ?? null)}, \`unit_map\` = ${j(t.unitMap)} WHERE \`media_type_slug\` = ${q(t.slug)} AND \`provider_slug\` = ${q(seed.slug)};`,
    )
    continue
  }
  console.log(
    `INSERT INTO \`media_type_providers\` (\`media_type_slug\`, \`provider_slug\`, \`search_path\`, \`search_body\`, \`field_map\`, \`detail_path\`, \`detail_body\`, \`detail_field_map\`, \`provider_type_token\`, \`relations_path\`, \`units_path\`, \`unit_map\`) SELECT ${q(t.slug)}, ${q(seed.slug)}, ${q(t.searchPath ?? null)}, ${j(t.searchBody)}, ${j(t.fieldMap)}, ${q(t.detailPath ?? null)}, ${j(t.detailBody)}, ${j(t.detailFieldMap)}, ${q(t.providerTypeToken ?? null)}, ${q(t.relationsPath ?? null)}, ${q(t.unitsPath ?? null)}, ${j(t.unitMap)} WHERE EXISTS (SELECT 1 FROM \`media_types\` WHERE \`slug\` = ${q(t.slug)});`,
  )
}
