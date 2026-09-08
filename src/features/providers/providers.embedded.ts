/**
 * As credenciais que o PRODUTO embarca.
 *
 * **Revertido em 30/08/2026** (brief, 3.10): a versão anterior do brief dizia
 * "nunca embarcar chave própria". Duas coisas sustentam o contrário, e nenhuma
 * é descuido:
 *
 * - **O modo de falha é degradação, não quebra.** Se a chave embarcada for
 *   suspensa, ela sai numa release e o produto volta a "configure a sua" — que
 *   é exatamente o estado que existiria sem embarcar. Não há caminho em que o
 *   usuário fique sem saída
 * - **É o que o Yamtrack faz**, e ele é a referência mais próxima. As chaves
 *   dele estão hardcoded em `src/config/settings.py`, em repositório público,
 *   com a mesma precedência env > arquivo de secret > literal
 *
 * **O risco não é igual entre provedores, e é por isso que o v1 é só TMDB.** Os
 * termos do TMDB não têm cláusula mandando manter a chave em segredo; os da
 * Twitch (auth do IGDB) têm, e são literais — "Treat client secrets as you
 * would your password". Embarcar o secret do IGDB é decisão à parte, e chega
 * junto com o provedor de jogos.
 *
 * ── As chaves NÃO moram aqui: elas entram no BUILD — 08/09/2026 ────────────
 * Os dois literais abaixo são vazios **no repositório**, e é decisão do dono,
 * tomada quando ele decidiu abrir os repos. Quem os preenche é
 * `scripts/embed-credentials.mjs`, rodado pelo CI a partir de secrets do
 * GitHub, imediatamente antes de empacotar.
 *
 * **O que isso compra, e o que não compra.** A imagem publicada é pública, e
 * quem a baixar consegue ler a chave das camadas — isso não muda. O que muda é
 * que a chave **deixa de estar em fonte pública**, que é onde robô de varredura
 * procura: chave em repositório aberto é achada em horas, chave dentro de
 * camada de imagem não está no caminho deles. É contenção operacional, não
 * segredo. E ela passa a ser **rotacionável sem commit**.
 *
 * **O preço, que é real:** quem clonar e construir localmente NÃO tem a chave —
 * a instalação dele pede a própria em Settings, e o app dele difere do que
 * baixaria pronto. A favor disso: a nossa cota deixa de ser gasta por toda
 * execução de desenvolvimento no mundo. Contra: a imagem publicada não é
 * reproduzível byte a byte a partir da fonte pública, o que não é problema de
 * AGPL (o fonte está completo; credencial é configuração) mas é uma coisa que
 * quem compilar vai notar.
 *
 * ── O que NÃO se resolve por aqui, e está registrado porque é permanente ────
 * O Client ID do MyAnimeList **esteve como literal** entre 07/09 e 08/09/2026,
 * no commit `a810b1e`, que entrou pelo PR #72. Tirá-lo da árvore não o tira do
 * PR: um force-push reescreveria a `dev` e o commit continuaria acessível pelo
 * endereço dele, e só o suporte do GitHub purga aquilo. **O que resolve é
 * rotacionar no provedor** — e é por isso que esta nota existe em vez de uma
 * promessa de limpeza.
 *
 * `env` NÃO serve pra isto, e a tentação é real: ela é o degrau MAIS ALTO da
 * cadeia (`providers.credentials.ts`) e **desabilita o campo em Settings**, com
 * o motivo escrito. Uma imagem que trouxesse a chave por env tiraria de quem
 * instala a possibilidade de pôr a dele — que é exatamente a saída de que o
 * modo de falha aceito depende.
 *
 * ── O modo de falha, que não mudou ─────────────────────────────────────────
 * Literal vazio significa que uma instalação nova **degrada para "configure a
 * sua"**. É o que acontece num build local, e é o que acontece se um secret
 * faltar no CI. Suspensa a chave, ela sai numa release e o produto volta ao
 * mesmo lugar.
 */

/**
 * Os literais que o CI substitui. Duas constantes soltas, e não os valores
 * escritos dentro do objeto abaixo, porque a substituição é por REGEX: um alvo
 * nomeado e numa linha só é o que a torna previsível sem um parser.
 */
const EMBEDDED_TMDB_API_KEY = ''
const EMBEDDED_MAL_CLIENT_ID = ''
export const EMBEDDED_CREDENTIALS: Record<
  string,
  Record<string, string> | undefined
> = {
  tmdb: { api_key: EMBEDDED_TMDB_API_KEY },
  mal: { client_id: EMBEDDED_MAL_CLIENT_ID },
}
