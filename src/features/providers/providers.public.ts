import { z } from '@hono/zod-openapi'

const OptionSpecSchema = z.discriminatedUnion('type', [
  z.object({
    key: z.string(),
    type: z.literal('boolean'),
    label: z.string(),
    default: z.boolean(),
  }),
  z.object({
    key: z.string(),
    type: z.literal('string'),
    label: z.string(),
    default: z.string(),
  }),
])

/**
 * De onde a credencial que está valendo veio — e é o campo que faz a tela
 * conseguir ser honesta em dois casos diferentes (brief, 3.10):
 *
 * - `env` e `file` **desabilitam o campo** com o motivo. Config em duas fontes
 *   sem indicação é a armadilha clássica: a pessoa edita, salva, e nada acontece
 * - `embedded` vira **estado na linha do provedor** — "usa a chave embutida" —,
 *   que não é dispensável porque não é aviso, é descrição da linha, e some
 *   sozinho quando deixa de ser verdade
 */
export const CredentialStateSchema = z.object({
  key: z.string(),
  label: z.string(),
  help: z.string().optional(),
  /**
   * **Nunca o segredo.** O `GET` devolve se está configurada e, no máximo, os
   * últimos caracteres — é isso que impede a chave de vazar pela API pra
   * qualquer usuário logado, pra uma extensão de navegador ou pra dentro de um
   * screenshot de suporte (brief, 3.10). Não há criptografia em repouso, e é
   * decisão: o que protege é este campo não existir.
   */
  configured: z.boolean(),
  /** Os últimos quatro caracteres, só pra pessoa reconhecer qual chave é. */
  hint: z.string().nullable(),
  source: z.enum(['env', 'file', 'stored', 'embedded', 'none']),
  /** `true` quando env ou arquivo vencem, e a tela trava o campo. */
  overridden: z.boolean(),
})

export const ProviderSchema = z.object({
  slug: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  /** Condição de uso quando existe, não cortesia (brief, 3.10). */
  attribution: z.string().nullable(),
  authStyle: z.string(),
  credentials: z.array(CredentialStateSchema),
  options: z.array(OptionSpecSchema),
  /** Valor legível por todos; só admin escreve (brief, 3.10). */
  optionValues: z.record(z.string(), z.union([z.string(), z.boolean()])),
  /**
   * Os tipos de mídia que este provedor serve, por slug.
   *
   * Vazio é **ocioso, não quebrado** — é o estado de um provedor semeado numa
   * instalação cujo wizard não semeou o tipo correspondente (brief, 3.9), e a
   * tela diz isso em vez de tratar como erro.
   */
  mediaTypes: z.array(z.string()),
  /**
   * Se ele consegue buscar agora: toda credencial declarada resolvida.
   * Provedor sem credencial declarada (AniList, Open Library) nasce pronto.
   */
  ready: z.boolean(),
})

export type ProviderPublic = z.infer<typeof ProviderSchema>

/**
 * O corpo do `PATCH`, e ele **mescla em vez de substituir** — ao contrário do
 * mapa de nomes de um tipo de mídia, que vai inteiro.
 *
 * A assimetria é deliberada e vale escrever, porque de longe parece
 * inconsistência. Lá substituir é o que torna **apagar uma tradução** possível.
 * Aqui substituir obrigaria a tela a mandar TODOS os segredos a cada
 * salvamento — e ela não os tem, porque o `GET` nunca os devolveu. Mesclar é a
 * única forma que não pede à tela um dado que ela não pode ter.
 *
 * **String vazia limpa a credencial.** É como se apaga uma, e a diferença entre
 * "não mandei" e "mandei vazio" é justamente o que a mesclagem precisa
 * distinguir.
 */
export const ProviderPatchSchema = z.object({
  credentials: z.record(z.string(), z.string()).optional(),
  options: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
})

/**
 * O resultado de bater no endpoint mais barato do provedor.
 *
 * **Validar no salvamento, não na primeira busca** (brief, 3.10): sem isto,
 * chave errada só aparece muito depois, dentro de uma busca, e se lê como "o
 * provedor está quebrado".
 */
export const ProviderTestSchema = z.object({
  ok: z.boolean(),
  /** O status HTTP do provedor, quando houve resposta. */
  status: z.number().int().nullable(),
  /** Sempre presente: no sucesso descreve o que respondeu, na falha o porquê. */
  message: z.string(),
  /**
   * **O que o PROVEDOR escreveu**, quando ele escreveu alguma coisa — cru,
   * truncado e sem tradução (08/09/2026, decisão do dono).
   *
   * `message` acima é copy NOSSA e diz a categoria: *"AniList refused the
   * request (403)"*. Isto é o corpo da resposta dele, e é onde mora a frase que
   * a categoria não alcança — *"The AniList API has been temporarily disabled"*
   * explica o 403 de um jeito que nenhuma categoria nossa explicaria.
   *
   * **Não tem como ser traduzido**, e isso é fato e não escolha: traduzir em
   * runtime pediria um serviço externo, e um mapa de mensagens conhecidas
   * nasceria desatualizado — o caso interessante é sempre o que ele não casa.
   * O que se traduz é a categoria, que já está em `message`.
   *
   * **Só o diagnóstico do admin recebe isto.** A recusa da busca, que é tela de
   * usuário, continua com a categoria e mais nada: lá quem lê não pode fazer
   * nada com a informação, e a frase entraria em inglês ao lado de copy
   * traduzida.
   *
   * Nulo quando não houve corpo, quando ele veio vazio, ou quando ele é HTML —
   * ver `providerDetail`.
   */
  detail: z.string().nullable(),
})
