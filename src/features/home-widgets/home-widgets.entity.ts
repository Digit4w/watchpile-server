import type { InferSelectModel } from 'drizzle-orm'
import type { homeWidgets } from '../../db/schema/home-widgets.js'

export type HomeWidget = InferSelectModel<typeof homeWidgets>

export type WidgetType = HomeWidget['type']
