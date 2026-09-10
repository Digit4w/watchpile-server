import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  sessionSecret: text('session_secret').notNull(),
  registrationOpen: integer('registration_open', { mode: 'boolean' })
    .notNull()
    .default(false),
  /**
   * Idioma-base do SERVIDOR, e não a língua-base do produto (brief, 3.9 e
   * 3.12). É o degrau 2 da queda de nome de tipo: leitor → instância → primeiro
   * preenchido. A distinção importa num servidor monolíngue em pt-BR, onde
   * cair no inglês do produto cairia num campo vazio.
   *
   * Nasce com default e **sem UI** — quem passa a preenchê-lo é o wizard de
   * primeiro uso, que ainda não existe. Coluna antes da tela porque a regra da
   * queda depende dela, e regra que a implementação não cumpre é regra falsa.
   */
  instanceLanguage: text('instance_language').notNull().default('en'),

  /**
   * Quando o wizard de primeiro uso terminou o passo de INSTÂNCIA (brief, 3.9).
   *
   * **Nulo é "ainda não rodou", e a coluna existe porque a dedução não serve.**
   * "Já configurou?" não se responde olhando se há usuário: quem cria o admin e
   * fecha o navegador em seguida teria a configuração pulada pra sempre, sem
   * nada na tela dizendo que ela existiu. É o mesmo motivo pelo qual
   * `instance_language` não serve de sinal — ela tem default, então um servidor
   * configurado em inglês é indistinguível de um nunca configurado.
   *
   * Timestamp e não booleano pelo motivo de `piles.pinned_at`: o `NULL` já é o
   * "não", e a data ainda diz quando — que num servidor de homelab é a única
   * pista de idade da instalação que existe fora do `created_at`.
   *
   * **A migration carimba instalação que já tem usuário.** Quem já estava
   * rodando fez as escolhas dele — os seis tipos, o idioma em inglês —, e
   * mandá-lo pra um wizard que oferece APAGAR tipo seria pior que pulá-lo.
   */
  instanceSetupAt: integer('instance_setup_at', { mode: 'timestamp' }),

  /**
   * O endereço que o admin escolheu pelo controle de conexões remotas, ou nulo
   * quando ele nunca o usou.
   *
   * **Nulo é "não escolhi", não é um endereço** — é o que deixa o padrão da
   * instalação valer, e o padrão depende de o controle ser oferecido
   * (`features/network/network.bind.ts`). Gravar `0.0.0.0` na migration
   * congelaria a escolha de todo mundo no valor de hoje.
   *
   * **Guarda o ENDEREÇO e não um booleano**, ainda que o controle seja um
   * toggle: com `WATCHPILE_HOST` podendo trazer qualquer endereço, um booleano
   * à parte seria a segunda conta da mesma coisa. O que a tela mostra se deriva
   * daqui.
   *
   * Isto **não** viaja bem num backup restaurado noutra máquina — o bind é
   * propriedade do lugar, não do dado, e o Suwayomi marca o campo equivalente
   * com `excludeFromBackup`. Nosso backup é copiar o arquivo inteiro (brief,
   * 3.1), então não há como excluir uma coluna dele: fica registrado como o
   * custo conhecido de restaurar num endereço diferente.
   */
  /**
   * Se esta instalação procura versão nova — 10/09/2026, decisão do dono:
   * **ligada, com como desligar**.
   *
   * É a **única saída para fora** que o servidor faz sem alguém ter pedido, e
   * num produto self-hosted isso pede consentimento legível. Ligada por padrão
   * porque a alternativa medida (nascer desligada) deixa a maioria sem nunca
   * ser avisada de uma versão com correção de segurança; desligável porque a
   * postura do produto é a que fez o cache de arte existir — não vazar o que a
   * pessoa tem.
   *
   * **O que vaza mesmo ligada é o IP e o instante**, e nada mais: a consulta é
   * um `GET` público na API de releases do GitHub, sem corpo e sem
   * identificador. A versão instalada **não** viaja — a comparação acontece
   * aqui.
   */
  updateCheckEnabled: integer('update_check_enabled', { mode: 'boolean' })
    .notNull()
    .default(true),
  /**
   * Quando a última consulta ACONTECEU, não quando ela achou algo.
   *
   * É o que segura a cadência: sem ele, reconciliar na leitura bateria no
   * GitHub a cada abertura do sino. Carimbado mesmo quando a consulta **falha**
   * — senão uma instalação sem rede tentaria a cada leitura, que é o oposto do
   * que a cadência existe pra evitar.
   */
  updateCheckedAt: integer('update_checked_at', { mode: 'timestamp' }),
  /**
   * A versão mais nova que a última consulta viu, e onde lê-la.
   *
   * Guardadas porque a condição de notificação é derivada de ESTADO, sem rede:
   * `reconcileInstanceConditions` roda em toda leitura de admin, e uma
   * condição que precisasse de `fetch` faria o sino esperar a internet.
   */
  updateLatestVersion: text('update_latest_version'),
  updateLatestUrl: text('update_latest_url'),
  bindHost: text('bind_host'),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})
