import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'
import { mediaTypes } from './media-types.js'
import { providers } from './providers.js'

/**
 * O índice do cache de arte em disco (brief, 3.10).
 *
 * ── Por que a linha existe, se o arquivo já está no disco ───────────────────
 * O brief pede **teto configurável e descarte do menos usado**, e as duas
 * coisas precisam de dado que o sistema de arquivos não dá de forma confiável:
 * o tamanho total sem varrer o diretório inteiro, e o último uso — `atime` é
 * desligado em boa parte das montagens (`noatime`), e num NAS caseiro é o caso
 * comum. Uma linha por arquivo responde as duas em O(1) e uma consulta.
 *
 * **Isto não contradiz "regenerável vai pro disco"** (3.17): os BYTES estão no
 * disco. O que está no banco é o índice deles, que é o que torna o teto
 * cumprível — e que se reconstrói sozinho, porque perder a linha só faz a arte
 * ser buscada de novo.
 *
 * ── Por que a chave é (TIPO, provedor, id externo), e não a obra ────────────
 * **O cache é da INSTÂNCIA, não do usuário**, porque arte não é dado pessoal:
 * duas pessoas com o mesmo filme compartilham um arquivo, e é isso que faz o
 * teto valer pro servidor inteiro em vez de por conta. A rota que serve é por
 * obra, porque é a obra que diz de quem é a permissão — mas o que ela devolve
 * é o arquivo compartilhado.
 *
 * **O tipo entrou em 07/09/2026 (`0038`), e o mesmo defeito de `external_ids`
 * morava aqui:** o id de um provedor é único DENTRO do tipo. Sem ele, o anime
 * `21` e o mangá `21` do MyAnimeList dividiam UMA linha — e o segundo mostrava
 * o pôster do primeiro, plausível e sem erro nenhum. Era latente enquanto obra
 * entrava uma a uma pela busca; o import trouxe anime e mangá do mesmo provedor
 * no mesmo gesto, e o aquecimento do cache o tornou alcançável no primeiro uso.
 *
 * **O tipo entra no nome do ARQUIVO junto**, e não só no índice: o nome é o
 * hash da chave, e duas chaves diferentes com o mesmo nome se sobrescreveriam
 * no disco enquanto as duas linhas conviviam no banco.
 */
export const artCache = sqliteTable(
  'art_cache',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider')
      .notNull()
      .references(() => providers.slug, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    externalId: text('external_id').notNull(),
    /**
     * O tipo da obra a que este id pertence. **Faz parte da identidade**, não é
     * descrição: `mal/21` só é uma coisa depois de dizer se é anime ou mangá.
     *
     * `restrict` como em `external_ids`: apagar um tipo não pode levar embora,
     * calado, o índice de arquivos que estão no disco — quem apaga tipo já
     * encontra a recusa com a contagem de obras.
     */
    mediaType: text('media_type')
      .notNull()
      .references(() => mediaTypes.slug, {
        onUpdate: 'cascade',
        onDelete: 'restrict',
      }),
    /**
     * O nome do arquivo dentro do diretório de cache, derivado da chave.
     *
     * Coluna e não conta feita na hora: o id externo vem do provedor e pode
     * trazer qualquer coisa — barra, ponto-ponto, dois-pontos. Guardar o nome
     * já saneado é o que impede a chave de terceiro virar caminho.
     */
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    /**
     * Quando a arte foi servida pela última vez. É o "menos usado" do descarte
     * — LRU e não FIFO, porque a biblioteca que se olha toda semana não pode
     * ser expulsa pela que se adicionou ontem e nunca se abriu.
     */
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    unique().on(table.provider, table.externalId, table.mediaType),
    // O descarte pede as mais antigas em ordem; sem índice ele varre a tabela
    // toda vez que o teto é encostado.
    index('art_cache_last_used_idx').on(table.lastUsedAt),
  ],
)
