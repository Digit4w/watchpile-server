import type { ProviderBody } from '../../db/schema/providers.js'

/** O corpo pronto pra ir na requisição, com o `Content-Type` que o dialeto pede. */
export type RenderedBody = {
  text: string
  contentType: string
}

/**
 * Os valores que os marcadores de um corpo podem receber.
 *
 * Chaves achatadas de propósito — `option:nsfw` é uma chave, não um objeto
 * aninhado —, porque é assim que o marcador aparece escrito na definição, e a
 * substituição fica sendo uma consulta direta em vez de um parser.
 */
export type BodyVars = Record<string, string>

/**
 * Os marcadores que um corpo reconhece, e **só eles**.
 *
 * Lista fechada, não `\{([^}]+)\}` genérico: ver a seção sobre a colisão com o
 * GraphQL em {@link renderBody}.
 */
const MARKER = /^\{(term|id|option:[A-Za-z0-9_-]+)\}$/

const MARKER_IN_TEXT = /\{(term|id|option:[A-Za-z0-9_-]+)\}/g

/**
 * O termo indo pra dentro de aspas de uma linguagem de consulta.
 *
 * Barra invertida primeiro, senão ela escaparia a aspa que acabamos de
 * escrever. Quebra de linha vira espaço porque apicalypse termina instrução com
 * `;` e uma quebra no meio de uma string literal é recusada pelo parser dele —
 * e o termo vem de uma caixa de texto, onde colar um título com quebra é
 * normal.
 */
function escapeForQuotes(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ')
}

/**
 * Um valor que entra na consulta **sem aspas em volta**, como o `{id}` de
 * `where id = {id};`.
 *
 * ── Por que o escape de aspas NÃO serve aqui ───────────────────────────────
 * Ele protege o que está *dentro* de uma string literal. Solto na sintaxe, o
 * valor é a sintaxe: um id como `1 | id = 2` não tem aspa nenhuma pra escapar
 * e mesmo assim reescreve a consulta. E o id vem de terceiro — da URL de
 * `/api/search/{provider}/{id}`, que qualquer pessoa logada digita.
 *
 * A regra é a mesma de `pathWithId`, que recusa `.` e `..` num caminho:
 * **o que não é token não vira consulta**. Fora do alfabeto seguro, o valor sai
 * vazio, e a consulta que sobra o provedor recusa com `4xx` — ruidoso, que é o
 * certo. Um id assim não pode ter vindo do provedor, então não existe resposta
 * boa a ser preservada.
 */
const TOKEN = /^[A-Za-z0-9_.-]+$/

function asToken(value: string): string {
  return TOKEN.test(value) ? value : ''
}

/**
 * Substitui os marcadores dentro de um VALOR JSON, recursivamente.
 *
 * ── Por que só a folha INTEIRA, e não interpolação ──────────────────────────
 * Porque `{id}` é sintaxe válida de GraphQL. A consulta
 * `query{Page{media(id:1){id}}}` tem `{id}` literal dentro dela, e uma
 * substituição por texto trocaria a *seleção de campo* pelo id da obra,
 * produzindo uma consulta inválida — ou, pior, uma consulta válida pedindo
 * outra coisa.
 *
 * Exigir que a folha seja o marcador inteiro torna a colisão impossível por
 * construção, e não custa nada: em GraphQL o dado do usuário vai em
 * `variables`, que é sempre uma folha completa. Interpolar dentro de um texto
 * continua existindo — no apicalypse, que não tem chave nenhuma na sintaxe.
 */
function substituteInJson(value: unknown, vars: BodyVars): unknown {
  if (typeof value === 'string') {
    const matched = value.match(MARKER)
    if (!matched?.[1]) {
      return value
    }
    // Marcador que a definição não declara vira string vazia, e não viaja
    // literal — a mesma regra da query, e pelo mesmo motivo: mandar
    // `search: "{option:nsfw}"` ao provedor é pedir busca com lixo dentro.
    return vars[matched[1]] ?? ''
  }

  if (Array.isArray(value)) {
    return value.map((item) => substituteInJson(item, vars))
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        substituteInJson(item, vars),
      ]),
    )
  }

  return value
}

/**
 * O corpo declarado virando os bytes que vão na requisição.
 *
 * **Quem escapa é o dialeto, não quem escreve a definição** (schema,
 * `ProviderBody`): em JSON o `JSON.stringify` cuida disso ao serializar depois
 * da substituição; em apicalypse o termo entra entre aspas e o escape é nosso.
 * É por isso que os dois são ramos diferentes de uma união em vez de um campo
 * de texto com um "tipo" ao lado — escapar errado numa linguagem de consulta
 * não é resultado feio, é injeção.
 */
export function renderBody(spec: ProviderBody, vars: BodyVars): RenderedBody {
  if (spec.kind === 'json') {
    return {
      text: JSON.stringify(substituteInJson(spec.value, vars)),
      contentType: 'application/json',
    }
  }

  /**
   * **O escape depende de ONDE o marcador está, e a definição já diz isso.**
   *
   * `{term}` só aparece entre aspas — é prosa, e prosa em linguagem de consulta
   * mora numa string literal. `{id}` e as opções aparecem soltos, comparados
   * com `=`, e ali o valor É sintaxe. Um escape só para os dois protegeria o
   * primeiro e deixaria o segundo aberto.
   */
  return {
    text: spec.template.replace(MARKER_IN_TEXT, (_todo, key: string) => {
      const value = vars[key] ?? ''
      return key === 'term' ? escapeForQuotes(value) : asToken(value)
    }),
    contentType: 'text/plain',
  }
}

/**
 * As opções efetivas viradas marcadores de corpo — `nsfw` vira `option:nsfw`.
 *
 * O prefixo existe pra que uma opção chamada `term` não sequestre o marcador do
 * termo de busca: o nome da opção é dado do usuário, e namespace é mais barato
 * que uma regra dizendo quais nomes ele não pode escolher.
 */
export function optionVars(
  optionValues: Record<string, string | boolean>,
): BodyVars {
  return Object.fromEntries(
    Object.entries(optionValues).map(([key, value]) => [
      `option:${key}`,
      String(value),
    ]),
  )
}
