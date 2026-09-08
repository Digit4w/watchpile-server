import { z } from '@hono/zod-openapi'
import { createSelectSchema } from 'drizzle-zod'
import { entries } from '../../db/schema/entries.js'

const entrySchema = createSelectSchema(entries)

/**
 * O filtro do widget (brief, 3.15). Mora no widget, não na pile: a mesma pile
 * aparece filtrada de um jeito num widget e de outro no vizinho.
 *
 * Guardado como JSON, mas validado aqui na escrita — é isso que separa "coluna
 * que cresce sem migration" de "gaveta de bagunça". `.strict()` recusa chave
 * desconhecida, então filtro de uma versão futura não entra calado num
 * servidor antigo e some depois.
 *
 * A v1 tem só os dois enums que já existem e que `GET /api/entries` já filtra.
 */
export const WidgetFilterSchema = z
  .object({
    mediaType: z.array(entrySchema.shape.mediaType).min(1).optional(),
    status: z.array(entrySchema.shape.status).min(1).optional(),
  })
  .strict()

export type WidgetFilter = z.infer<typeof WidgetFilterSchema>
