import authRouter from './features/auth/auth.index.js'
import entriesRouter from './features/entries/entries.index.js'
import exportRouter from './features/export/export.index.js'
import homeWidgetsRouter from './features/home-widgets/home-widgets.index.js'
import importRouter from './features/import/import.index.js'
import mediaTypesRouter from './features/media-types/media-types.index.js'
import networkRouter from './features/network/network.index.js'
import notificationsRouter from './features/notifications/notifications.index.js'
import pilesRouter from './features/piles/piles.index.js'
import preferencesRouter from './features/preferences/preferences.index.js'
import providersRouter from './features/providers/providers.index.js'
import searchRouter from './features/search/search.index.js'
import setupRouter from './features/setup/setup.index.js'
import storageRouter from './features/storage/storage.index.js'
import { configureClientServing } from './lib/configure-client-serving.js'
import { configureOpenAPI } from './lib/configure-open-api.js'
import { createApp } from './lib/create-app.js'
import healthRouter from './routes/health.index.js'

const app = createApp()

configureOpenAPI(app)

app.route('/', healthRouter)
app.route('/api/setup', setupRouter)
app.route('/api/auth', authRouter)
app.route('/api/piles', pilesRouter)
app.route('/api/entries', entriesRouter)
app.route('/api/export', exportRouter)
app.route('/api/home-widgets', homeWidgetsRouter)
app.route('/api/import', importRouter)
app.route('/api/media-types', mediaTypesRouter)
app.route('/api/network', networkRouter)
app.route('/api/notifications', notificationsRouter)
app.route('/api/preferences', preferencesRouter)
app.route('/api/providers', providersRouter)
app.route('/api/search', searchRouter)
app.route('/api/storage', storageRouter)

// depois de toda rota da API: o fallback do client só entra em jogo pra
// path que nada acima respondeu (brief, 3.1 — "resto -> build do Vite")
configureClientServing(app)

export default app
