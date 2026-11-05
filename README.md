# Delícias Gourmet — containers

Stack completa do projeto: site (SPA React + nginx), API (FastAPI), banco
(PostgreSQL) e storage de objetos (SeaweedFS).

```
                    ┌──────────────────────────────┐
   navegador ──────▶│  web  (nginx:80)              │
                    │  serve o SPA + proxy /api     │
                    └───────────────┬──────────────┘
                                    │ http://api:8080
                    ┌───────────────▼──────────────┐
                    │  api  (FastAPI:8080)         │
                    └──────┬───────────────┬───────┘
                           │               │
              ┌────────────▼─────┐   ┌─────▼──────────────────┐
              │ postgres:5432    │   │ seaweedfs:8333 (API S3) │
              │ volume pgdata    │   │ volume seaweedfs_data  │
              └──────────────────┘   └────────────────────────┘
```

## Arquivos

| Arquivo | Para quê |
|---|---|
| `compose.yaml` | a stack inteira (4 serviços) |
| `frontend/Containerfile` | build do Vite + nginx servindo o SPA |
| `frontend/nginx.conf` | serve o SPA e faz proxy de `/api` + `/assets/uploads` |
| `frontend/docker-entrypoint.sh` | monta o `nginx.conf` com o DNS do container |
| `backend/Containerfile` | imagem da API (Python 3.14 slim, sem root) |
| `backend/requirements.txt` | dependências da API |
| `backend/app/` | código da API (models, rotas, storage, horários, bootstrap) |
| `backend/alembic.ini` + `backend/migrations/` | migrações do banco (Alembic) |
| `dev.sh` | ambiente de desenvolvimento + backup/restore/reset |
| `infra/seaweedfs/s3.json` | credenciais da API S3 do SeaweedFS |
| `.env.example` | portas e credenciais (copie para `.env`) |

## Subir

```bash
podman compose up -d --build --force-recreate   # sobe tudo
podman compose ps                               # status e health
podman compose logs -f api                      # logs da API
podman compose down                             # derruba (os volumes sobrevivem)
```

> **Atenção (podman-compose):** o `--force-recreate` é necessário depois de
> `build`. O podman-compose não percebe que a imagem mudou e mantém o
> container antigo rodando (com a imagem antiga). Com Docker
> (`docker compose up -d --build`) isso não acontece.

> **Cuidado com `podman compose down -v`:** ele remove os volumes `pgdata` e
> `seaweedfs_data` — ou seja, **todos os produtos, pedidos e fotos**. Para
> recomeçar do zero com segurança use `./dev.sh reset`, que faz backup antes e
> pede confirmação. Para guardar uma cópia manual: `./dev.sh backup`.

## Endereços

| Serviço | URL / porta | Observação |
|---|---|---|
| Site | http://localhost:8080 | painel em http://localhost:8080/admin |
| API | http://localhost:8081 | porta 8081 porque o proxy do vite em dev aponta para ela (`frontend/vite.config.js`) |
| PostgreSQL | `localhost:5432` | user `delicias`, db `delicias`, senha `delicias_dev_pwd` |
| SeaweedFS (S3) | http://localhost:8333 | access key `delicias`, secret `delicias_dev_secret_key` |
| SeaweedFS (filer) | http://localhost:8888 | UI para ver os arquivos |
| SeaweedFS (master) | http://localhost:9333 | UI de clusters/volumes |

Portas fixas vindas do `.env` (veja `.env.example`; o compose usa os mesmos
valores como padrão se o `.env` não existir).

## Desenvolvimento local (Vite + API)

O frontend **não tem mais API própria** (o antigo `frontend/server` com
Express + SQLite foi removido). Tudo usa a API FastAPI de `backend/`.

### Atalho: `./dev.sh`

```bash
./dev.sh
```

O script:

1. encerra apenas os processos que ele mesmo registrou (PID files em `.dev/`);
2. recusa iniciar se as portas `8081`/`5173` estiverem ocupadas por processos
   alheios (mostra o PID para você decidir);
3. sobe PostgreSQL e SeaweedFS e espera o Postgres ficar saudável;
4. para os containers `api`/`web` do compose para liberar a porta `8081`;
5. cria/atualiza a virtualenv em `backend/.venv` e instala as dependências;
6. inicia a API com reload em `http://127.0.0.1:8081` e espera `/api/ready`
   (banco + schema prontos);
7. inicia o Vite em `http://127.0.0.1:5173`.

Logs ficam em `.dev/api.log` e `.dev/front.log` (append, com rotação em 5 MB).
Se `npm` não existir no host, o Vite roda em um container Node automaticamente.
`Ctrl+C` encerra a API e o Vite; PostgreSQL/SeaweedFS continuam no ar.
As portas podem ser trocadas com `API_PORT=8081 DEV_PORT=5173 ./dev.sh`.
Em desenvolvimento, `SEED_DEMO_DATA` vem como `false`; use `SEED_DEMO_DATA=true`
para inserir o catálogo de exemplo (somente quando a tabela de produtos está
vazia).

- Site: <http://127.0.0.1:5173>
- Painel: <http://127.0.0.1:5173/admin> — login `admin` / `1234`

### Operação (backup, restauração e reset)

```bash
./dev.sh status                 # containers, processos, portas, saúde e backups
./dev.sh stop                   # para API e Vite (infraestrutura continua)
./dev.sh backup                 # banco + imagens -> .dev/backups/*.tar.gz
./dev.sh restore                # restaura o backup mais recente
./dev.sh restore .dev/backups/delicias-20261030-120000.tar.gz
./dev.sh reset                  # backup + confirmação + apaga volumes
./dev.sh reset --yes            # sem confirmação (ainda faz backup)
./dev.sh reset --yes --no-backup
```

O backup contém `database.dump` (pg_dump custom), `revision.txt` (revisão do
Alembic) e o volume do SeaweedFS (fotos). O `restore` para a API/Vite, restaura
o banco com `pg_restore`, troca o volume do SeaweedFS e aplica migrações
pendentes; depois é só rodar `./dev.sh` novamente.

O `status` mostra o resultado de `/api/health` e `/api/ready` (deve ser `200`
com `"database": true` e `"schema": true`).

### Manualmente

```bash
podman-compose -f compose.yaml up -d postgres seaweedfs
podman-compose -f compose.yaml stop api web

cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8081
```

Em outro terminal:

```bash
cd frontend
npm install
npm run dev
```

O Vite faz proxy de `/api` e `/assets/uploads` para a API em `:8081`;
em `frontend/public/assets` ficam apenas os assets da marca (`logo.png` e
`food-truck.png`).

### Stack completa (sem Vite)

```bash
podman compose up -d --build --force-recreate
```

Site em `:8080`, painel em `:8080/admin` e API direta em `:8081`.

## O que cada container faz

- **web** — build do Vite e nginx servindo o SPA. Faz proxy de `/api` e de
  `/assets/uploads` para a API, deixando tudo na mesma origem (sem CORS, cookie
  `SameSite=Strict` funciona).
- **api** — imagem da API em `backend/Containerfile` (Python 3.14 slim, roda
  sem root, healthcheck em `/api/ready`). Expõe 8080 e aplica as migrações do
  Alembic no startup.
- **postgres** — PostgreSQL 16 com volume `pgdata`. Healthcheck com
  `pg_isready`.
- **seaweedfs** — `weed server -s3` (master + volume + filer + gateway S3 em
  um container só), com as credenciais em `infra/seaweedfs/s3.json`.

### Detalhes que só aparecem na prática

- **DNS do nginx:** o `nginx.conf` resolve o endereço da API a cada requisição
  (o IP da API muda quando o container dela é recriado). O endereço do DNS
  embutido depende do runtime — `127.0.0.11` no Docker, o IP do aardvark-dns
  no Podman — então o `docker-entrypoint.sh` lê o `nameserver` do
  `/etc/resolv.conf` e monta o `nginx.conf` antes de subir o nginx.
- **Mount do `s3.json`:** precisa de `:z` no Podman rootless. Sem isso o
  container não consegue ler o arquivo e o SeaweedFS entra em loop de restart
  (`FATAL: fail to load config file ... permission denied`). No Docker a
  opção é ignorada.
- **Healthcheck da API:** declarado no `compose.yaml` (e também no
  `Containerfile`), porque o healthcheck da imagem não é herdado por todas as
  ferramentas de compose. Ele usa `/api/ready`, que só responde `200` quando o
  banco está acessível **e** o schema existe.
- **Schema/volume recriado:** se o volume do Postgres for apagado com a API no
  ar, as requisições passam a responder `503` com `Retry-After`; o handler de
  `undefined_table` e o `/api/health` chamam `ensure_schema()` (migrações +
  seed) e a API volta sozinha, sem reiniciar.
- **`/assets/`:** o nginx serve primeiro `logo.png`/`food-truck.png` do build
  do SPA; o que não existir ali (`uploads/...`) é encaminhado para a API, que
  lê a foto do SeaweedFS.

## Bucket do storage

A API cria o bucket (`S3_BUCKET`, padrão `produtos`) automaticamente no
startup, se ele ainda não existir. As fotos ficam no SeaweedFS e são servidas
pelo próprio nginx/API em `/assets/...`.

## Configuração

Variáveis ficam no `.env` (copie de `.env.example`). O compose monta
`DATABASE_URL` e `S3_ENDPOINT` a partir dos nomes dos serviços; as principais
variáveis configuráveis são:

```
POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET
SEED_DEMO_DATA=false
ADMIN_USERNAME=admin
ADMIN_PASSWORD=1234
SECRET_KEY=<segredo usado para assinar o cookie de sessão>
COOKIE_SECURE=false
```

Atenção: as chaves do `.env` precisam ser **iguais** às de
`infra/seaweedfs/s3.json` (esse arquivo é lido pelo SeaweedFS, não pelo
compose). Em produção, troque `ADMIN_PASSWORD` e `SECRET_KEY`, e use
`COOKIE_SECURE=true` atrás de HTTPS.

## API

A API em `backend/` usa FastAPI + PostgreSQL (SQLAlchemy async/psycopg) e o
SeaweedFS via API S3. No startup, `app/bootstrap.py` aplica as migrações do
Alembic e roda o seed idempotente; os horários de funcionamento são criados se a
tabela estiver vazia. Produtos e adicionais de exemplo só entram com
`SEED_DEMO_DATA=true` (as fotos vão para o SeaweedFS) — no `./dev.sh` o padrão é
`false`. Sem a flag, o banco começa vazio para o cadastro real pelo painel.

### Banco e migrações (Alembic)

O schema é versionado em `backend/migrations/versions/` e **não** usa mais
`create_all` no fluxo normal. Um banco antigo criado por `create_all` (tabelas
sem `alembic_version`) é adotado como baseline no próximo startup
(`alembic stamp head`). Se alguma tabela esperada sumir, o bootstrap recria
apenas as ausentes como reparo de emergência.

```bash
cd backend
. .venv/bin/activate
export DATABASE_URL=postgresql://delicias:delicias_dev_pwd@127.0.0.1:5432/delicias

alembic current
alembic upgrade head
alembic revision --autogenerate -m "descrição da mudança"
alembic check            # detecta divergência entre models e banco
```

A revisão inicial (`1a5b0a2b25d9`) cria as 7 tabelas, constraints e índices;
a revisão `7c2f5d9a4b10` adiciona `categories` e troca `products.category` por
`category_id` (N:1). `upgrade`/`downgrade` foram testados em banco vazio e
`alembic check` não reporta divergências.

Rotas públicas:

| Método | Rota | Para quê |
|---|---|---|
| `GET` | `/api/products` | cardápio (só produtos disponíveis e com estoque) |
| `GET` | `/api/categories` | categorias na ordem do cardápio |
| `GET` | `/api/hours` | lista de horários por dia (popup do site) |
| `GET` | `/api/business-hours` | horários + `is_open_now` |
| `POST` | `/api/orders` | cria pedido (imediato ou agendado); valida itens, estoque e horário |
| `GET` | `/api/health` | status da API, banco e storage; `503` se banco/schema falham |
| `GET` | `/api/ready` | readiness; igual ao health, para healthcheck/load balancer |

Rotas administrativas (exigem o cookie de sessão; login em
`POST /api/admin/login`):

| Método | Rota | Para quê |
|---|---|---|
| `POST` | `/api/admin/login` / `logout` | entrar / sair |
| `GET` | `/api/admin/me` | usuário logado |
| `GET/PUT` | `/api/admin/days/{weekday}` (ou `/hours`, `/business-hours`) | horário de funcionamento (`0`=domingo … `6`=sábado) |
| `GET/POST` | `/api/admin/categories` | listar / criar categoria |
| `PUT/PATCH/DELETE` | `/api/admin/categories/{id}` | renomear/ordenar, excluir (só sem produtos) |
| `GET/POST` | `/api/admin/products` | listar / criar produto (`category_id`) |
| `PUT/PATCH/DELETE` | `/api/admin/products/{id}` | editar, disponibilidade/estoque, excluir |
| `GET/POST` | `/api/admin/addons` | listar / criar adicional |
| `PATCH/DELETE` | `/api/admin/addons/{id}` | editar preço / excluir |
| `GET` | `/api/admin/orders?status=open\|done\|canceled` | pedidos |
| `PATCH` | `/api/admin/orders/{id}` | mudar status (`novo`, `concluido`, `cancelado`) |
| `GET` | `/api/admin/sales` | dados para exportação de vendas |
| `POST` | `/api/admin/uploads` | enviar foto (JPG/PNG/WebP) para o SeaweedFS |

Pelo site, o painel fica em <http://localhost:8080/admin>. O login padrão é
`admin` / `1234`.

## Situação atual

- A stack de containers está pronta e a API em `backend/` já é a API real do
  projeto: FastAPI, PostgreSQL e imagens no SeaweedFS.
- O frontend não tem API própria: em desenvolvimento o Vite faz proxy para a
  API em `:8081`; em produção o nginx faz proxy para o container `api`.
- O painel administrativo usa a mesma API (`/api/admin/*`), incluindo o
  controle de horário de funcionamento e a validação de pedidos fora do horário.
- O carrinho aceita pedidos imediatos ou agendados. O agendamento pode ser feito
  com a loja fechada, desde que a data/hora escolhida seja futura e esteja
  dentro dos horários de funcionamento (inclusive turnos que viram a noite).
- O schema é versionado com Alembic e aplicado no startup; `/api/ready` e o
  `./dev.sh status` mostram banco, schema e storage.
- `./dev.sh backup/restore/reset` cobre cópia e recuperação de banco + fotos.

