#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

groupmod --non-unique --gid "$PGID" watchpile
usermod --non-unique --uid "$PUID" watchpile

mkdir -p /data
chown -R watchpile:watchpile /data

exec gosu watchpile "$@"
