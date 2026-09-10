import { z } from 'zod'

// Every field here is an override, never a requirement — the server must boot
// with no .env at all (brief, 3.9). Defaults cover Docker and Electron alike.
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  // 0 é válido: idioma do Node para "o SO escolhe uma porta livre" — é o que
  // o Electron pede, já que não faz sentido brigar por uma porta fixa num
  // desktop app (brief, 3.4).
  PORT: z.coerce.number().int().nonnegative().default(3210),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  WATCHPILE_DB_PATH: z.string().min(1).default('./data/watchpile.db'),
  /**
   * Em qual interface escutar. Sem ela o Node escuta em TODAS, que é o padrão
   * do self-hosted e continua sendo o nosso — a diferença é que agora isso é
   * escolha e não omissão (`features/network/network.bind.ts`).
   *
   * Definida, ela VENCE o que o admin gravou pelo controle: env é override e
   * nunca requisito (brief, 3.9), e quem sobe o container continua no comando.
   * O controle na tela aparece desabilitado dizendo isso.
   */
  WATCHPILE_HOST: z.string().min(1).optional(),
  /**
   * Se esta instalação oferece o controle de conexões remotas na UI.
   *
   * **Não é o servidor descobrindo onde roda** (brief, 3.4 proíbe): é
   * configuração declarada, e quem a declara é o wrapper do Electron, que pode
   * porque ele *é* o Electron. O servidor lê como lê `PORT`.
   *
   * `ui` também troca o padrão do bind para o loopback — as duas perguntas têm
   * sempre a mesma resposta, e o porquê está em `network.bind.ts`.
   */
  WATCHPILE_HOST_CONTROL: z.enum(['off', 'ui']).default('off'),
  // Suwayomi-style: um binário só pode servir a API e o WebUI, ou só a API —
  // quem decide é quem sobe o container, não o código (brief, 3.1 + 5.1).
  WATCHPILE_SERVE_CLIENT: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  WATCHPILE_CLIENT_DIST_PATH: z.string().min(1).default('./client-dist'),
  // Art cache (brief, 3.10). Next to the database on purpose: the Dockerfile
  // mounts a single /data volume, and art living outside it would be lost on
  // every container replacement -- silently, since it regenerates.
  // Where to look for a newer version. The default is this product's own
  // repository; a fork points it at its own without touching code. Override,
  // never a requirement — an install with no value still checks, and one that
  // wants no check at all turns the check off in Settings, which is the
  // control a person can find.
  WATCHPILE_UPDATE_REPO: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .default('Digit4w/watchpile-server'),
  WATCHPILE_ART_CACHE_PATH: z.string().min(1).default('./data/art'),
  // The ceiling the brief asks for, in megabytes. A w342 poster is ~40KB, so
  // 256MB is on the order of six thousand of them -- generous for a home
  // library and small enough to not surprise anyone watching disk usage.
  WATCHPILE_ART_CACHE_MB: z.coerce.number().int().positive().default(256),
  // Off means hotlink, which the brief keeps as an option for whoever prefers
  // it. Same shape as WATCHPILE_SERVE_CLIENT.
  WATCHPILE_ART_CACHE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
})

export type Env = z.infer<typeof EnvSchema>

const result = EnvSchema.safeParse(process.env)

if (!result.success) {
  console.error('Invalid environment variables:')
  console.error(z.prettifyError(result.error))
  process.exit(1)
}

export const env: Env = result.data
