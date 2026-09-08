/**
 * O acervo de ícones de tipo de mídia — 94 glifos do `lucide-react`, curados.
 *
 * **Curado, e não "o Lucide inteiro" (~2000).** A restrição não é quantos
 * glifos existem, é **quantos ainda se leem a 12px dentro do selo de vidro da
 * carta** (design system, seções 2 e 5). A curadoria foi feita renderizando
 * cada candidato no tamanho real, sobre o selo real, e cortando o que virou
 * mancha — medindo, não estimando.
 *
 * Dois padrões apareceram nessa medição, e valem pra qualquer adição futura:
 *
 * 1. **Ícone composto morre.** `book-audio`, `book-heart`, `scroll-text` e
 *    `message-square-text` viram todos "retângulo com ruído dentro" — o
 *    símbolo interno não sobrevive ao tamanho, e o que resta é o contêiner,
 *    igual em todos.
 * 2. **Diagonal fina some.** `guitar`, `wrench`, `telescope`, `dna` e
 *    `microscope` dependem de traço diagonal fino, e a 12px ele desaparece.
 *
 * **Não há ícone de marca, e não é escolha nossa:** o Lucide removeu os dele
 * (`youtube`, `twitch` e afins) por questão de trademark. Tipo definido pela
 * PLATAFORMA — "vídeos do YouTube" — usa o grupo de tela: `monitor-play`,
 * `circle-play`, `video`, `list-video` ou `play`.
 *
 * **Nome canônico, nunca alias.** `podcast` é alias de `mic-signal` no Lucide,
 * e alias é exatamente o que eles depreciam — foi assim que as marcas sumiram.
 * O acervo guarda o alvo.
 *
 * **Isto vira `z.enum` no contrato** (`media-types.routes.ts`), então o cliente
 * recebe a lista pelos tipos gerados, sem uma segunda rota e sem uma segunda
 * cópia escrita à mão (brief, 3.7).
 */
export const ICON_NAMES = [
  // ── Tela e imagem em movimento ──────────────────────────────────
  // O grupo que mais vai ser usado. `monitor-play`, `circle-play` e
  // `video` são a resposta pra tipo definido pela PLATAFORMA — 'vídeos do
  // YouTube' e afins —, porque o Lucide não tem ícone de marca nenhum.
  'clapperboard',
  'film',
  'monitor',
  'monitor-play',
  'tv',
  'video',
  'play',
  'circle-play',
  'square-play',
  'list-video',
  'cast',
  'camera',
  // ── Palco, sala e evento ────────────────────────────────────────
  'theater',
  'drama',
  'venetian-mask',
  'ticket',
  'popcorn',
  // ── Animação, fantasia e terror ─────────────────────────────────
  // O `sparkles` é o glifo de `anime` desde 29/08.
  'sparkles',
  'ghost',
  'castle',
  'crown',
  'skull',
  'flame',
  // ── Leitura ─────────────────────────────────────────────────────
  'book',
  'book-open',
  'book-marked',
  'bookmark',
  'library',
  'newspaper',
  'scroll',
  // ── Quadrinho e fala ────────────────────────────────────────────
  // O `message-square` é o glifo de `manga` desde 29/08.
  'message-square',
  'message-circle',
  // ── Jogos ───────────────────────────────────────────────────────
  'gamepad-2',
  'joystick',
  'dices',
  'puzzle',
  'swords',
  'shield',
  'target',
  'trophy',
  // ── Áudio ───────────────────────────────────────────────────────
  // `mic-signal` é o nome canônico de `podcast`, que no Lucide é alias.
  'headphones',
  'music',
  'disc-3',
  'disc-album',
  'album',
  'mic',
  'mic-signal',
  'radio',
  'audio-waveform',
  'speaker',
  'piano',
  // ── Arte e imagem parada ────────────────────────────────────────
  'palette',
  'image',
  // ── Web, código e aparelho ──────────────────────────────────────
  'rss',
  'globe',
  'code',
  'terminal',
  'bot',
  'smartphone',
  // ── Conhecimento ────────────────────────────────────────────────
  'graduation-cap',
  'lightbulb',
  'flask-conical',
  'scale',
  // ── Lugar e viagem ──────────────────────────────────────────────
  'map',
  'map-pin',
  'mountain',
  'trees',
  'leaf',
  'tent',
  'sailboat',
  'anchor',
  'plane',
  'car',
  'tram-front',
  // ── Casa, corpo e ofício ────────────────────────────────────────
  'chef-hat',
  'utensils',
  'cake',
  'shirt',
  'briefcase',
  'coins',
  // ── Bicho ───────────────────────────────────────────────────────
  'cat',
  'dog',
  'bird',
  // ── Marcação e afeto ────────────────────────────────────────────
  'heart',
  'star',
  'flag',
  'rocket',
  'zap',
  // ── Genérico ────────────────────────────────────────────────────
  // Último recurso — não descrevem mídia, mas cobrem o tipo que não se
  // encaixa.
  'folder',
  'archive',
  'package',
  'layers',
  'box',
  'tag',
] as const

export type IconName = (typeof ICON_NAMES)[number]
