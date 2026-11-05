# Delícias Gourmet (SPA)

Frontend React + Vite do site e do painel. A API é o FastAPI em `../backend/`
(PostgreSQL + SeaweedFS); este pacote não tem servidor próprio.

## Desenvolvimento

Na raiz do repositório, use `./dev.sh` — ele sobe PostgreSQL, SeaweedFS, a API
em `http://127.0.0.1:8081` e o Vite em `http://127.0.0.1:5173`. O Vite encaminha
`/api` e `/assets/uploads` para `VITE_API_TARGET` (padrão `http://127.0.0.1:8081`).

Para rodar só o frontend (com a API já no ar):

    npm install
    npm run dev
    npm run build

## Público

- `GET /api/products`: cardápio público (sem custos), com `category_id`,
  `category`, `category_name` e `featured`.
- `GET /api/categories`: categorias na ordem do cardápio.
- `GET /api/hours`: horários da semana (formato usado pelo popup **Horários**).
- `GET /api/business-hours`: horários + se está aberto agora.
- `POST /api/orders`: o servidor recalcula o total com os preços do banco. Aceita
  pedido imediato (só com a loja aberta) ou agendado (`delivery_at` futuro e
  dentro do horário de funcionamento), além de retirada/entrega e endereço.

O site mostra “Destaques” apenas quando há produtos marcados como destaque e a
mensagem “Nenhum produto disponível no momento.” quando o cardápio está vazio.
As fotos de produtos vêm do SeaweedFS via `/assets/uploads/`; em `public/assets`
ficam apenas a logo e a foto do food truck.

No carrinho, o cliente escolhe entre **o quanto antes** e **agendar** uma data e
horário, além de retirada ou entrega. O agendamento só é aceito para horários
futuros dentro do funcionamento da loja; pedidos imediatos continuam exigindo a
loja aberta. O popup **Horários** mostra a semana e destaca o dia atual.

## Painel administrativo (/admin)

Login com o usuário/senha definidos no `.env` da API (`ADMIN_USERNAME` /
`ADMIN_PASSWORD`; padrão de desenvolvimento `admin` / `1234`). A sessão fica em
cookie httpOnly e **todas** as rotas `/api/admin/*` (exceto login/logout) exigem
autenticação.

- **Empresa**: dias de atendimento e horário de início/término de cada dia
  (popup “Editar horário”); pedidos imediatos são recusados em dias fechados e
  fora do horário, no fuso America/Sao_Paulo. Pedidos agendados são aceitos com
  a loja fechada desde que o horário escolhido esteja dentro do funcionamento.
  Também mostra a disponibilidade de cada produto.
- **Categorias**: cadastro, renomeação, ordem e exclusão. Cada produto pertence a
  uma categoria (N:1); uma categoria com produtos não pode ser excluída.
- **Produtos**: grade com todos os produtos; “Editar” abre o painel com nome,
  categoria, preço, custo, adicionais, estoque, disponibilidade, destaque e
  números de venda. “Adicionar produto” cria um novo e a foto é enviada ao
  SeaweedFS (reduzida no navegador para até 1200 px).
  - **Adicionais**: o botão redondo “+” abre o pop-up para marcar os adicionais
    daquele produto. O pop-up separa **Sugestões** (adicionais já usados em
    outros produtos da mesma categoria) e **Adicionais existentes** (todos os
    adicionais já cadastrados, sem repetir os das sugestões). “Criar novo
    adicional” pede nome e valor; a lixeira exclui o adicional de todos os
    produtos (com confirmação).
  - **Estoque**: opcional por produto. Com controle ligado, cada pedido baixa o
    estoque, pedidos acima do saldo são recusados e, em 0, o produto some do
    cardápio público. Sem controle, nada muda.
- **Pedidos** (antiga aba Vendas): lista os pedidos confirmados no carrinho, do
  mais antigo para o mais novo, com foto, itens e total. Pedidos agendados
  mostram um selo e a data/hora escolhida; a ficha traz também forma de
  recebimento, endereço e observação. “Concluir pedido” move o pedido para
  “Concluídos” (dá para reabrir). Clicar no pedido abre a ficha de produção. A
  lista atualiza sozinha a cada 20 s.
  - **Cancelar pedido**: o painel pergunta se o pedido já foi produzido; se sim,
    o custo vira prejuízo no Administrativo e o estoque não volta; se não, as
    unidades voltam ao estoque (nos produtos com controle).
- **Administrativo**: planilha com todos os pedidos (por pedido ou por item;
  colunas ordenáveis, linha de totais, download em CSV) e indicadores/gráficos.
  Filtros por período, status, categoria, produto e busca valem para planilha e
  gráficos. O lucro usa o custo cadastrado em cada produto no momento do pedido.

- **Só pedidos concluídos entram no Administrativo** (e nos totais por produto da
  aba Produtos). Pedidos em andamento e cancelados sem produção ficam de fora.
- **Prejuízo** = custo dos pedidos cancelados que já tinham sido produzidos.
  Lucro líquido = faturamento − custos − prejuízo.
- **Animações dos botões** (`src/buttons.css`, usado no site e no painel): elevação
  ao passar o mouse, efeito de pressionar ao clicar e sublinhado animado nos
  menus. Respeita “reduzir movimento” do sistema.
