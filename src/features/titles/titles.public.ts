import { z } from '@hono/zod-openapi'

/**
 * A forma do DETALHE de uma obra, e ela é **uma só para os dois endereços**.
 *
 * `/api/search/{provider}/{id}` responde sobre uma obra que ainda não é de
 * ninguém; `/api/entries/{id}/details` responde sobre a que já é sua. São
 * telas diferentes por decisão do dono em 01/09/2026 — uma lê ao vivo, a outra
 * lê do que já se guardou —, mas **o que elas mostram é a mesma coisa**, e um
 * schema só é o que garante que continuem parecidas.
 *
 * O que NÃO está aqui é o estado do usuário: progresso, status, nota, notas e
 * pilhas continuam vindo de `GET /api/entries/{id}`, que é onde eles moram. A
 * tela junta os dois; o contrato não os mistura, porque metade deles não
 * existe para uma obra que ninguém adicionou.
 */
export const TitleDetailsSchema = z.object({
  provider: z.object({
    slug: z.string(),
    /** O nome próprio: **slug é chave, não rótulo** (design system, seção 8). */
    name: z.string(),
    /**
     * A frase que o provedor exige como condição de uso, ou nulo. Vem do
     * provedor que RESPONDEU, nunca uma constante da tela — o TMDB pede, o
     * AniList não, e uma tela que escrevesse a do TMDB fixa creditaria o
     * provedor errado (design system, seção 8, sétima leva).
     */
    attribution: z.string().nullable(),
  }),
  externalId: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  synopsis: z.string().nullable(),
  /**
   * O endereço da arte.
   *
   * **Muda de natureza conforme quem pergunta**, e é a distinção de 01/09/2026
   * (brief, 3.10): para a obra que ainda não é sua vem o hotlink da CDN, porque
   * a tela não funciona offline de jeito nenhum; para a obra sua vem a nossa
   * rota de cache. O cliente não precisa saber a diferença — ele desenha o
   * endereço que recebe.
   */
  art: z.string().nullable(),
  /**
   * O que a obra é DENTRO do tipo dela — `TV`, `Mod`, `One Shot`.
   *
   * **É o que separa duas linhas com o mesmo título** na busca: o IGDB devolve
   * o jogo e um Mod chamado igual, e sem isto nada na tela os distingue. Nulo
   * nos provedores que não têm o conceito (TMDB, Open Library).
   *
   * Já chega normalizado — ver `subtypeLabel`. O cliente desenha o que recebe.
   */
  subtype: z.string().nullable(),
  /** Quantas unidades a obra tem, quando o provedor sabe. */
  total: z.number().int().nullable(),
  /**
   * A nota do provedor, e quantos votaram.
   *
   * **Contexto, nunca dado da obra** — `entries.rating` é a nota de quem usa. A
   * tela põe as duas lado a lado justamente porque são coisas diferentes: uma
   * se edita, a outra se lê. Nulo é provedor que não pontua.
   */
  score: z.number().nullable(),
  votes: z.number().int().nullable(),
  /**
   * Os VÍNCULOS desta obra com outras do MESMO provedor — 02/09/2026.
   *
   * **Não confundir com `links`**, logo abaixo: aquilo aponta pra fora (IMDb,
   * Wikidata) e é URL pronta; isto aponta pra outra obra do mesmo catálogo, que
   * a tela abre sem sair do produto. Por isso carrega `provider`, `externalId`
   * **e `type`** — os três que a rota de detalhe precisa, porque no TMDB o
   * mesmo id é uma série e outro filme.
   *
   * `kind` é o que vira título de seção: `Prequel`, `Adaptation`, `Parent`. Ele
   * já chega normalizado — o AniList escreve `ADAPTATION` e o Kitsu escreve
   * `adaptation`, e a tela não deveria saber disso.
   *
   * **Lista vazia é o caso comum**, e cobre três situações que a tela não
   * precisa distinguir: o provedor não tem o conceito, a obra não tem vínculo,
   * ou a busca deles falhou. Em nenhuma há algo que ela possa fazer.
   */
  relations: z.array(
    z.object({
      kind: z.string().nullable(),
      provider: z.string(),
      externalId: z.string(),
      type: z.string(),
      title: z.string(),
      year: z.number().int().nullable(),
      art: z.string().nullable(),
    }),
  ),
  /**
   * As RECOMENDAÇÕES desta obra, no provedor que respondeu — 03/09/2026.
   *
   * **A mesma forma de `relations`, campo à parte.** A forma é a mesma porque
   * medir mostrou que é — os três provedores que a servem devolvem obra do
   * mesmo catálogo, com id, título, arte, ano e tipo. O campo é à parte porque
   * o significado não é: um vínculo AFIRMA (isto é a prequela daquilo), uma
   * recomendação SUGERE, e a tela precisa da diferença pra não pôr as duas sob
   * o mesmo cabeçalho.
   *
   * **`kind` vem sempre nulo aqui**, e por isso o campo não sumiu da forma: ele
   * existe pra tela poder tratar as duas listas com a mesma peça. Quem nomeia
   * esta seção é a tela — nenhum provedor nomeia a relação, porque não há
   * relação a nomear, e escrever `Recommended` aqui seria copy de tela nascendo
   * no servidor.
   *
   * **Lista vazia é o caso comum e cobre três situações** que a tela não
   * precisa distinguir, como em `relations`: o provedor não tem o conceito
   * (Kitsu, Open Library, Jikan), a obra não tem recomendação, ou ela não veio.
   */
  recommendations: z.array(
    z.object({
      kind: z.string().nullable(),
      provider: z.string(),
      externalId: z.string(),
      type: z.string(),
      title: z.string(),
      year: z.number().int().nullable(),
      art: z.string().nullable(),
    }),
  ),
  /**
   * Links para fora, montados pelo servidor. **Contexto do provedor, não
   * `external_ids`** — IMDb e Wikidata não são provedores que este servidor
   * conhece, e criar linha pra eles seria inventar provedor sem configuração.
   *
   * Vazio é o caso comum: provedor que não devolve nenhum.
   */
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  /**
   * O id da obra na biblioteca de quem perguntou, ou nulo.
   *
   * Em `/api/entries/{id}/details` ele é sempre o próprio id — redundante ali
   * de propósito, porque é o que deixa a tela ser a mesma peça nos dois
   * endereços em vez de dois componentes que se parecem.
   */
  ownedEntryId: z.number().int().nullable(),
  /**
   * Os GRUPOS de unidades — temporadas, volumes (brief, 3.10).
   *
   * **O `name` vem do provedor**, não de nós: o TMDB manda "Season 1", e é ele
   * quem sabe como o agrupamento daquele catálogo se chama, no idioma que a
   * opção pediu. Nunca escrevemos "Temporada" em lugar nenhum.
   *
   * Lista vazia é o caso comum e legítimo — filme, jogo e livro não têm
   * unidades, e a tela então não desenha faixa nem lista.
   */
  unitGroups: z.array(
    z.object({
      number: z.number().int(),
      name: z.string(),
      count: z.number().int().nullable(),
      /** Emprestada da CDN: o cache em disco é por OBRA, e grupo não é obra. */
      art: z.string().nullable(),
    }),
  ),
  /** Se há de onde listar unidades. Falso dispensa a tela de pedir. */
  hasUnits: z.boolean(),
  /**
   * De QUANDO é esta resposta, quando ela não é de agora — 07/09/2026.
   *
   * Nulo é o caso normal: o provedor respondeu, e o que está aqui é o que ele
   * acabou de dizer. Preenchido significa que ele **não** respondeu e que o
   * servidor degradou para o snapshot que guardou da última vez que ele
   * respondeu — a obra continua inteira, e `fetchedAt` diz de quando ela é.
   *
   * **A data existe porque degradar em silêncio seria mentir.** Servir uma
   * sinopse de dois meses atrás como se fosse a de agora é a mesma família de
   * má atribuição que os consertos do 504 do Jikan e do 403 do AniList tiraram
   * da busca: a tela afirmaria com confiança algo que ninguém verificou.
   *
   * **Não confundir com `provider_cache`.** Aquilo são 6h de respostas cruas
   * para poupar cota, e uma resposta servida de lá continua sendo "de agora"
   * para efeito desta tela. Isto é o que sobra quando não há resposta nenhuma.
   *
   * Quando preenchido, `relations`, `recommendations`, `links` e `unitGroups`
   * vêm vazios e `hasUnits` vem falso — não porque não existam, mas porque
   * viriam do provedor que acabou de não responder.
   */
  snapshot: z
    .object({
      fetchedAt: z.string(),
      /**
       * POR QUE não foi possível perguntar agora — o mesmo vocabulário de
       * recusa que a busca usa.
       *
       * **Ele existe para a recusa não sumir junto com o erro.** Sem chave
       * configurada, degradar em silêncio faria a tela mostrar a obra e apagar
       * o único sinal de que há algo a arrumar; com o motivo, ela mostra a obra
       * **e** diz o que aconteceu — que é *a recusa mora na peça que a causou*
       * (design system, seção 8) em vez de a recusa tomar a tela inteira.
       *
       * **É o enum de `DetailFailure` menos `not-found`**, e não o da busca: a
       * divisão de 02/09 (`provider-refused` contra `provider-down`) ficou de
       * fora do detalhe por escopo, e inventá-la aqui poria dois vocabulários
       * de recusa no mesmo repositório. `not-found` não aparece porque ele não
       * degrada — o provedor respondeu, e respondeu que não tem.
       *
       * Dos quatro, só `not-configured` tem o que arrumar; os outros três têm o
       * que esperar. Quem decide o tom é a tela.
       */
      reason: z.enum([
        'not-configured',
        'rate-limited',
        'provider-error',
        'unreachable',
      ]),
    })
    .nullable(),
})

export type TitleDetails = z.infer<typeof TitleDetailsSchema>
