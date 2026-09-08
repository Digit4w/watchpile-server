/**
 * Em qual interface de rede o servidor escuta — e quem decide isso.
 *
 * ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 * `serve()` nunca recebeu `hostname`, e o Node sem isso escuta em TODAS as
 * interfaces. O valor de hoje já é o mais aberto que existe, **por omissão e
 * não por escolha** — e no Electron isso significa que a API do Watchpile de
 * alguém fica alcançável por qualquer um no mesmo Wi‑Fi, com `POST
 * /api/setup/account` esperando quem chegar primeiro numa instalação nova.
 *
 * ── O MESMO VALOR QUER DIZER COISAS DIFERENTES ─────────────────────────────
 * Num container o processo vive num namespace de rede próprio: escutar só o
 * loopback ali é ficar inalcançável até para o host, porque a publicação de
 * porta encaminha para a `eth0` do container. E quem decide a exposição de
 * verdade é a camada de cima (`ports:` no compose). **No Docker o bind não é a
 * fronteira de segurança; no desktop ele é a única.**
 *
 * Por isso o padrão é `0.0.0.0` — é o que o self‑hosted faz, o Suwayomi
 * incluído (`ServerConfig.kt`, `defaultValue = "0.0.0.0"`).
 */

/** Todas as interfaces: alcançável pela rede. */
export const ALL_INTERFACES = '0.0.0.0'
/** Só a própria máquina. */
export const LOOPBACK = '127.0.0.1'

/**
 * Se esta instalação OFERECE o controle de conexões remotas.
 *
 * **Isto não é o servidor detectando onde roda**, que o brief 3.4 proíbe — é
 * configuração declarada, lida como `PORT` e `WATCHPILE_DB_PATH` são lidos.
 * Quem a declara é o wrapper do Electron, que pode fazê-lo porque ele *é* o
 * Electron; o servidor só obedece ao que recebeu e não sabe quem escreveu.
 *
 * **O controle é só de onde ele não pode trancar ninguém do lado de fora.** Num
 * container, desligar "permitir conexões remotas" cortaria a conexão de quem
 * acabou de desligar — inclusive a do admin, que chegou pela LAN —, e recuperar
 * exigiria editar variável de ambiente por fora. Num desktop quem clica é
 * sempre local, então o gesto nunca se volta contra quem o fez.
 */
export type HostControl = 'off' | 'ui'

/** De onde saiu o endereço que está valendo. */
export type HostSource = 'env' | 'setting' | 'default'

export type BindInput = {
  /** `WATCHPILE_HOST`, quando alguém a definiu. */
  override: string | undefined
  /** O que o admin gravou pelo controle, se gravou. */
  stored: string | null
  control: HostControl
}

export type Bind = {
  host: string
  source: HostSource
}

/**
 * **O padrão acompanha o controle, e a razão não é conveniência.**
 *
 * Uma instalação que OFERECE o toggle de conexões remotas começa com ele
 * desligado, senão o controle nasce na posição permissiva e ninguém vai
 * procurá-lo — a proteção existiria só para quem já sabia que ela existe. Onde
 * o controle não é oferecido vale o padrão do self‑hosted, porque ali a
 * exposição se decide na camada de cima.
 *
 * É também o que evita uma segunda variável de ambiente só para dizer "e o
 * padrão aqui é outro": as duas perguntas têm sempre a mesma resposta.
 */
export function defaultHost(control: HostControl): string {
  return control === 'ui' ? LOOPBACK : ALL_INTERFACES
}

/**
 * Quem ganha, em ordem: o ambiente, depois o que o admin gravou, depois o
 * padrão.
 *
 * **O ambiente vence e o controle diz isso** (decisão do dono): `env` é
 * override e nunca requisito (brief, 3.9), e quem sobe o container continua no
 * comando. Duas fontes discordando calada é pior que um controle desabilitado
 * com o motivo à vista.
 */
export function resolveBind({ override, stored, control }: BindInput): Bind {
  const fromEnv = override?.trim()
  if (fromEnv) {
    return { host: fromEnv, source: 'env' }
  }
  if (stored) {
    return { host: stored, source: 'setting' }
  }
  return { host: defaultHost(control), source: 'default' }
}

/**
 * Se o endereço que está valendo aceita conexão de fora da máquina.
 *
 * É o que o toggle mostra, e ele é derivado em vez de guardado: com o endereço
 * podendo vir de três lugares, um booleano à parte seria a segunda conta da
 * mesma coisa — e é sempre uma delas que fica pra trás.
 *
 * Qualquer coisa que não seja um endereço de loopback conta como remota. A
 * lista não tenta ser exaustiva sobre o que é loopback em IPv6 porque o que ela
 * decide é a copy de um controle, e errar para o lado de "isto está aberto" é o
 * erro certo.
 */
export function allowsRemote(host: string): boolean {
  return !(host === LOOPBACK || host === '::1' || host === 'localhost')
}

/** O endereço que o toggle grava. */
export function hostFor(allowRemote: boolean): string {
  return allowRemote ? ALL_INTERFACES : LOOPBACK
}

/**
 * Por que o controle não pode ser usado agora — ou `null` quando ele pode.
 *
 * **A recusa se anuncia antes do clique** (design system, seção 5): o controle
 * chega à tela desabilitado com o motivo, em vez de aceitar o toque e falhar
 * depois — o app não tem toast, e uma escrita que só falha no servidor não teria
 * onde se explicar.
 */
export type HostLock = 'not-offered' | 'set-by-environment'

export function hostLock(
  control: HostControl,
  source: HostSource,
): HostLock | null {
  if (control !== 'ui') {
    return 'not-offered'
  }
  if (source === 'env') {
    return 'set-by-environment'
  }
  return null
}
