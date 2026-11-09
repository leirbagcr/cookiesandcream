# 🍪 Cookie's Top — Controle de vendas e lucro

Painel da loja de cookies **Cookie's Top** para registrar vendas, controlar o estoque e acompanhar o lucro. O front-end é feito em HTML, CSS e JavaScript puro; os dados agora ficam em um **banco de dados SQLite** acessado por um pequeno servidor em Python (sem instalar dependências).

## Como usar

1. No terminal, dentro desta pasta, inicie o servidor:

   ```bash
   python3 server.py
   ```

2. Abra no navegador: **http://localhost:8000**

3. No primeiro acesso, informe o **preço de venda** e o **custo** de cada um dos 5 sabores. Se preferir, clique em **Configurar depois** e preencha em **Ajustes**.

> A página não funciona mais abrindo o `index.html` direto (`file://`), porque o painel precisa conversar com o servidor e o banco.

### Opções do servidor

```bash
python3 server.py --port 8080          # muda a porta
python3 server.py --host 0.0.0.0       # libera acesso para outros computadores da rede
python3 server.py --db /caminho/meu.db # usa outro arquivo de banco
```

O banco é criado automaticamente em **`data/cookiestop.db`**.

> ⚠️ O servidor não tem login/senha. Use apenas na sua máquina ou em uma rede confiável. Se precisar expor na internet, coloque atrás de autenticação (ex.: proxy com senha).

## O que o site faz

| Aba | Função |
| --- | --- |
| **Início** | Estoque total, vendas/faturamento/lucro do dia e do mês, gráfico dos últimos 7 dias, ranking de sabores e alertas de estoque baixo. |
| **Vendas** | Monta o pedido com vários sabores, aplica desconto, escolhe a forma de pagamento e finaliza a venda. Baixa o estoque automaticamente. |
| **Estoque** | Mostra preço, custo, margem, status e unidades de cada sabor. Permite registrar **entrada** de mercadoria e **ajustar** a contagem (perdas/quebras). |
| **Histórico** | Todas as vendas com filtros por período e sabor, cancelamento (devolve ao estoque) e exportação em **CSV**. |
| **Relatórios** | Resumo mensal de faturamento, custo, lucro, ticket médio, margem, participação por sabor, formas de pagamento e melhor dia. |
| **Ajustes** | Nome da loja, sabores, preços, custos, estoque mínimo, backup em JSON e restauração dos dados. |

## Regras

- Estoque inicial: **16 unidades de cada sabor = 80 no total**.
- O lucro é calculado como `(preço de venda − custo) × quantidade − desconto` e fica **gravado no momento da venda**. Mudar preços depois não altera o histórico.
- Cada sabor tem estoque mínimo (padrão **4 un.**) para gerar alerta.
- Vendas sem estoque ou sem preço são bloqueadas.
- Os cálculos de venda, baixa de estoque e cancelamento são validados **no servidor**, dentro de uma transação do SQLite.

## Onde os dados ficam

Tudo é salvo no banco **SQLite** em `data/cookiestop.db`:

- os dados valem para o servidor/arquivo de banco, independentemente do navegador;
- para fazer backup, use **Ajustes → Exportar backup** (arquivo `.json`);
- para restaurar, use **Ajustes → Importar backup**;
- para zerar tudo, use **Ajustes → Apagar todos os dados**.

Os dados antigos que estavam no `localStorage` do navegador (`cookiestop:v1`) são **migrados automaticamente** na primeira vez que o painel abrir com um banco vazio. Se o banco já tiver dados, essa chave antiga é ignorada/removida.

## API

O servidor expõe uma API JSON usada pelo front-end:

| Método | Rota | Função |
| --- | --- | --- |
| `GET` | `/api/state` | Retorna o estado completo (sabores, vendas, movimentações). |
| `POST` | `/api/sales` | Registra uma venda e baixa o estoque. |
| `POST` | `/api/sales/:id/cancel` | Cancela a venda e devolve o estoque. |
| `POST` | `/api/flavors/:id/stock` | Registra entrada de estoque. |
| `PUT` | `/api/flavors/:id/stock` | Define a contagem do estoque (ajuste). |
| `PATCH` | `/api/flavors/:id` | Atualiza um sabor. |
| `PUT` | `/api/flavors` | Atualiza vários sabores. |
| `PATCH` | `/api/settings` | Atualiza o nome da loja. |
| `POST` | `/api/setup-seen` | Marca a configuração inicial como vista. |
| `POST` | `/api/import` | Restaura um backup JSON. |
| `POST` | `/api/reset` | Apaga os dados e recria o estoque inicial. |
| `GET` | `/api/health` | Verifica se o servidor está no ar. |

## Estrutura

```
server.py           servidor HTTP + API + banco SQLite
index.html          painel (abas e estrutura)
css/style.css       identidade visual bordo + marrom cookie
js/store.js         cliente da API, cálculos, resumo e exportações
js/app.js           telas, gráficos, modais e eventos
assets/logo.svg     logo do cookie
data/cookiestop.db  banco de dados (criado automaticamente)
```

## Paleta

| Cor | Uso |
| --- | --- |
| `#5C1A2B` | bordo principal |
| `#3E0F1C` | bordo escuro |
| `#8B5E3C` | marrom cookie |
| `#C08552` | caramelo |
| `#FFF6EC` | creme de fundo |
| `#2E1B12` | chocolate (texto) |

---

Feito para a Cookie's Top. Bom apetite e boas vendas! 🍪
