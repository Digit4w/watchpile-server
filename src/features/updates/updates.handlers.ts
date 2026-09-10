import type { AppRouteHandler } from '../../lib/types.js'
import {
  type DownloadState,
  downloadState,
  readyFilePath,
  startDownload,
} from './updates.download.js'
import { currentInstaller } from './updates.installer.js'
import type {
  CheckNowRoute,
  DownloadRoute,
  GetUpdatesRoute,
  InstallRoute,
  SetCheckRoute,
} from './updates.routes.js'
import { runCheck, setCheckEnabled, updateState } from './updates.store.js'

/**
 * A união vira uma forma só, com nulo onde o degrau não tem o campo.
 *
 * Uma união discriminada no contrato obrigaria o cliente a estreitar antes de
 * ler qualquer coisa, e o que a tela faz é desenhar uma linha que troca de
 * conteúdo — não quatro peças diferentes. Os campos ausentes são nulos, que é
 * o mesmo vocabulário que `latest` e `checkedAt` já usam.
 */
function shapeDownload(state: DownloadState) {
  return {
    state: state.state,
    version: 'version' in state ? state.version : null,
    received: state.state === 'downloading' ? state.received : null,
    total: state.state === 'downloading' ? state.total : null,
    reason: state.state === 'failed' ? state.reason : null,
  }
}

/** A data vai como ISO, porque o contrato é JSON e `Date` não atravessa. */
function shape() {
  const state = updateState()
  const installer = currentInstaller()

  return {
    ...state,
    checkedAt: state.checkedAt?.toISOString() ?? null,
    canInstall: installer !== null,
    installHint: installer?.hint ?? null,
    download: shapeDownload(downloadState()),
  }
}

export const getUpdates: AppRouteHandler<GetUpdatesRoute> = (c) => {
  return c.json(shape(), 200)
}

export const setCheck: AppRouteHandler<SetCheckRoute> = (c) => {
  setCheckEnabled(c.req.valid('json').enabled)
  return c.json(shape(), 200)
}

export const checkNow: AppRouteHandler<CheckNowRoute> = async (c) => {
  if (!updateState().enabled) {
    return c.json({ message: 'Update checking is turned off' }, 409)
  }

  /**
   * **Este é o único caminho que ESPERA a rede**, e é o que separa "conferir
   * agora" da reconciliação: lá o sino não pode ficar preso na internet, aqui
   * a pessoa apertou um botão e está olhando pra ele.
   *
   * Falha de rede não vira erro HTTP: `runCheck` já a engole e carimba a data,
   * e a resposta é o estado — a tela lê "conferido agora, nada novo" da mesma
   * forma nos dois casos.
   */
  await runCheck()
  return c.json(shape(), 200)
}

export const download: AppRouteHandler<DownloadRoute> = (c) => {
  const state = updateState()

  /**
   * **Recusa antes de gastar rede**, e as duas recusas são a mesma frase de
   * propósito: baixar centenas de megabytes que ninguém vai conseguir aplicar
   * é pior que dizer não. Quem não pode instalar daqui já vê o comando na
   * tela, e a tela não oferece o botão — isto é a rede, não o aviso.
   */
  if (!currentInstaller()) {
    return c.json({ message: 'This install cannot apply an update' }, 409)
  }
  if (!state.updateAvailable) {
    return c.json({ message: 'There is nothing newer to download' }, 409)
  }

  startDownload(state.current)
  return c.json(shape(), 202)
}

export const install: AppRouteHandler<InstallRoute> = async (c) => {
  const installer = currentInstaller()
  const file = readyFilePath()

  if (!installer || !file) {
    return c.json({ message: 'There is no downloaded update to apply' }, 409)
  }

  /**
   * A resposta sai ANTES de aplicar, e é por isso que ela é 202.
   *
   * `apply` termina o processo na maioria das plataformas — o instalador
   * precisa substituir o que está rodando —, então esperar por ela deixaria a
   * requisição pendurada até a conexão cair, e a tela leria isso como falha do
   * que na verdade deu certo.
   */
  void Promise.resolve(installer.apply(file)).catch(() => {})
  return c.json({ message: 'Applying' }, 202)
}
