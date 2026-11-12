#!/usr/bin/env bash
# Kører migrationen og RLS-testen mod en midlertidig lokal Postgres (kræver postgresql-16).
set -euo pipefail
cd "$(dirname "$0")"
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
DIR=$(mktemp -d)
chown postgres "$DIR" 2>/dev/null || true
RUN() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
RUN "$PGBIN/initdb -D $DIR/data -A trust -U postgres" >/dev/null
RUN "$PGBIN/pg_ctl -D $DIR/data -o '-p 5439 -k $DIR' -l $DIR/log -w start" >/dev/null
trap 'RUN "$PGBIN/pg_ctl -D $DIR/data -m immediate stop" >/dev/null; rm -rf "$DIR"' EXIT
P="psql -h $DIR -p 5439 -U postgres -q -v ON_ERROR_STOP=1"
$P -f auth_stub.sql
for f in ../../supabase/migrations/*.sql; do $P -f "$f" 2>/dev/null; done
OUT=$($P -f rls_test.sql)
if grep -qE "^ f$" <<<"$OUT"; then echo "$OUT"; echo "RLS-TEST FEJLEDE"; exit 1; fi
grep "OK" <<<"$OUT"
