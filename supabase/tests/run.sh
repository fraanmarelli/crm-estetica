#!/usr/bin/env bash
# Pruebas de la base: crea una base descartable, le aplica todas las migraciones y corre cada
# supabase/tests/*.test.sql. Si una cuenta da distinto de lo esperado, termina con error.
#
# Uso: bash supabase/tests/run.sh   (usa PGHOST, PGPORT y PGUSER del entorno; por defecto localhost)
# En GitHub corre solo en cada cambio (.github/workflows/pruebas.yml).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
DB="${TEST_DB:-crm_pruebas}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc)
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$DIR/setup.sql" >/dev/null

for f in "$ROOT"/supabase/migrations/*.sql; do
  # pg_cron y pg_net no existen en un Postgres común: setup.sql ya trae sus reemplazos
  sed -E '/create extension if not exists (pg_cron|pg_net)/d' "$f" \
    | "${PSQL[@]}" -d "$DB" -f - >/dev/null 2>"$DIR/.migracion.log" \
    || { echo "✕ Falló la migración $(basename "$f")"; cat "$DIR/.migracion.log"; exit 1; }
done
rm -f "$DIR/.migracion.log"
echo "✓ $(ls "$ROOT"/supabase/migrations/*.sql | wc -l) migraciones aplicadas"

status=0
for t in "$DIR"/*.test.sql; do
  echo "— $(basename "$t")"
  # Cada archivo abre una transacción y la deshace al final: las pruebas no se pisan entre sí
  if ! "${PSQL[@]}" -d "$DB" -f "$t"; then status=1; fi
done

[ "${KEEP_DB:-}" = "1" ] || "${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
exit $status
