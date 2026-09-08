import { describe, expect, it } from 'vitest'
import { htmlToText, prose, subtypeLabel } from './providers.text.js'

describe('a prosa em HTML virando texto', () => {
  it('`<br>` vira quebra, e as variantes contam', () => {
    expect(htmlToText('um<br>dois<br/>três<BR />quatro')).toBe(
      'um\ndois\ntrês\nquatro',
    )
  })

  it('tira a marcação e deixa o texto', () => {
    expect(htmlToText('O <i>Guts</i> é o <b>protagonista</b>.')).toBe(
      'O Guts é o protagonista.',
    )
  })

  it('não é sanitizador — remove tudo, não escolhe o que é seguro', () => {
    // A distinção importa: o resultado é texto puro que a tela imprime como
    // texto, então nada aqui decide o que é perigoso.
    expect(htmlToText('antes<script>alert(1)</script>depois')).toBe(
      'antesalert(1)depois',
    )
  })

  it('decodifica as entidades que aparecem em prosa de catálogo', () => {
    expect(
      htmlToText('a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;'),
    ).toBe('a & b < c > d "e" \'f\'')
  })

  it('`&amp;lt;` continua sendo o TEXTO `&lt;`, não `<`', () => {
    // `&amp;` sai por último de propósito: fora de ordem, a decodificação
    // aconteceria duas vezes e inventaria marcação que o provedor não escreveu.
    expect(htmlToText('&amp;lt;')).toBe('&lt;')
  })

  it('junta quebra demais, que é o que o AniList escreve antes da fonte', () => {
    expect(htmlToText('texto\n<br><br>\n(Source: Crunchyroll)')).toBe(
      'texto\n\n(Source: Crunchyroll)',
    )
  })
})

describe('a leitura da prosa segue o que o PROVEDOR declara', () => {
  it('converte quando ele diz que escreve HTML', () => {
    expect(prose('um<br>dois', { textFormat: 'html' })).toBe('um\ndois')
  })

  it('não toca no texto de quem não declara nada', () => {
    // A razão de o formato ser declarado em vez de limpo sempre: uma sinopse
    // com `a < b` dos outros quatro provedores sobreviveria assim mesmo.
    expect(prose('a < b', {})).toBe('a < b')
  })

  it('nulo continua nulo, e HTML que só tinha tag VIRA nulo', () => {
    expect(prose(null, { textFormat: 'html' })).toBeNull()
    expect(prose('<br>', { textFormat: 'html' })).toBeNull()
  })
})

describe('o subtipo virando rótulo', () => {
  it('preserva sigla curta em MAIÚSCULAS', () => {
    // O caso que faz title-case ingênuo estragar o dado: `ONA` viraria `Ona`.
    expect(subtypeLabel('TV')).toBe('TV')
    expect(subtypeLabel('ONA')).toBe('ONA')
    expect(subtypeLabel('OVA')).toBe('OVA')
  })

  it('quebra o enum de máquina em palavras', () => {
    // `ONE_SHOT` do AniList — sublinhado é a marca de que aquilo não é copy.
    expect(subtypeLabel('ONE_SHOT')).toBe('One Shot')
  })

  it('capitaliza palavra gritada, que não é sigla', () => {
    // Cinco letras: `MANGA` é palavra, não sigla. É o corte em quatro que
    // separa os dois casos sem precisar de lista.
    expect(subtypeLabel('MANGA')).toBe('Manga')
    expect(subtypeLabel('SPECIAL')).toBe('Special')
  })

  it('capitaliza o minúsculo do Kitsu', () => {
    expect(subtypeLabel('manga')).toBe('Manga')
    expect(subtypeLabel('movie')).toBe('Movie')
  })

  it('deixa em paz o rótulo que já é humano', () => {
    // O IGDB é o único que devolve pronto, e a regra não pode piorá-lo.
    expect(subtypeLabel('Main Game')).toBe('Main Game')
    expect(subtypeLabel('Mod')).toBe('Mod')
  })

  it('ausência continua ausência', () => {
    expect(subtypeLabel(null)).toBeNull()
    expect(subtypeLabel('   ')).toBeNull()
  })

  /**
   * ── A sigla DECLARADA pelo par (08/09/2026) ────────────────────────────────
   *
   * A regra de FORMA acima resolve o provedor que grita; ela não tem como
   * resolver quem manda minúsculo, porque pra ela `tv` é uma palavra de duas
   * letras como outra qualquer. Quem sabe que `tv` é sigla é o PROVEDOR, e ele
   * declara em `field_map.subtypeAcronyms`.
   */
  describe('com siglas declaradas pelo par', () => {
    const ANIME = ['tv', 'ova', 'ona']

    it('grita a sigla que chegou minúscula', () => {
      // MEDIDO no MyAnimeList em 08/09/2026: `tv`, `ona`, `movie`,
      // `tv_special` — tudo minúsculo.
      expect(subtypeLabel('tv', ANIME)).toBe('TV')
      expect(subtypeLabel('ona', ANIME)).toBe('ONA')
    })

    /**
     * **O caso que a regra de forma não alcança, e de propósito.** Valor
     * composto se declarou composto, e a forma se recusa a agir nele — foi um
     * teste que ensinou isso (`ONE_SHOT` virava `ONE SHOT`). A lista declarada
     * sabe QUAL palavra é sigla, então ela age só nela.
     */
    it('grita a sigla DENTRO de um valor composto', () => {
      expect(subtypeLabel('tv_special', ANIME)).toBe('TV Special')
      // `TV_SHORT` do AniList — o motivo de o par dele carregar a lista.
      expect(subtypeLabel('TV_SHORT', ANIME)).toBe('TV Short')
    })

    it('não toca no que não está declarado', () => {
      expect(subtypeLabel('movie', ANIME)).toBe('Movie')
      expect(subtypeLabel('one_shot', ANIME)).toBe('One Shot')
    })

    it('compara sem caixa, porque a sigla é a mesma nas duas', () => {
      expect(subtypeLabel('TV', ANIME)).toBe('TV')
      expect(subtypeLabel('Tv', ANIME)).toBe('TV')
    })

    /**
     * Errar por OMISSÃO é o estado de hoje: token que falta na lista continua
     * saindo como sempre saiu. É o que torna a lista segura de crescer aos
     * poucos, e o que faz o par não medido (AniList) degradar em vez de mentir.
     */
    it('sem lista, é exatamente a regra de forma de antes', () => {
      expect(subtypeLabel('tv')).toBe('Tv')
      expect(subtypeLabel('tv', [])).toBe('Tv')
    })
  })
})
