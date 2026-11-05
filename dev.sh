#!/usr/bin/env bash
#
# Ambiente de desenvolvimento das Delícias Gourmet.
#
#   ./dev.sh              # sobe infraestrutura + API (:8081) + Vite (:5173)
#   ./dev.sh stop         # para API e Vite (infraestrutura continua)
#   ./dev.sh status       # mostra containers, processos e saúde da API
#   ./dev.sh backup       # gera um arquivo com banco + imagens do SeaweedFS
#   ./dev.sh restore ARQ  # restaura banco + imagens de um backup
#   ./dev.sh reset        # APAGA banco e imagens (pede confirmação e faz backup)
#
# Ctrl+C encerra a API e o Vite. Os containers de PostgreSQL/SeaweedFS
# continuam rodando para o próximo uso (use `./dev.sh reset` para apagar tudo).
#
# Arquivos de estado ficam em .dev/ (ignorado pelo git):
#   api.pid, front.pid, front.container, dev.pid, api.log, front.log, backups/

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DEV_DIR="$ROOT/.dev"
mkdir -p "$DEV_DIR"

API_PID_FILE="$DEV_DIR/api.pid"
FRONT_PID_FILE="$DEV_DIR/front.pid"
FRONT_CONTAINER_FILE="$DEV_DIR/front.container"
DEV_PID_FILE="$DEV_DIR/dev.pid"
API_LOG="$DEV_DIR/api.log"
FRONT_LOG="$DEV_DIR/front.log"
BACKUP_DIR="${BACKUP_DIR:-$DEV_DIR/backups}"
LOG_MAX_BYTES="${LOG_MAX_BYTES:-5242880}"

VENV=""
PY=""
FRONT_WRAPPER_PID=""

info() { printf '\033[1;33m[dev]\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m[dev]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;35m[dev]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[dev]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Uso: ./dev.sh [comando]

  (sem comando)     Sobe PostgreSQL, SeaweedFS, a API (:8081) e o Vite (:5173).
  stop              Para a API e o Vite iniciados por este script.
  status            Mostra containers, processos e saúde da API.
  backup            Backup do banco (pg_dump) + imagens do SeaweedFS.
  restore [arquivo] Restaura o banco + imagens a partir de um .tar.gz.
  reset [--yes]     APAGA banco e imagens. Faz backup antes (use --no-backup
                    para pular). --yes não pede confirmação.
  --help            Mostra esta ajuda.

Variáveis: API_PORT, DEV_PORT, SEED_DEMO_DATA (padrão false),
BACKUP_DIR, LOG_MAX_BYTES, além das do .env.
EOF
}

# ---------------------------------------------------------------- configuração
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

API_PORT="${API_PORT:-8081}"
DEV_PORT="${DEV_PORT:-5173}"
POSTGRES_USER="${POSTGRES_USER:-delicias}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-delicias_dev_pwd}"
POSTGRES_DB="${POSTGRES_DB:-delicias}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
S3_PORT="${S3_PORT:-8333}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-delicias-gourmet}"
PG_VOLUME="${PROJECT_NAME}_pgdata"
SEAWEED_VOLUME="${PROJECT_NAME}_seaweedfs_data"

# A API local roda no host; por isso 127.0.0.1 em vez dos nomes do compose.
export DATABASE_URL="${DATABASE_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}}"
export S3_ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:${S3_PORT}}"
export S3_ACCESS_KEY="${S3_ACCESS_KEY:-delicias}"
export S3_SECRET_KEY="${S3_SECRET_KEY:-delicias_dev_secret_key}"
export S3_BUCKET="${S3_BUCKET:-produtos}"
export S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}"
# Em desenvolvimento o catálogo de exemplo é opcional (SEED_DEMO_DATA=true).
# O seed só roda quando a tabela está vazia, então não sobrescreve dados.
export SEED_DEMO_DATA="${SEED_DEMO_DATA:-false}"
export ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-1234}"
export SECRET_KEY="${SECRET_KEY:-delicias_dev_secret_change_me}"
export COOKIE_SECURE=false
# O vite.config.js usa esta variável para saber para onde encaminhar /api.
export VITE_API_TARGET="${VITE_API_TARGET:-http://127.0.0.1:${API_PORT}}"

has_cmd() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- compose
COMPOSE=()
detect_compose() {
  if has_cmd podman-compose; then
    COMPOSE=(podman-compose -f "$ROOT/compose.yaml")
  elif has_cmd podman && podman compose version >/dev/null 2>&1; then
    COMPOSE=(podman compose -f "$ROOT/compose.yaml")
  elif has_cmd docker && docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose -f "$ROOT/compose.yaml")
  else
    fail "Instale podman-compose (ou docker compose) para subir PostgreSQL e SeaweedFS."
  fi
}

container_by_service() {
  local service="$1"
  podman ps -a \
    --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
    --filter "label=com.docker.compose.service=${service}" \
    --format '{{.Names}}' 2>/dev/null | head -n1
}

pg_container() { container_by_service postgres; }
sw_container() { container_by_service seaweedfs; }

wait_postgres() {
  local deadline=$((SECONDS + 90)) name
  while (( SECONDS < deadline )); do
    name="$(pg_container)"
    if [[ -n "$name" ]]; then
      if podman exec "$name" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

# ---------------------------------------------------------------- processos
pid_alive() {
  [[ -n "${1:-}" ]] && kill -0 "$1" 2>/dev/null
}

stop_pid_file() {
  local file="$1" label="$2" pattern="$3" pid cmdline
  [[ -f "$file" ]] || return 0
  pid="$(cat "$file" 2>/dev/null || true)"
  if pid_alive "$pid"; then
    cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
    if [[ -n "$cmdline" ]] && ! [[ "$cmdline" =~ $pattern ]]; then
      # PID reaproveitado por outro programa: nunca mate um processo alheio.
      warn "PID ${pid} não é ${label} (${cmdline}); ignorando."
      rm -f "$file"
      return 0
    fi
    info "Parando ${label} (pid ${pid})..."
    # O processo é iniciado com setsid, então o pid também é o id do grupo.
    kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      pid_alive "$pid" || break
      sleep 0.25
    done
    if pid_alive "$pid"; then
      kill -KILL -- "-${pid}" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$file"
}

stop_front_container() {
  [[ -f "$FRONT_CONTAINER_FILE" ]] || return 0
  local name
  name="$(cat "$FRONT_CONTAINER_FILE" 2>/dev/null || true)"
  if [[ -n "$name" ]] && podman container exists "$name" >/dev/null 2>&1; then
    info "Parando Vite em container (${name})..."
    podman rm -f -t 1 "$name" >/dev/null 2>&1 || true
  fi
  rm -f "$FRONT_CONTAINER_FILE"
}

stop_all_processes() {
  stop_front_container
  stop_pid_file "$FRONT_PID_FILE" "Vite" "vite|npm"
  stop_pid_file "$API_PID_FILE" "API" "uvicorn"
  rm -f "$DEV_PID_FILE"
}

port_line() {
  local port="$1"
  ss -ltnp 2>/dev/null | awk -v p=":${port}" '$4 ~ p"$" {print; exit}' || true
}

port_pid() {
  port_line "$1" | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -n1
}

require_free_port() {
  local port="$1" label="$2" line pid
  line="$(port_line "$port")"
  [[ -z "$line" ]] && return 0
  pid="$(port_pid "$port")"
  warn "A porta ${port} (${label}) já está em uso:"
  if [[ -n "$pid" ]]; then
    ps -o pid=,args= -p "$pid" 2>/dev/null | sed 's/^/       /' >&2 || true
    warn "Encerre esse processo (kill ${pid}) e tente de novo."
  else
    printf '       %s\n' "$line" >&2
  fi
  exit 1
}

rotate_log() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local size
  size="$(stat -c %s "$file" 2>/dev/null || echo 0)"
  if (( size > LOG_MAX_BYTES )); then
    mv -f "$file" "${file}.1"
  fi
}

api_ready() {
  curl -fsS --max-time 3 "http://127.0.0.1:${API_PORT}/api/ready" >/dev/null 2>&1
}

wait_api() {
  local deadline=$((SECONDS + 90)) pid
  while (( SECONDS < deadline )); do
    api_ready && return 0
    pid="$(cat "$API_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && ! pid_alive "$pid"; then
      return 1
    fi
    sleep 1
  done
  return 1
}

wait_port() {
  local port="$1" deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${port}/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

cleanup() {
  trap - EXIT INT TERM
  stop_front_container
  stop_pid_file "$FRONT_PID_FILE" "Vite" "vite|npm"
  stop_pid_file "$API_PID_FILE" "API" "uvicorn"
  rm -f "$DEV_PID_FILE"
}

# ---------------------------------------------------------------- venv/API
ensure_venv() {
  command -v python3 >/dev/null 2>&1 || fail "python3 não encontrado."
  VENV="$ROOT/backend/.venv"
  PY="$VENV/bin/python"

  if [[ ! -x "$PY" ]] || ! "$PY" -c 'import sys' >/dev/null 2>&1; then
    info "Criando virtualenv do backend em backend/.venv ..."
    rm -rf "$VENV"
    python3 -m venv "$VENV"
  fi

  local requirements="$ROOT/backend/requirements.txt"
  local stamp="$VENV/.requirements.sha256"
  local hash
  hash="$(sha256sum "$requirements" | awk '{print $1}')"

  if [[ ! -f "$stamp" ]] || [[ "$(cat "$stamp")" != "$hash" ]]; then
    info "Instalando dependências da API..."
    "$PY" -m pip install --upgrade pip >/dev/null
    "$PY" -m pip install -r "$requirements"
    printf '%s\n' "$hash" > "$stamp"
  fi
}

start_api() {
  rotate_log "$API_LOG"
  info "Iniciando API em http://127.0.0.1:${API_PORT} (log: .dev/api.log)..."
  (
    cd "$ROOT/backend"
    exec setsid env DEV_PID_FILE="$API_PID_FILE" PY="$PY" PORT="$API_PORT" \
      bash -c 'echo $$ > "$DEV_PID_FILE"; exec "$PY" -m uvicorn main:app --reload --host 127.0.0.1 --port "$PORT"'
  ) >>"$API_LOG" 2>&1 &

  if ! wait_api; then
    printf '\n' >&2
    warn "A API não subiu. Últimas linhas de .dev/api.log:"
    tail -n 40 "$API_LOG" >&2 2>/dev/null || true
    exit 1
  fi
  ok "API pronta (banco + schema verificados em /api/ready)."
}

# ---------------------------------------------------------------- frontend
start_frontend() {
  rotate_log "$FRONT_LOG"
  info "Iniciando o Vite em http://127.0.0.1:${DEV_PORT} ..."

  if has_cmd npm; then
    if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
      info "Instalando dependências do frontend..."
      (cd "$ROOT/frontend" && npm install --no-audit --no-fund)
    fi
    (
      cd "$ROOT/frontend"
      exec setsid --wait env DEV_PID_FILE="$FRONT_PID_FILE" PORT="$DEV_PORT" \
        bash -c 'echo $$ > "$DEV_PID_FILE"; exec npm run dev -- --host 127.0.0.1 --port "$PORT" --strictPort'
    ) >>"$FRONT_LOG" 2>&1 &
    FRONT_WRAPPER_PID=$!
  else
    has_cmd podman || fail "Node/npm não encontrado e Podman indisponível."
    info "Node/npm não encontrado no host; usando Node em container."
    local name="delicias-dev-web-$$"
    printf '%s\n' "$name" > "$FRONT_CONTAINER_FILE"
    podman run --rm \
      --name "$name" \
      --network host \
      --security-opt label=disable \
      -e VITE_API_TARGET="$VITE_API_TARGET" \
      -v "$ROOT/frontend:/app" \
      -v delicias-dev-node_modules:/app/node_modules \
      -w /app \
      node:22-bookworm-slim \
      sh -c "npm install --no-audit --no-fund && npm run dev -- --host 127.0.0.1 --port $DEV_PORT --strictPort" &
    FRONT_WRAPPER_PID=$!
  fi

  if ! wait_port "$DEV_PORT"; then
    warn "O Vite não respondeu em :${DEV_PORT}. Últimas linhas de .dev/front.log:"
    tail -n 30 "$FRONT_LOG" >&2 2>/dev/null || true
    exit 1
  fi
  ok "Vite pronto."
}

# ---------------------------------------------------------------- comandos
cmd_start() {
  has_cmd curl || fail "curl não encontrado."
  detect_compose

  # Limpa apenas processos que este script registrou (nunca processos alheios).
  stop_all_processes
  require_free_port "$API_PORT" "API"
  require_free_port "$DEV_PORT" "Vite"

  # A partir daqui qualquer saída (erro ou Ctrl+C) limpa o que foi iniciado.
  printf '%s\n' "$$" > "$DEV_PID_FILE"
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  info "Subindo PostgreSQL e SeaweedFS..."
  "${COMPOSE[@]}" up -d postgres seaweedfs >/dev/null

  # Em modo dev a API e o site rodam como processos locais; os containers
  # correspondentes precisam sair para liberar as portas.
  "${COMPOSE[@]}" stop api web >/dev/null 2>&1 || true

  info "Aguardando o PostgreSQL aceitar conexões..."
  wait_postgres || fail "PostgreSQL não ficou saudável em 90s. Veja: ${COMPOSE[*]} logs postgres"
  ok "PostgreSQL pronto."

  ensure_venv
  start_api
  start_frontend

  printf '\n'
  printf '\033[1;33m[dev]\033[0m Site:   http://127.0.0.1:%s\n' "$DEV_PORT"
  printf '\033[1;33m[dev]\033[0m Painel: http://127.0.0.1:%s/admin  (admin / 1234)\n' "$DEV_PORT"
  printf '\033[1;33m[dev]\033[0m API:    http://127.0.0.1:%s/api/health\n' "$API_PORT"
  printf '\033[1;33m[dev]\033[0m Ctrl+C encerra API e Vite (a infraestrutura continua).\n\n'

  if [[ -n "$FRONT_WRAPPER_PID" ]]; then
    wait "$FRONT_WRAPPER_PID" 2>/dev/null || true
  else
    # Último recurso: mantém o script vivo enquanto o Vite responder.
    while api_ready || [[ -n "$(port_line "$DEV_PORT")" ]]; do sleep 2; done
  fi
}

cmd_stop() {
  stop_all_processes
  ok "API e Vite parados. PostgreSQL/SeaweedFS continuam rodando."
  info "Para derrubar a infraestrutura: podman-compose stop"
}

cmd_status() {
  detect_compose
  printf '\nContainers:\n'
  podman ps -a \
    --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
    --format '  {{.Names}}\t{{.Status}}' 2>/dev/null || true
  if ! podman ps --filter "label=com.docker.compose.project=${PROJECT_NAME}" -q 2>/dev/null | grep -q .; then
    printf '  (nenhum; rode ./dev.sh)\n'
  fi

  printf '\nProcessos do dev:\n'
  local found=0 pid
  for entry in "API:$API_PID_FILE" "Vite:$FRONT_PID_FILE"; do
    pid="$(cat "${entry#*:}" 2>/dev/null || true)"
    if pid_alive "$pid"; then
      printf '  %s rodando (pid %s)\n' "${entry%%:*}" "$pid"
      found=1
    fi
  done
  if [[ -f "$FRONT_CONTAINER_FILE" ]]; then
    local web
    web="$(cat "$FRONT_CONTAINER_FILE" 2>/dev/null || true)"
    if [[ -n "$web" ]] && podman container exists "$web" >/dev/null 2>&1; then
      printf '  Vite rodando (container %s)\n' "$web"
      found=1
    fi
  fi
  if (( found == 0 )); then
    printf '  (nenhum; rode ./dev.sh)\n'
  fi

  printf '\nPortas:\n'
  printf '  API  :%s %s\n' "$API_PORT" "$(port_line "$API_PORT" | sed 's/^/→ /' || true)"
  printf '  Vite :%s %s\n' "$DEV_PORT" "$(port_line "$DEV_PORT" | sed 's/^/→ /' || true)"

  printf '\nSaúde:\n'
  if has_cmd curl; then
    printf '  /api/health: '
    curl -sS --max-time 3 "http://127.0.0.1:${API_PORT}/api/health" || printf '(sem resposta)'
    printf '\n  /api/ready:  '
    curl -sS --max-time 3 "http://127.0.0.1:${API_PORT}/api/ready" || printf '(sem resposta)'
    printf '\n'
  fi

  printf '\nVolumes:\n'
  podman volume ls --format '  {{.Name}}' 2>/dev/null | grep -E "(${PG_VOLUME}|${SEAWEED_VOLUME})" || printf '  (nenhum)\n'

  printf '\nBackups:\n'
  if [[ -d "$BACKUP_DIR" ]] && compgen -G "$BACKUP_DIR/*.tar.gz" >/dev/null; then
    ls -1t "$BACKUP_DIR"/*.tar.gz | head -5 | sed 's/^/  /'
  else
    printf '  (nenhum)\n'
  fi
  printf '\n'
}

cmd_backup() {
  detect_compose
  has_cmd tar || fail "tar não encontrado."

  info "Garantindo PostgreSQL e SeaweedFS..."
  "${COMPOSE[@]}" up -d postgres seaweedfs >/dev/null
  wait_postgres || fail "PostgreSQL não está disponível para o backup."

  local pg sw ts tmp archive revision
  pg="$(pg_container)"
  [[ -n "$pg" ]] || fail "Container do PostgreSQL não encontrado."
  sw="$(sw_container)"

  ts="$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_DIR"
  tmp="$BACKUP_DIR/delicias-$ts"
  archive="$BACKUP_DIR/delicias-$ts.tar.gz"
  mkdir -p "$tmp"

  info "Exportando o banco (pg_dump)..."
  podman exec "$pg" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --format=custom --no-owner --no-privileges > "$tmp/database.dump"

  revision="$(podman exec "$pg" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
    'SELECT version_num FROM alembic_version' 2>/dev/null | tr -d '[:space:]' || true)"
  printf '%s\n' "${revision:-desconhecida}" > "$tmp/revision.txt"

  if [[ -n "$sw" ]] && podman volume exists "$SEAWEED_VOLUME"; then
    info "Exportando as imagens (volume do SeaweedFS)..."
    podman volume export "$SEAWEED_VOLUME" -o "$tmp/seaweedfs.tar" >/dev/null
  else
    warn "SeaweedFS/volume não encontrado; o backup terá apenas o banco."
  fi

  {
    printf 'criado_em=%s\n' "$(date -Is)"
    printf 'banco=%s\n' "$POSTGRES_DB"
    printf 'migracao=%s\n' "${revision:-desconhecida}"
    printf 'seaweedfs=%s\n' "$([[ -f "$tmp/seaweedfs.tar" ]] && echo incluido || echo ausente)"
  } > "$tmp/manifest.txt"

  tar -C "$BACKUP_DIR" -czf "$archive" "delicias-$ts"
  rm -rf "$tmp"
  ok "Backup criado: $archive"
  printf '%s\n' "$archive"
}

cmd_restore() {
  detect_compose
  has_cmd tar || fail "tar não encontrado."

  local archive="${1:-}"
  if [[ -z "$archive" ]]; then
    archive="$(ls -1t "$BACKUP_DIR"/*.tar.gz 2>/dev/null | head -n1 || true)"
    [[ -n "$archive" ]] || fail "Nenhum backup em $BACKUP_DIR. Uso: ./dev.sh restore ARQUIVO"
    info "Usando o backup mais recente: $archive"
  fi
  [[ -f "$archive" ]] || fail "Backup não encontrado: $archive"

  local tmp; tmp="$(mktemp -d "$DEV_DIR/restore.XXXXXX")"
  tar -C "$tmp" -xzf "$archive" || fail "Não foi possível extrair $archive"
  local dump; dump="$(find "$tmp" -type f -name database.dump -print -quit)"
  [[ -n "$dump" ]] || fail "O backup não contém database.dump."

  stop_all_processes
  "${COMPOSE[@]}" stop api web >/dev/null 2>&1 || true

  info "Subindo PostgreSQL..."
  "${COMPOSE[@]}" up -d postgres >/dev/null
  wait_postgres || fail "PostgreSQL não ficou saudável."
  local pg; pg="$(pg_container)"

  info "Restaurando o banco..."
  if ! podman exec -i "$pg" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      --clean --if-exists --no-owner --no-privileges < "$dump"; then
    warn "pg_restore retornou avisos; confira o schema em ./dev.sh status."
  fi

  local sea; sea="$(find "$tmp" -type f -name seaweedfs.tar -print -quit)"
  if [[ -n "$sea" ]]; then
    info "Restaurando as imagens do SeaweedFS..."
    local sw; sw="$(sw_container)"
    [[ -n "$sw" ]] && podman rm -f "$sw" >/dev/null 2>&1 || true
    podman volume rm -f "$SEAWEED_VOLUME" >/dev/null 2>&1 || true
    podman volume create "$SEAWEED_VOLUME" >/dev/null
    podman volume import "$SEAWEED_VOLUME" - < "$sea"
    "${COMPOSE[@]}" up -d seaweedfs >/dev/null
  else
    warn "Backup sem imagens; mantendo o volume atual do SeaweedFS."
  fi

  # Adota banco legado e aplica migrações pendentes antes de reabrir a API.
  if [[ -x "$ROOT/backend/.venv/bin/python" ]]; then
    info "Aplicando migrações pendentes..."
    (cd "$ROOT/backend" && .venv/bin/python -c \
      'import asyncio; from app.bootstrap import ensure_schema; asyncio.run(ensure_schema())')
  fi

  rm -rf "$tmp"
  ok "Restauração concluída. Rode ./dev.sh para subir a aplicação."
}

cmd_reset() {
  detect_compose
  local assume_yes=0 do_backup=1
  for arg in "$@"; do
    case "$arg" in
      --yes|-y) assume_yes=1 ;;
      --no-backup) do_backup=0 ;;
      *) fail "Opção desconhecida no reset: $arg" ;;
    esac
  done

  warn "Isto APAGA o banco (volume ${PG_VOLUME}) e as imagens (${SEAWEED_VOLUME})."
  if (( assume_yes == 0 )); then
    read -r -p "Digite 'reset' para confirmar: " answer
    [[ "$answer" == "reset" ]] || fail "Cancelado."
  fi

  stop_all_processes

  local archive="" pgc
  pgc="$(pg_container)"
  if (( do_backup == 1 )) && [[ -n "$pgc" ]]; then
    archive="$(cmd_backup | tail -n1)"
    info "Backup de segurança: $archive"
  elif (( do_backup == 1 )); then
    warn "PostgreSQL não está rodando; não há como fazer backup."
    if (( assume_yes == 0 )); then
      read -r -p "Continuar sem backup? [s/N] " answer
      [[ "$answer" =~ ^[sS]$ ]] || fail "Cancelado."
    fi
  fi

  info "Derrubando containers e removendo volumes..."
  "${COMPOSE[@]}" down -v >/dev/null 2>&1 || "${COMPOSE[@]}" down --volumes >/dev/null 2>&1 || true
  podman volume rm -f "$PG_VOLUME" >/dev/null 2>&1 || true
  podman volume rm -f "$SEAWEED_VOLUME" >/dev/null 2>&1 || true

  ok "Banco e imagens apagados."
  if [[ -n "$archive" ]]; then
    info "Backup preservado em: $archive"
  fi
  info "Rode ./dev.sh para recriar tudo do zero."
}

# ---------------------------------------------------------------- dispatch
command="${1:-start}"
case "$command" in
  start|"")
    cmd_start
    ;;
  stop)
    cmd_stop
    ;;
  status)
    cmd_status
    ;;
  backup)
    shift
    cmd_backup "$@"
    ;;
  restore)
    shift
    cmd_restore "$@"
    ;;
  reset)
    shift
    cmd_reset "$@"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    fail "Comando desconhecido: $command (use --help)"
    ;;
esac
