#!/bin/sh
# Valida a mensagem de commit contra o padrão Angular Conventional Commits.
# Convenção completa: ../.claude/commit-convention.md
#
# Portado do projeto irmão Negocia. Se o repositório client/ nascer com o
# mesmo hook, este arquivo é duplicado lá — os repositórios são
# independentes e não podem compartilhar arquivo. Ao alterar um, altere o outro.

MSG_FILE="$1"

if [ ! -f "$MSG_FILE" ]; then
  echo "commit-msg: arquivo de mensagem não encontrado" >&2
  exit 1
fi

TYPES='build|ci|docs|feat|fix|perf|refactor|test'

# Descarta comentários do template do git
MSG=$(grep -v '^#' "$MSG_FILE")
HEADER=$(printf '%s\n' "$MSG" | sed -n '1p')

fail() {
  echo "" >&2
  echo "  ✖ Commit rejeitado: $1" >&2
  echo "" >&2
  echo "  Header recebido:" >&2
  echo "    $HEADER" >&2
  echo "" >&2
  echo "  Formato:  <type>(<scope>): <summary>" >&2
  echo "  Types:    build, ci, docs, feat, fix, perf, refactor, test" >&2
  echo "  Summary:  inglês, imperativo presente, minúscula, sem ponto final" >&2
  echo "            \"If applied, this commit will ___\"" >&2
  echo "" >&2
  echo "  Exemplo:  feat(piles): add pile creation endpoint" >&2
  echo "" >&2
  echo "  Convenção completa: .claude/commit-convention.md (raiz do projeto)" >&2
  echo "" >&2
  exit 1
}

# Merges e reverts gerados pelo git passam direto
case "$HEADER" in
  "Merge "*|"Revert "*|"fixup!"*|"squash!"*) exit 0 ;;
esac

# Revert no formato Angular
if printf '%s' "$HEADER" | grep -qE '^revert: .+'; then
  exit 0
fi

if ! printf '%s' "$HEADER" | grep -qE "^($TYPES)(\([a-z0-9-]+\))?: .+"; then
  fail "header fora do formato, ou type inválido (lembre: chore e style não existem)"
fi

SUMMARY=$(printf '%s' "$HEADER" | sed -E "s/^($TYPES)(\([a-z0-9-]+\))?: //")

if printf '%s' "$SUMMARY" | grep -qE '\.$'; then
  fail "o summary não pode terminar com ponto final"
fi

if printf '%s' "$SUMMARY" | grep -qE '^[A-Z]'; then
  fail "o summary não deve começar com letra maiúscula"
fi

# Tempo verbal. Não dá para inferir modo imperativo por regex, então usamos uma
# lista explícita dos verbos que de fato aparecem errados em commits — passado,
# terceira pessoa e gerúndio. Lista fechada de propósito: uma regra genérica do
# tipo "termina em -ed" rejeitaria imperativos legítimos como "seed" e "embed".
NOT_IMPERATIVE='add(ed|s|ing)|fix(ed|es|ing)|updat(ed|es|ing)|remov(ed|es|ing)'
NOT_IMPERATIVE="$NOT_IMPERATIVE|chang(ed|es|ing)|creat(ed|es|ing)|delet(ed|es|ing)"
NOT_IMPERATIVE="$NOT_IMPERATIVE|renam(ed|es|ing)|mov(ed|es|ing)|improv(ed|es|ing)"
NOT_IMPERATIVE="$NOT_IMPERATIVE|refactor(ed|s|ing)|implement(ed|s|ing)|replac(ed|es|ing)"
NOT_IMPERATIVE="$NOT_IMPERATIVE|introduc(ed|es|ing)|migrat(ed|es|ing)|bump(ed|s|ing)"
NOT_IMPERATIVE="$NOT_IMPERATIVE|appl(ied|ies)|allow(ed|s|ing)|prevent(ed|s|ing)"

FIRST_WORD=$(printf '%s' "$SUMMARY" | awk '{ print tolower($1) }')
if printf '%s' "$FIRST_WORD" | grep -qE "^($NOT_IMPERATIVE)$"; then
  fail "\"$FIRST_WORD\" não está no imperativo presente — use a forma base do verbo"
fi

LONG_LINE=$(printf '%s\n' "$MSG" | awk 'length > 100 { print NR; exit }')
if [ -n "$LONG_LINE" ]; then
  fail "a linha $LONG_LINE passa de 100 caracteres"
fi

# Se houver corpo, a segunda linha precisa estar em branco
BODY_START=$(printf '%s\n' "$MSG" | sed -n '2p')
if [ -n "$BODY_START" ]; then
  fail "deixe uma linha em branco entre o header e o corpo da mensagem"
fi

exit 0
