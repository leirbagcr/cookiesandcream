/* ===========================================================
   Cookie's Top — interface
   =========================================================== */

(function () {
  'use strict';

  var Store = window.Store;

  /* ---------- utilidades ---------- */

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, amount) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
  }

  function monthInputValue(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function stamp() {
    var now = new Date();
    return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  }

  function fmtDate(date) {
    return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function fmtTime(date) {
    return new Date(date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function totalStock() {
    return Store.state.flavors.reduce(function (acc, f) { return acc + f.stock; }, 0);
  }

  function missingPrices() {
    return Store.state.flavors.filter(function (f) { return f.price <= 0; });
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function emptyState(icon, title, text) {
    return '<div class="empty"><span class="empty-icon">' + icon + '</span>' +
      '<strong>' + esc(title) + '</strong><p>' + esc(text) + '</p></div>';
  }

  /* ---------- agregações ---------- */

  function aggregateByFlavor(sales) {
    var map = new Map();
    Store.state.flavors.forEach(function (f) {
      map.set(f.id, { id: f.id, name: f.name, emoji: f.emoji, qty: 0, revenue: 0, cost: 0, profit: 0 });
    });

    (sales || []).filter(function (s) { return !s.canceled; }).forEach(function (sale) {
      var subtotal = sale.items.reduce(function (acc, item) {
        return acc + item.unitPrice * item.qty;
      }, 0);

      sale.items.forEach(function (item) {
        var row = map.get(item.flavorId);
        if (!row) return;
        var gross = item.unitPrice * item.qty;
        var share = subtotal > 0 ? Math.round((sale.discount * gross) / subtotal) : 0;
        var revenue = gross - share;
        var cost = item.unitCost * item.qty;
        row.qty += item.qty;
        row.revenue += revenue;
        row.cost += cost;
        row.profit += revenue - cost;
      });
    });

    return Array.from(map.values());
  }

  function paymentBreakdown(sales) {
    var groups = {};
    Store.PAYMENTS.forEach(function (p) { groups[p] = { payment: p, total: 0, count: 0 }; });

    (sales || []).filter(function (s) { return !s.canceled; }).forEach(function (sale) {
      var key = groups[sale.payment] ? sale.payment : 'Outro';
      if (!groups[key]) groups[key] = { payment: key, total: 0, count: 0 };
      groups[key].total += sale.total;
      groups[key].count += 1;
    });

    return Object.keys(groups).map(function (key) { return groups[key]; })
      .filter(function (g) { return g.count > 0; })
      .sort(function (a, b) { return b.total - a.total; });
  }

  /* ---------- estado da interface ---------- */

  var today = new Date();

  var ui = {
    view: 'dashboard',
    cart: [],
    discount: 0,
    payment: 'Pix',
    historyPeriod: '30',
    historyFlavor: 'all',
    reportMonth: monthInputValue(today)
  };

  var VIEWS = {
    dashboard: { title: 'Início', subtitle: 'Visão geral da loja', icon: 'i-home' },
    pdv: { title: 'Vendas', subtitle: 'Registre um pedido e acompanhe o lucro', icon: 'i-pos' },
    estoque: { title: 'Estoque', subtitle: 'Controle as unidades de cada sabor', icon: 'i-box' },
    historico: { title: 'Histórico', subtitle: 'Todas as vendas registradas', icon: 'i-receipt' },
    relatorios: { title: 'Relatórios', subtitle: 'Faturamento, custos e lucro por período', icon: 'i-chart' },
    config: { title: 'Ajustes', subtitle: 'Sabores, preços, custos e backup', icon: 'i-gear' }
  };

  /* ---------- shell ---------- */

  function render() {
    var meta = VIEWS[ui.view] || VIEWS.dashboard;

    document.title = meta.title + " · Cookie's Top";
    $('#page-title').textContent = meta.title;
    $('#page-subtitle').textContent = meta.subtitle;

    $$('.nav-btn').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.view === ui.view);
    });

    $('#sidebar-stock').textContent = totalStock() + ' un.';
    $('#date-chip').textContent = new Date().toLocaleDateString('pt-BR', {
      weekday: 'short', day: '2-digit', month: 'short'
    }).replace(/\./g, '');

    var brandName = $('#brand-name');
    if (brandName) brandName.textContent = Store.state.storeName;
    var mobileBrandName = $('#mobile-brand-name');
    if (mobileBrandName) mobileBrandName.textContent = Store.state.storeName;

    $('#view').innerHTML = RENDERERS[ui.view]();
  }

  function setView(view) {
    if (!VIEWS[view]) return;
    ui.view = view;
    if (window.location.hash !== '#' + view) {
      window.history.replaceState(null, '', '#' + view);
    }
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- dashboard ---------- */

  function statCard(opts) {
    return '<article class="stat" data-tone="' + (opts.tone || 'bordo') + '">' +
      '<span class="stat-label">' + esc(opts.label) + '</span>' +
      '<p class="stat-value">' + opts.value + '</p>' +
      '<p class="stat-sub">' + opts.sub + '</p>' +
      (opts.icon ? '<span class="stat-icon"><svg class="icon"><use href="#' + opts.icon + '"/></svg></span>' : '') +
      '</article>';
  }

  function renderDashboard() {
    var state = Store.state;
    var now = new Date();
    var dayStart = startOfDay(now);
    var tomorrow = addDays(dayStart, 1);
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    var nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    var todaySummary = Store.summary(Store.salesBetween(dayStart, tomorrow));
    var monthSummary = Store.summary(Store.salesBetween(monthStart, nextMonth));
    var stock = totalStock();
    var low = state.flavors.filter(function (f) { return f.stock <= f.min; });
    var missing = missingPrices();

    var days = [];
    for (var i = 6; i >= 0; i--) {
      var day = addDays(dayStart, -i);
      var daySummary = Store.summary(Store.salesBetween(day, addDays(day, 1)));
      days.push({
        label: i === 0 ? 'hoje' : day.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
        revenue: daySummary.revenue,
        profit: daySummary.profit,
        count: daySummary.count
      });
    }

    var maxDay = Math.max.apply(null, [1].concat(days.map(function (d) {
      return Math.max(d.revenue, d.profit);
    })));

    function barHeight(value) {
      return Math.round((value / maxDay) * 100);
    }

    var last30 = Store.salesBetween(addDays(dayStart, -29), tomorrow);
    var ranking = aggregateByFlavor(last30).sort(function (a, b) { return b.qty - a.qty; });
    var maxQty = Math.max.apply(null, [1].concat(ranking.map(function (r) { return r.qty; })));
    var rankingHtml = ranking.some(function (r) { return r.qty > 0; })
      ? ranking.map(function (row) {
        return '<div class="rank-row">' +
          '<div class="rank-top">' +
          '<span class="rank-name"><span>' + row.emoji + '</span><span>' + esc(row.name) + '</span></span>' +
          '<span class="rank-qty">' + row.qty + ' un. · ' + Store.brl(row.profit) + '</span>' +
          '</div>' +
          '<div class="track"><div class="track-fill" style="width:' + Math.round((row.qty / maxQty) * 100) + '%"></div></div>' +
          '</div>';
      }).join('')
      : emptyState('🍪', 'Nenhuma venda ainda', 'Registre a primeira venda na aba Vendas para ver o ranking dos sabores.');

    var referenceStock = Math.max.apply(null, [16].concat(state.flavors.map(function (f) { return f.stock; })));
    var stockHtml = state.flavors.map(function (f) {
      var ratio = Math.min(100, Math.round((f.stock / referenceStock) * 100));
      var isLow = f.stock <= f.min;
      return '<div class="rank-row">' +
        '<div class="rank-top">' +
        '<span class="rank-name"><span>' + f.emoji + '</span><span>' + esc(f.name) + '</span></span>' +
        '<span class="rank-qty">' + f.stock + ' un.' + (isLow ? ' · baixo' : '') + '</span>' +
        '</div>' +
        '<div class="track"><div class="track-fill' + (isLow ? ' is-low' : '') + '" style="width:' + ratio + '%"></div></div>' +
        '</div>';
    }).join('');

    var lowHtml = low.length
      ? '<div class="detail-list" style="margin-top:12px">' + low.map(function (f) {
        return '<div class="detail-row"><span>' + f.emoji + ' ' + esc(f.name) + '</span>' +
          '<strong style="color:var(--red)">' + f.stock + ' un. restantes</strong></div>';
      }).join('') + '</div>'
      : '<p class="hint">Todos os sabores estão acima do estoque mínimo. 👌</p>';

    var banner = missing.length
      ? '<div class="banner">' +
        '<div><strong>Preços ainda não configurados</strong>' +
        '<p>Defina o preço de venda e o custo dos ' + missing.length + ' sabor' + (missing.length > 1 ? 'es' : '') +
        ' restante' + (missing.length > 1 ? 's' : '') + ' para o lucro ser calculado.</p></div>' +
        '<button class="btn btn-soft" data-action="open-setup">Configurar agora</button>' +
        '</div>'
      : '';

    return banner +
      '<div class="stat-grid">' +
      statCard({
        label: 'Estoque total',
        value: stock + ' un.',
        sub: state.flavors.length + ' sabores · 16 un. de cada no início',
        icon: 'i-box',
        tone: 'cookie'
      }) +
      statCard({
        label: 'Vendas hoje',
        value: String(todaySummary.count),
        sub: todaySummary.units + ' cookies vendidos',
        icon: 'i-pos',
        tone: 'bordo'
      }) +
      statCard({
        label: 'Faturamento hoje',
        value: Store.brl(todaySummary.revenue),
        sub: 'Ticket médio ' + Store.brl(todaySummary.ticket),
        icon: 'i-wallet',
        tone: 'caramel'
      }) +
      statCard({
        label: 'Lucro hoje',
        value: Store.brl(todaySummary.profit),
        sub: todaySummary.revenue ? 'Margem de ' + todaySummary.margin.toFixed(0) + '%' : 'Nenhuma venda hoje',
        icon: 'i-chart',
        tone: 'green'
      }) +
      '</div>' +

      '<div class="grid-main">' +
      '<section class="card">' +
      '<div class="card-head"><div><h2>Últimos 7 dias</h2><p>Faturamento e lucro por dia</p></div>' +
      '<div class="legend"><span><span class="dot dot-bordo"></span>Faturamento</span>' +
      '<span><span class="dot dot-caramel"></span>Lucro</span></div></div>' +
      '<div class="chart">' +
      days.map(function (d) {
        return '<div class="chart-col">' +
          '<div class="chart-bars" title="' + esc(d.label) + ': ' + Store.brl(d.revenue) + ' em vendas, ' + Store.brl(d.profit) + ' de lucro">' +
          '<div class="bar bar-bordo" style="height:' + barHeight(d.revenue) + '%"></div>' +
          '<div class="bar bar-caramel" style="height:' + barHeight(d.profit) + '%"></div>' +
          '</div>' +
          '<span class="chart-day">' + esc(d.label) + '</span>' +
          '<span class="chart-value">' + (d.revenue ? Store.brl(d.revenue) : '—') + '</span>' +
          '</div>';
      }).join('') +
      '</div>' +
      '</section>' +

      '<section class="card">' +
      '<div class="card-head"><div><h2>Mais vendidos</h2><p>Últimos 30 dias</p></div></div>' +
      '<div class="rank-list">' + rankingHtml + '</div>' +
      '</section>' +
      '</div>' +

      '<div class="grid-2">' +
      '<section class="card">' +
      '<div class="card-head"><div><h2>Estoque por sabor</h2><p>' + stock + ' unidades no total</p></div>' +
      '<button class="btn btn-ghost btn-sm" data-view="estoque">Gerenciar</button></div>' +
      '<div class="rank-list">' + stockHtml + '</div>' +
      '</section>' +

      '<section class="card">' +
      '<div class="card-head"><div><h2>Resumo do mês</h2><p>' +
      now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) + '</p></div></div>' +
      '<div class="detail-list">' +
      '<div class="detail-row"><span>Faturamento</span><strong>' + Store.brl(monthSummary.revenue) + '</strong></div>' +
      '<div class="detail-row"><span>Custo dos cookies</span><strong>' + Store.brl(monthSummary.cost) + '</strong></div>' +
      '<div class="detail-row"><span>Lucro</span><strong class="profit">' + Store.brl(monthSummary.profit) + '</strong></div>' +
      '<div class="detail-row"><span>Margem</span><strong>' + (monthSummary.revenue ? monthSummary.margin.toFixed(0) + '%' : '—') + '</strong></div>' +
      '<div class="detail-row"><span>Vendas realizadas</span><strong>' + monthSummary.count + '</strong></div>' +
      '<div class="detail-row"><span>Cookies vendidos</span><strong>' + monthSummary.units + '</strong></div>' +
      '</div>' +
      (low.length ? '<p class="hint" style="margin-top:16px;font-weight:600;color:var(--red)">Estoque baixo</p>' : '') +
      lowHtml +
      '</section>' +
      '</div>';
  }

  /* ---------- carrinho ---------- */

  function cartLines() {
    return ui.cart.map(function (line) {
      return { flavor: Store.getFlavor(line.flavorId), qty: line.qty };
    }).filter(function (line) { return !!line.flavor; });
  }

  function cartSubtotal() {
    return cartLines().reduce(function (acc, line) {
      return acc + line.flavor.price * line.qty;
    }, 0);
  }

  function cartCost() {
    return cartLines().reduce(function (acc, line) {
      return acc + line.flavor.cost * line.qty;
    }, 0);
  }

  function cartUnits() {
    return ui.cart.reduce(function (acc, line) { return acc + line.qty; }, 0);
  }

  function updateCartTotals() {
    var subtotal = cartSubtotal();
    var discount = Math.min(ui.discount, subtotal);
    var total = subtotal - discount;
    var profit = total - cartCost();

    var subtotalEl = $('#cart-subtotal');
    var totalEl = $('#cart-total');
    var profitEl = $('#cart-profit');
    var finalizeEl = $('#finalize-btn');

    if (subtotalEl) subtotalEl.textContent = Store.brl(subtotal);
    if (totalEl) totalEl.textContent = Store.brl(total);
    if (profitEl) profitEl.textContent = Store.brl(profit);
    if (finalizeEl) finalizeEl.disabled = cartLines().length === 0;
  }

  function addToCart(flavorId) {
    var flavor = Store.getFlavor(flavorId);
    if (!flavor) return;

    var line = ui.cart.find(function (item) { return item.flavorId === flavorId; });
    var current = line ? line.qty : 0;

    if (current >= flavor.stock) {
      toast('Estoque máximo de ' + flavor.name + ' atingido.', 'warn');
      return;
    }

    if (line) line.qty += 1;
    else ui.cart.push({ flavorId: flavorId, qty: 1 });

    render();
  }

  function changeQty(flavorId, delta) {
    var line = ui.cart.find(function (item) { return item.flavorId === flavorId; });
    if (!line) return;

    var flavor = Store.getFlavor(flavorId);
    var next = line.qty + delta;

    if (flavor && next > flavor.stock) {
      toast('Só há ' + flavor.stock + ' un. de ' + flavor.name + ' em estoque.', 'warn');
      return;
    }

    if (next <= 0) {
      ui.cart = ui.cart.filter(function (item) { return item.flavorId !== flavorId; });
    } else {
      line.qty = next;
    }

    render();
  }

  function finalizeSale() {
    if (!cartLines().length) {
      toast('Adicione cookies ao pedido antes de finalizar.', 'warn');
      return;
    }

    var finalizeEl = $('#finalize-btn');
    if (finalizeEl) finalizeEl.disabled = true;

    Store.addSale({
      items: ui.cart,
      discount: ui.discount,
      payment: ui.payment
    }).then(function (sale) {
      ui.cart = [];
      ui.discount = 0;
      render();
      toast('Venda de ' + Store.brl(sale.total) + ' registrada · lucro de ' + Store.brl(sale.profit));
    }).catch(function (err) {
      toast(err.message, 'error');
      if (finalizeEl) finalizeEl.disabled = false;
    });
  }

  /* ---------- vendas (PDV) ---------- */

  function renderPdv() {
    var state = Store.state;
    var lines = cartLines();
    var missing = missingPrices();
    var subtotal = cartSubtotal();
    var discount = Math.min(ui.discount, subtotal);
    var profit = subtotal - discount - cartCost();

    var banner = missing.length
      ? '<div class="banner"><div><strong>Faltam preços</strong>' +
        '<p>Configure o preço de ' + missing.length + ' sabor' + (missing.length > 1 ? 'es' : '') +
        ' para poder vender.</p></div>' +
        '<button class="btn btn-soft" data-action="open-setup">Configurar</button></div>'
      : '';

    var flavorsHtml = state.flavors.map(function (f) {
      var outOfStock = f.stock <= 0;
      var noPrice = f.price <= 0;
      var blocked = outOfStock || noPrice;
      var statusText = outOfStock ? 'Esgotado' : (noPrice ? 'Defina o preço' : f.stock + ' em estoque');

      return '<button class="flavor-card' + (blocked ? ' is-out' : '') + '" data-action="add-flavor" data-flavor="' + f.id + '"' +
        (blocked ? ' disabled' : '') + '>' +
        '<span class="flavor-emoji">' + f.emoji + '</span>' +
        '<span class="flavor-name">' + esc(f.name) + '</span>' +
        '<span class="flavor-price">' + (f.price > 0 ? Store.brl(f.price) : 'sem preço') + '</span>' +
        '<span class="flavor-stock' + ((f.stock <= f.min || noPrice) ? ' is-low' : '') + '">' +
        statusText + '</span>' +
        '</button>';
    }).join('');

    var cartHtml = lines.length
      ? lines.map(function (line) {
        return '<div class="cart-line">' +
          '<div class="cart-line-info"><span class="cart-emoji">' + line.flavor.emoji + '</span>' +
          '<div><strong>' + esc(line.flavor.name) + '</strong><span>' + Store.brl(line.flavor.price) + ' cada</span></div></div>' +
          '<div class="cart-line-actions">' +
          '<div class="qty">' +
          '<button class="qty-btn" data-action="cart-dec" data-flavor="' + line.flavor.id + '" aria-label="Diminuir">−</button>' +
          '<span>' + line.qty + '</span>' +
          '<button class="qty-btn" data-action="cart-inc" data-flavor="' + line.flavor.id + '" aria-label="Aumentar">+</button>' +
          '</div>' +
          '<strong>' + Store.brl(line.flavor.price * line.qty) + '</strong>' +
          '<button class="icon-btn" data-action="cart-remove" data-flavor="' + line.flavor.id + '" aria-label="Remover">×</button>' +
          '</div></div>';
      }).join('')
      : '<div class="cart-empty"><span class="empty-icon">🛒</span><strong>Pedido vazio</strong>' +
        '<p>Toque nos sabores ao lado para montar o pedido.</p></div>';

    var payHtml = Store.PAYMENTS.map(function (payment) {
      return '<button class="pay-btn' + (ui.payment === payment ? ' is-active' : '') + '" data-action="pay" data-payment="' +
        payment + '">' + payment + '</button>';
    }).join('');

    return banner +
      '<div class="pos">' +
      '<div>' +
      '<div class="pos-head"><h2>Escolha os sabores</h2><span>Clique para adicionar ao pedido</span></div>' +
      '<div class="flavor-grid">' + flavorsHtml + '</div>' +
      '</div>' +

      '<aside class="card cart">' +
      '<div class="cart-head"><h2>Pedido</h2><span class="chip">' + cartUnits() +
      (cartUnits() === 1 ? ' item' : ' itens') + '</span></div>' +
      '<div class="cart-lines">' + cartHtml + '</div>' +
      '<div class="cart-summary">' +
      '<div class="summary-row"><span>Subtotal</span><strong id="cart-subtotal">' + Store.brl(subtotal) + '</strong></div>' +
      '<label class="summary-row discount-row"><span>Desconto (R$)</span>' +
      '<input id="discount-input" class="input" type="number" min="0" step="0.01" inputmode="decimal" value="' +
      (discount / 100).toFixed(2) + '" aria-label="Desconto em reais"></label>' +
      '<div class="summary-row total-row"><span>Total</span><strong id="cart-total">' + Store.brl(subtotal - discount) + '</strong></div>' +
      '<div class="summary-row profit-row"><span>Lucro previsto</span><strong id="cart-profit">' + Store.brl(profit) + '</strong></div>' +
      '</div>' +
      '<div class="pay-grid">' + payHtml + '</div>' +
      '<button class="btn btn-primary btn-block" id="finalize-btn" data-action="finalize"' +
      (lines.length ? '' : ' disabled') + '>Finalizar venda</button>' +
      '</aside>' +
      '</div>';
  }

  /* ---------- estoque ---------- */

  function renderEstoque() {
    var state = Store.state;
    var stock = totalStock();

    var rows = state.flavors.map(function (f) {
      var isOut = f.stock <= 0;
      var isLow = !isOut && f.stock <= f.min;
      var status = isOut
        ? '<span class="chip chip-red">Esgotado</span>'
        : isLow
          ? '<span class="chip chip-red">Estoque baixo</span>'
          : '<span class="chip chip-green">Ok</span>';

      var margin = f.price > 0
        ? Store.brl(f.price - f.cost) + ' <span class="cell-sub">' + Math.round(((f.price - f.cost) / f.price) * 100) + '%</span>'
        : '—';

      return '<tr>' +
        '<td><strong>' + f.emoji + ' ' + esc(f.name) + '</strong></td>' +
        '<td class="num">' + (f.price > 0 ? Store.brl(f.price) : '—') + '</td>' +
        '<td class="num">' + (f.cost > 0 ? Store.brl(f.cost) : '—') + '</td>' +
        '<td class="num">' + margin + '</td>' +
        '<td class="num"><strong>' + f.stock + ' un.</strong></td>' +
        '<td class="num">' + f.min + '</td>' +
        '<td>' + status + '</td>' +
        '<td class="num">' +
        '<button class="btn btn-ghost btn-sm" data-action="stock-entry" data-flavor="' + f.id + '">Entrada</button> ' +
        '<button class="btn btn-ghost btn-sm" data-action="stock-adjust" data-flavor="' + f.id + '">Ajustar</button>' +
        '</td></tr>';
    }).join('');

    var movements = state.movements.slice().sort(function (a, b) {
      return new Date(b.date) - new Date(a.date);
    }).slice(0, 8);

    var typeLabels = {
      entrada: 'Entrada',
      ajuste: 'Ajuste',
      venda: 'Venda',
      cancelamento: 'Cancelamento'
    };

    var movementsHtml = movements.length
      ? movements.map(function (movement) {
        var flavor = Store.getFlavor(movement.flavorId);
        var positive = movement.qty > 0;
        return '<div class="movement">' +
          '<div class="movement-left">' +
          '<span class="movement-type">' + (typeLabels[movement.type] || movement.type) + '</span>' +
          '<div><span class="movement-name">' +
          (flavor ? flavor.emoji + ' ' + esc(flavor.name) : 'Sabor removido') + '</span>' +
          '<span class="movement-note">' + esc(movement.note) + '</span></div>' +
          '</div>' +
          '<div class="movement-right">' +
          '<span class="movement-qty ' + (positive ? 'pos' : 'neg') + '">' +
          (positive ? '+' : '') + movement.qty + ' un.</span>' +
          '<time>' + fmtDate(movement.date) + ' · ' + fmtTime(movement.date) + '</time>' +
          '</div></div>';
      }).join('')
      : emptyState('📦', 'Sem movimentações', 'Entradas, ajustes e vendas aparecerão aqui.');

    return '<div class="stat-grid">' +
      statCard({
        label: 'Estoque total',
        value: stock + ' un.',
        sub: 'Soma dos ' + state.flavors.length + ' sabores',
        icon: 'i-box',
        tone: 'cookie'
      }) +
      statCard({
        label: 'Sabores ativos',
        value: state.flavors.filter(function (f) { return f.stock > 0; }).length + ' / ' + state.flavors.length,
        sub: 'Com unidades disponíveis',
        icon: 'i-cart',
        tone: 'bordo'
      }) +
      statCard({
        label: 'Estoque baixo',
        value: String(state.flavors.filter(function (f) { return f.stock <= f.min; }).length),
        sub: 'Sabores no limite mínimo',
        icon: 'i-alert',
        tone: 'caramel'
      }) +
      statCard({
        label: 'Unidades vendidas',
        value: String(Store.summary(state.sales).units),
        sub: 'Desde o início do controle',
        icon: 'i-chart',
        tone: 'green'
      }) +
      '</div>' +

      '<div class="card table-card" style="margin-bottom:20px">' +
      '<div class="card-head"><div><h2>Estoque por sabor</h2>' +
      '<p>Preço, custo, margem e disponibilidade</p></div></div>' +
      '<div class="table-scroll"><table class="table"><thead><tr>' +
      '<th>Sabor</th><th class="num">Preço</th><th class="num">Custo</th><th class="num">Lucro un.</th>' +
      '<th class="num">Estoque</th><th class="num">Mín.</th><th>Status</th><th class="num">Ações</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '</div>' +

      '<div class="card">' +
      '<div class="card-head"><div><h2>Movimentações recentes</h2>' +
      '<p>Entradas, ajustes, vendas e cancelamentos</p></div>' +
      '<button class="btn btn-ghost btn-sm" data-view="historico">Ver vendas</button></div>' +
      '<div class="movement-list">' + movementsHtml + '</div>' +
      '</div>';
  }

  function openEntryModal(flavorId) {
    var flavor = Store.getFlavor(flavorId);
    if (!flavor) return;

    openModal(
      '<h2 class="modal-title">Entrada de estoque</h2>' +
      '<p class="modal-text">' + flavor.emoji + ' ' + esc(flavor.name) +
      ' · estoque atual: <strong>' + flavor.stock + ' un.</strong></p>' +
      '<form id="entry-form" data-flavor="' + flavor.id + '">' +
      '<label class="field"><span>Quantidade recebida</span>' +
      '<input id="entry-qty" class="input" type="number" min="1" step="1" value="16" required autofocus></label>' +
      '<p style="height:12px"></p>' +
      '<label class="field"><span>Observação (opcional)</span>' +
      '<input id="entry-note" class="input" type="text" maxlength="80" placeholder="Ex.: compra de insumos"></label>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" data-action="close-modal">Cancelar</button>' +
      '<button type="submit" class="btn btn-primary">Adicionar ao estoque</button>' +
      '</div></form>',
      { label: 'Entrada de estoque' }
    );
  }

  function openAdjustModal(flavorId) {
    var flavor = Store.getFlavor(flavorId);
    if (!flavor) return;

    openModal(
      '<h2 class="modal-title">Ajustar estoque</h2>' +
      '<p class="modal-text">Use para corrigir perdas, quebras ou contagens. ' + flavor.emoji + ' ' +
      esc(flavor.name) + ' está com <strong>' + flavor.stock + ' un.</strong></p>' +
      '<form id="adjust-form" data-flavor="' + flavor.id + '">' +
      '<label class="field"><span>Nova quantidade em estoque</span>' +
      '<input id="adjust-qty" class="input" type="number" min="0" step="1" value="' + flavor.stock + '" required autofocus></label>' +
      '<p style="height:12px"></p>' +
      '<label class="field"><span>Motivo (opcional)</span>' +
      '<input id="adjust-note" class="input" type="text" maxlength="80" placeholder="Ex.: quebra, contagem, perda"></label>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" data-action="close-modal">Cancelar</button>' +
      '<button type="submit" class="btn btn-primary">Salvar ajuste</button>' +
      '</div></form>',
      { label: 'Ajustar estoque' }
    );
  }

  /* ---------- histórico ---------- */

  function rangeForPeriod(key) {
    var now = new Date();
    var dayStart = startOfDay(now);
    var tomorrow = addDays(dayStart, 1);

    if (key === 'today') return [dayStart, tomorrow, 'Hoje'];
    if (key === '7') return [addDays(dayStart, -6), tomorrow, 'Últimos 7 dias'];
    if (key === '30') return [addDays(dayStart, -29), tomorrow, 'Últimos 30 dias'];
    if (key === 'month') {
      return [
        new Date(now.getFullYear(), now.getMonth(), 1),
        new Date(now.getFullYear(), now.getMonth() + 1, 1),
        'Este mês'
      ];
    }
    return [new Date(2000, 0, 1), addDays(tomorrow, 3650), 'Todo o período'];
  }

  function filteredHistory() {
    var range = rangeForPeriod(ui.historyPeriod);
    var sales = Store.salesBetween(range[0], range[1]);

    if (ui.historyFlavor !== 'all') {
      sales = sales.filter(function (sale) {
        return sale.items.some(function (item) { return item.flavorId === ui.historyFlavor; });
      });
    }

    return sales.slice().sort(function (a, b) {
      return new Date(b.date) - new Date(a.date);
    });
  }

  function renderHistorico() {
    var sales = filteredHistory();
    var summary = Store.summary(sales);
    var canceled = sales.filter(function (s) { return s.canceled; }).length;
    var range = rangeForPeriod(ui.historyPeriod);

    var periodOptions = [
      ['today', 'Hoje'],
      ['7', 'Últimos 7 dias'],
      ['30', 'Últimos 30 dias'],
      ['month', 'Este mês'],
      ['all', 'Todo o período']
    ];

    var periodHtml = periodOptions.map(function (option) {
      return '<option value="' + option[0] + '"' + (ui.historyPeriod === option[0] ? ' selected' : '') + '>' +
        option[1] + '</option>';
    }).join('');

    var flavorOptions = '<option value="all">Todos os sabores</option>' +
      Store.state.flavors.map(function (f) {
        return '<option value="' + f.id + '"' + (ui.historyFlavor === f.id ? ' selected' : '') + '>' +
          f.emoji + ' ' + esc(f.name) + '</option>';
      }).join('');

    var rows = sales.map(function (sale) {
      var items = sale.items.map(function (item) {
        return item.qty + '× ' + esc(item.name);
      }).join(', ');

      return '<tr class="' + (sale.canceled ? 'is-canceled' : '') + '">' +
        '<td><strong>' + fmtDate(sale.date) + '</strong><span class="cell-sub">' + fmtTime(sale.date) + '</span></td>' +
        '<td>' + items + '</td>' +
        '<td><span class="chip">' + esc(sale.payment) + '</span></td>' +
        '<td class="num">' + Store.brl(sale.total) + '</td>' +
        '<td class="num profit">' + Store.brl(sale.profit) + '</td>' +
        '<td>' + (sale.canceled
          ? '<span class="chip chip-red">Cancelada</span>'
          : '<button class="btn btn-ghost btn-sm" data-action="sale-cancel" data-id="' +
            esc(sale.id) + '">Cancelar</button>') +
        '</td></tr>';
    }).join('');

    var table = sales.length
      ? '<div class="table-scroll"><table class="table"><thead><tr>' +
        '<th>Data</th><th>Itens</th><th>Pagamento</th><th class="num">Total</th>' +
        '<th class="num">Lucro</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : emptyState('🧾', 'Nenhuma venda no período', 'Ajuste os filtros ou registre uma venda na aba Vendas.');

    return '<div class="summary-strip">' +
      '<div class="summary-pill"><span>Vendas</span><strong>' + summary.count + '</strong></div>' +
      '<div class="summary-pill"><span>Faturamento</span><strong>' + Store.brl(summary.revenue) + '</strong></div>' +
      '<div class="summary-pill green"><span>Lucro</span><strong>' + Store.brl(summary.profit) + '</strong></div>' +
      '<div class="summary-pill"><span>Cookies</span><strong>' + summary.units + ' un.</strong></div>' +
      '</div>' +

      '<div class="card table-card">' +
      '<div class="card-head">' +
      '<div><h2>Vendas registradas</h2><p>' + (range[2] || '') + ' · ' + sales.length + ' registro' +
      (sales.length === 1 ? '' : 's') + (canceled ? ' · ' + canceled + ' cancelada' + (canceled > 1 ? 's' : '') : '') +
      '</p></div>' +
      '<div class="filters">' +
      '<select id="history-period" class="input" aria-label="Período">' + periodHtml + '</select>' +
      '<select id="history-flavor" class="input" aria-label="Sabor">' + flavorOptions + '</select>' +
      '<button class="btn btn-ghost" data-action="export-csv">' +
      '<svg class="icon"><use href="#i-download"/></svg>CSV</button>' +
      '</div></div>' +
      table +
      '</div>';
  }

  /* ---------- relatórios ---------- */

  function deltaText(current, previous) {
    if (!previous) return 'Sem base no mês anterior';
    var diff = ((current - previous) / previous) * 100;
    if (Math.abs(diff) < 0.5) return 'Igual ao mês anterior';
    return (diff > 0 ? '▲ ' : '▼ ') + Math.abs(diff).toFixed(0) + '% vs mês anterior';
  }

  function renderRelatorios() {
    var parts = ui.reportMonth.split('-');
    var year = parseInt(parts[0], 10) || new Date().getFullYear();
    var month = parseInt(parts[1], 10) || (new Date().getMonth() + 1);

    var from = new Date(year, month - 1, 1);
    var to = new Date(year, month, 1);
    var prevFrom = new Date(year, month - 2, 1);
    var prevTo = from;

    var sales = Store.salesBetween(from, to);
    var summary = Store.summary(sales);
    var prev = Store.summary(Store.salesBetween(prevFrom, prevTo));

    var monthName = from.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    var flavorRows = aggregateByFlavor(sales)
      .filter(function (row) { return row.qty > 0; })
      .sort(function (a, b) { return b.revenue - a.revenue; });

    var maxRevenue = Math.max.apply(null, [1].concat(flavorRows.map(function (r) { return r.revenue; })));
    var totalProfit = flavorRows.reduce(function (acc, r) { return acc + r.profit; }, 0);

    var flavorsHtml = flavorRows.length
      ? flavorRows.map(function (row) {
        var share = totalProfit > 0 ? Math.round((row.profit / totalProfit) * 100) : 0;
        return '<div class="rank-row">' +
          '<div class="rank-top">' +
          '<span class="rank-name"><span>' + row.emoji + '</span><span>' + esc(row.name) + '</span></span>' +
          '<span class="rank-qty">' + row.qty + ' un. · ' + Store.brl(row.revenue) + '</span>' +
          '</div>' +
          '<div class="track"><div class="track-fill" style="width:' +
          Math.round((row.revenue / maxRevenue) * 100) + '%"></div></div>' +
          '<div class="rank-top" style="margin-top:4px">' +
          '<span class="rank-qty">Lucro ' + Store.brl(row.profit) + '</span>' +
          '<span class="rank-qty">' + share + '% do lucro</span>' +
          '</div></div>';
      }).join('')
      : emptyState('📊', 'Sem vendas em ' + monthName, 'Escolha outro mês ou registre vendas para ver o relatório.');

    var payments = paymentBreakdown(sales);
    var maxPayment = Math.max.apply(null, [1].concat(payments.map(function (p) { return p.total; })));

    var paymentsHtml = payments.length
      ? payments.map(function (p) {
        return '<div class="rank-row">' +
          '<div class="rank-top"><span class="rank-name">' + esc(p.payment) + '</span>' +
          '<span class="rank-qty">' + Store.brl(p.total) + ' · ' + p.count + 'x</span></div>' +
          '<div class="track"><div class="track-fill" style="width:' +
          Math.round((p.total / maxPayment) * 100) + '%"></div></div></div>';
      }).join('')
      : '<p class="hint">Nenhum pagamento registrado neste mês.</p>';

    var byDay = {};
    sales.filter(function (s) { return !s.canceled; }).forEach(function (sale) {
      var key = new Date(sale.date).toDateString();
      if (!byDay[key]) byDay[key] = { date: new Date(sale.date), revenue: 0, profit: 0, count: 0 };
      byDay[key].revenue += sale.total;
      byDay[key].profit += sale.profit;
      byDay[key].count += 1;
    });

    var best = Object.keys(byDay).map(function (key) { return byDay[key]; })
      .sort(function (a, b) { return b.revenue - a.revenue; })[0];

    return '<div class="card" style="margin-bottom:20px">' +
      '<div class="card-head"><div><h2>Resumo de ' + monthName + '</h2>' +
      '<p>Faturamento, custos e lucro do período</p></div>' +
      '<div class="filters"><input type="month" id="report-month" class="input" value="' +
      ui.reportMonth + '" aria-label="Mês do relatório"></div></div>' +
      '<div class="stat-grid" style="margin-bottom:0">' +
      statCard({
        label: 'Faturamento',
        value: Store.brl(summary.revenue),
        sub: deltaText(summary.revenue, prev.revenue),
        icon: 'i-wallet',
        tone: 'caramel'
      }) +
      statCard({
        label: 'Lucro',
        value: Store.brl(summary.profit),
        sub: deltaText(summary.profit, prev.profit),
        icon: 'i-chart',
        tone: 'green'
      }) +
      statCard({
        label: 'Vendas',
        value: String(summary.count),
        sub: summary.units + ' cookies vendidos',
        icon: 'i-pos',
        tone: 'bordo'
      }) +
      statCard({
        label: 'Ticket médio',
        value: Store.brl(summary.ticket),
        sub: summary.revenue ? 'Margem de ' + summary.margin.toFixed(0) + '%' : 'Sem vendas no mês',
        icon: 'i-receipt',
        tone: 'cookie'
      }) +
      '</div></div>' +

      '<div class="grid-2">' +
      '<section class="card">' +
      '<div class="card-head"><div><h2>Por sabor</h2><p>Faturamento e participação no lucro</p></div></div>' +
      '<div class="rank-list">' + flavorsHtml + '</div>' +
      (summary.cost ? '<p class="hint">Custo total dos cookies: <strong>' + Store.brl(summary.cost) +
        '</strong> · descontos já aplicados.</p>' : '') +
      '</section>' +

      '<section class="card">' +
      '<div class="card-head"><div><h2>Formas de pagamento</h2><p>Como o dinheiro entrou</p></div></div>' +
      '<div class="rank-list">' + paymentsHtml + '</div>' +
      '<p class="hint" style="margin-top:16px">Melhor dia: <strong>' +
      (best ? best.date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }) +
        ' · ' + Store.brl(best.revenue) + ' em ' + best.count + ' venda' + (best.count > 1 ? 's' : '') : '—') +
      '</strong></p>' +
      '</section>' +
      '</div>';
  }

  /* ---------- configurações ---------- */

  function renderConfig() {
    var state = Store.state;
    var missing = missingPrices();

    var banner = missing.length
      ? '<div class="banner"><div><strong>Preços pendentes</strong>' +
        '<p>Faltam ' + missing.length + ' sabor' + (missing.length > 1 ? 'es' : '') +
        ' com preço de venda definido.</p></div>' +
        '<button class="btn btn-soft" data-action="open-setup">Preencher agora</button></div>'
      : '';

    var rows = state.flavors.map(function (f) {
      return '<tr data-flavor="' + f.id + '">' +
        '<td><input class="input" data-field="name" maxlength="28" value="' + esc(f.name) +
        '" aria-label="Nome do sabor"></td>' +
        '<td><input class="input input-emoji" data-field="emoji" maxlength="4" value="' + esc(f.emoji) +
        '" aria-label="Emoji do sabor"></td>' +
        '<td><input class="input" data-field="price" type="number" min="0" step="0.01" inputmode="decimal" value="' +
        (f.price / 100).toFixed(2) + '" aria-label="Preço de venda"></td>' +
        '<td><input class="input" data-field="cost" type="number" min="0" step="0.01" inputmode="decimal" value="' +
        (f.cost / 100).toFixed(2) + '" aria-label="Custo"></td>' +
        '<td><input class="input" data-field="min" type="number" min="0" step="1" value="' +
        f.min + '" aria-label="Estoque mínimo"></td>' +
        '<td class="num">' + f.stock + ' un.</td>' +
        '</tr>';
    }).join('');

    return banner +
      '<form id="config-form">' +
      '<section class="card" style="margin-bottom:20px">' +
      '<div class="card-head"><div><h2>Dados da loja</h2><p>Nome exibido no painel</p></div></div>' +
      '<label class="field" style="max-width:340px"><span>Nome da loja</span>' +
      '<input id="store-name" class="input" maxlength="40" value="' + esc(state.storeName) + '"></label>' +
      '</section>' +

      '<section class="card" style="margin-bottom:20px">' +
      '<div class="card-head"><div><h2>Sabores, preços e custos</h2>' +
      '<p>O custo é quanto você gasta para produzir cada cookie</p></div></div>' +
      '<div class="table-scroll"><table class="table config-table"><thead><tr>' +
      '<th>Sabor</th><th>Emoji</th><th>Venda (R$)</th><th>Custo (R$)</th><th>Estoque mín.</th>' +
      '<th class="num">Estoque</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="hint">O estoque atual é alterado na aba <strong>Estoque</strong>. Aqui você define apenas o mínimo para o alerta.</p>' +
      '<div class="modal-actions" style="justify-content:flex-start;margin-top:18px">' +
      '<button class="btn btn-primary" type="submit">Salvar configurações</button></div>' +
      '</section>' +
      '</form>' +

      '<div class="grid-2">' +
      '<section class="card">' +
      '<div class="card-head"><div><h2>Backup dos dados</h2>' +
      '<p>As informações ficam salvas neste navegador</p></div></div>' +
      '<p class="hint" style="margin-top:0;margin-bottom:14px">Exporte um arquivo para guardar vendas e configurações. ' +
      'Se trocar de computador ou limpar o navegador, importe o backup para recuperar tudo.</p>' +
      '<div class="filters">' +
      '<button type="button" class="btn btn-soft" data-action="export-json">' +
      '<svg class="icon"><use href="#i-download"/></svg>Exportar backup</button>' +
      '<button type="button" class="btn btn-ghost" data-action="import-json">' +
      '<svg class="icon"><use href="#i-upload"/></svg>Importar backup</button>' +
      '</div>' +
      '<p class="hint">' + state.sales.length + ' venda' + (state.sales.length === 1 ? '' : 's') +
      ' e ' + state.movements.length + ' movimentaç' + (state.movements.length === 1 ? 'ão' : 'ões') +
      ' salvas neste navegador.</p>' +
      '<input type="file" id="import-file" accept=".json,application/json" hidden>' +
      '</section>' +

      '<section class="card" style="border-color:#EBC0C6">' +
      '<div class="card-head"><div><h2 style="color:var(--red)">Zona de risco</h2>' +
      '<p>Apagar todos os dados da loja</p></div></div>' +
      '<p class="hint" style="margin-top:0;margin-bottom:14px">Remove vendas, movimentações e preços. ' +
      'O estoque volta para 16 unidades de cada sabor.</p>' +
      '<button type="button" class="btn btn-danger" data-action="reset-data">Apagar todos os dados</button>' +
      '</section>' +
      '</div>';
  }

  /* ---------- modais ---------- */

  function openModal(html, options) {
    options = options || {};
    var root = $('#modal-root');
    root.innerHTML = '<div class="modal-overlay"><div class="modal' + (options.wide ? ' modal-wide' : '') +
      '" role="dialog" aria-modal="true" aria-label="' + esc(options.label || 'Janela') + '">' + html + '</div></div>';
    root.classList.add('is-open');
    document.body.classList.add('modal-open');

    var overlay = root.firstElementChild;
    overlay.addEventListener('mousedown', function (event) {
      if (event.target === overlay) closeModal();
    });

    var focusTarget = root.querySelector('input:not([type="hidden"]), select, textarea, button');
    if (focusTarget) {
      setTimeout(function () {
        try { focusTarget.focus(); } catch (err) { /* ignore */ }
      }, 40);
    }

    if (options.onMount) options.onMount(root);
  }

  function closeModal() {
    var root = $('#modal-root');
    if (!root) return;
    root.classList.remove('is-open');
    root.innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  function confirmAction(options) {
    openModal(
      '<h2 class="modal-title">' + esc(options.title) + '</h2>' +
      '<p class="modal-text">' + esc(options.message) + '</p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" data-action="close-modal">Voltar</button>' +
      '<button type="button" class="btn ' + (options.danger ? 'btn-danger-solid' : 'btn-primary') +
      '" id="confirm-yes">' + esc(options.confirmLabel || 'Confirmar') + '</button>' +
      '</div>',
      {
        label: options.title,
        onMount: function (root) {
          var button = root.querySelector('#confirm-yes');
          if (!button) return;
          button.addEventListener('click', function () {
            closeModal();
            options.onConfirm();
          });
        }
      }
    );
  }

  function openSetup() {
    var rows = Store.state.flavors.map(function (f) {
      return '<div class="setup-row">' +
        '<div class="setup-flavor"><span class="setup-emoji">' + f.emoji + '</span><span>' + esc(f.name) + '</span></div>' +
        '<label class="field"><span>Venda (R$)</span>' +
        '<input class="input" type="number" min="0" step="0.01" inputmode="decimal" data-price="' + f.id +
        '" value="' + (f.price / 100).toFixed(2) + '"></label>' +
        '<label class="field"><span>Custo (R$)</span>' +
        '<input class="input" type="number" min="0" step="0.01" inputmode="decimal" data-cost="' + f.id +
        '" value="' + (f.cost / 100).toFixed(2) + '"></label>' +
        '</div>';
    }).join('');

    openModal(
      '<div class="setup-intro">' +
      '<span class="setup-badge">🍪</span>' +
      '<div><h2 class="modal-title">Boas-vindas à Cookie\'s Top</h2>' +
      '<p class="modal-text">Seu estoque já começa com 16 unidades de cada sabor. ' +
      'Informe por quanto você vende e quanto custa cada cookie para o lucro ser calculado. ' +
      'Dá para mudar depois em <strong>Ajustes</strong>.</p></div>' +
      '</div>' +
      '<form id="setup-form">' +
      '<div class="setup-list">' + rows + '</div>' +
      '<p class="setup-foot">Pode deixar em branco e configurar depois — só não será possível vender enquanto o preço estiver zerado.</p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" data-action="skip-setup">Configurar depois</button>' +
      '<button type="submit" class="btn btn-primary">Salvar preços</button>' +
      '</div></form>',
      { label: 'Configurar preços', wide: true }
    );
  }

  function saveSetup(form) {
    var entries = Store.state.flavors.map(function (f) {
      var priceEl = form.querySelector('[data-price="' + f.id + '"]');
      var costEl = form.querySelector('[data-cost="' + f.id + '"]');
      return {
        id: f.id,
        price: Store.parseMoney(priceEl ? priceEl.value : 0),
        cost: Store.parseMoney(costEl ? costEl.value : 0)
      };
    });

    Store.updateFlavors(entries)
      .then(function () { return Store.setSetupSeen(); })
      .then(function () {
        closeModal();
        render();

        var missing = missingPrices().length;
        if (missing) {
          toast('Preços salvos. Ainda faltam ' + missing + ' sabor' + (missing > 1 ? 'es' : '') + '.', 'warn');
        } else {
          toast('Preços configurados! Boas vendas 🍪');
        }
      })
      .catch(function (err) {
        toast(err.message, 'error');
      });
  }

  function skipSetup() {
    Store.setSetupSeen().then(function () {
      closeModal();
      render();
      toast('Sem problema! Configure os preços em Ajustes quando quiser.', 'warn');
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  /* ---------- toasts ---------- */

  function toast(message, type) {
    type = type || 'success';
    var root = $('#toast-root');
    var node = document.createElement('div');
    node.className = 'toast toast-' + type;
    node.innerHTML = '<span class="toast-icon">' + (type === 'success' ? '✓' : '!') + '</span>' +
      '<span>' + esc(message) + '</span>';
    root.appendChild(node);

    requestAnimationFrame(function () { node.classList.add('is-in'); });

    setTimeout(function () {
      node.classList.remove('is-in');
      setTimeout(function () { node.remove(); }, 250);
    }, 3400);
  }

  /* ---------- ações ---------- */

  function exportHistoryCSV() {
    var sales = filteredHistory();
    if (!sales.length) {
      toast('Nenhuma venda no período para exportar.', 'warn');
      return;
    }
    download('cookies-top-vendas-' + stamp() + '.csv', Store.exportCSV(sales), 'text/csv;charset=utf-8');
    toast(sales.length + ' venda' + (sales.length > 1 ? 's' : '') + ' exportada' + (sales.length > 1 ? 's' : '') + ' em CSV.');
  }

  function importFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      Store.importJSON(String(reader.result)).then(function () {
        ui.cart = [];
        ui.discount = 0;
        render();
        toast('Backup restaurado com sucesso.');
      }).catch(function (err) {
        toast(err.message, 'error');
      });
    };
    reader.onerror = function () { toast('Não foi possível ler o arquivo.', 'error'); };
    reader.readAsText(file);
  }

  function confirmCancelSale(id) {
    var sale = Store.state.sales.find(function (item) { return item.id === id; });
    if (!sale) return;

    var items = sale.items.map(function (item) {
      return item.qty + '× ' + item.name;
    }).join(', ');

    confirmAction({
      title: 'Cancelar esta venda?',
      message: 'A venda de ' + Store.brl(sale.total) + ' (' + items +
        ') será marcada como cancelada e os cookies voltam ao estoque.',
      confirmLabel: 'Cancelar venda',
      danger: true,
      onConfirm: function () {
        Store.cancelSale(sale.id).then(function () {
          render();
          toast('Venda cancelada. Estoque devolvido.');
        }).catch(function (err) {
          toast(err.message, 'error');
        });
      }
    });
  }

  function confirmReset() {
    confirmAction({
      title: 'Apagar todos os dados?',
      message: 'Isso remove vendas, movimentações e preços configurados. O estoque volta para 16 unidades de cada sabor. Não dá para desfazer.',
      confirmLabel: 'Apagar tudo',
      danger: true,
      onConfirm: function () {
        Store.resetAll().then(function () {
          ui.cart = [];
          ui.discount = 0;
          setView('dashboard');
          openSetup();
          toast('Dados apagados. Vamos começar de novo.', 'warn');
        }).catch(function (err) {
          toast(err.message, 'error');
        });
      }
    });
  }

  function saveConfig(form) {
    var storeNameInput = form.querySelector('#store-name');
    var entries = Store.state.flavors.map(function (f) {
      var row = form.querySelector('[data-flavor="' + f.id + '"]');
      if (!row) return { id: f.id };
      return {
        id: f.id,
        name: row.querySelector('[data-field="name"]').value,
        emoji: row.querySelector('[data-field="emoji"]').value,
        price: Store.parseMoney(row.querySelector('[data-field="price"]').value),
        cost: Store.parseMoney(row.querySelector('[data-field="cost"]').value),
        min: Math.max(0, Math.floor(Number(row.querySelector('[data-field="min"]').value) || 0))
      };
    });

    Store.updateSettings({ storeName: storeNameInput ? storeNameInput.value : Store.state.storeName })
      .then(function () { return Store.updateFlavors(entries); })
      .then(function () {
        render();
        toast('Configurações salvas.');
      })
      .catch(function (err) {
        toast(err.message, 'error');
      });
  }

  function onDiscountInput(input) {
    var subtotal = cartSubtotal();
    var parsed = Store.parseMoney(input.value);
    ui.discount = Math.min(parsed, subtotal);
    if (parsed > subtotal) input.value = (subtotal / 100).toFixed(2);
    updateCartTotals();
  }

  function handleAction(action, data) {
    switch (action) {
      case 'add-flavor':
        addToCart(data.flavor);
        break;
      case 'cart-inc':
        changeQty(data.flavor, 1);
        break;
      case 'cart-dec':
        changeQty(data.flavor, -1);
        break;
      case 'cart-remove':
        ui.cart = ui.cart.filter(function (line) { return line.flavorId !== data.flavor; });
        render();
        break;
      case 'finalize':
        finalizeSale();
        break;
      case 'pay':
        ui.payment = data.payment;
        render();
        break;
      case 'stock-entry':
        openEntryModal(data.flavor);
        break;
      case 'stock-adjust':
        openAdjustModal(data.flavor);
        break;
      case 'sale-cancel':
        confirmCancelSale(data.id);
        break;
      case 'export-csv':
        exportHistoryCSV();
        break;
      case 'export-json':
        download('cookies-top-backup-' + stamp() + '.json', Store.exportJSON(), 'application/json');
        toast('Backup exportado. Guarde o arquivo em local seguro.');
        break;
      case 'import-json':
        var fileInput = $('#import-file');
        if (fileInput) fileInput.click();
        break;
      case 'reset-data':
        confirmReset();
        break;
      case 'open-setup':
        openSetup();
        break;
      case 'skip-setup':
        skipSetup();
        break;
      case 'close-modal':
        closeModal();
        break;
      default:
        break;
    }
  }

  /* ---------- eventos ---------- */

  function bindEvents() {
    document.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;

      if (target.classList && target.classList.contains('modal-overlay')) {
        closeModal();
        return;
      }

      var viewButton = target.closest('[data-view]');
      if (viewButton) {
        event.preventDefault();
        setView(viewButton.dataset.view);
        return;
      }

      var actionEl = target.closest('[data-action]');
      if (!actionEl) return;
      handleAction(actionEl.dataset.action, actionEl.dataset);
    });

    document.addEventListener('submit', function (event) {
      var form = event.target;

      if (form.id === 'setup-form') {
        event.preventDefault();
        saveSetup(form);
        return;
      }

      if (form.id === 'entry-form') {
        event.preventDefault();
        var entryQty = form.querySelector('#entry-qty');
        var entryNote = form.querySelector('#entry-note');
        Store.addStock(form.dataset.flavor, entryQty ? entryQty.value : 0, entryNote ? entryNote.value : '').then(function () {
          closeModal();
          render();
          toast('Entrada de estoque registrada.');
        }).catch(function (err) {
          toast(err.message, 'error');
        });
        return;
      }

      if (form.id === 'adjust-form') {
        event.preventDefault();
        var adjustQty = form.querySelector('#adjust-qty');
        var adjustNote = form.querySelector('#adjust-note');
        Store.setStock(form.dataset.flavor, adjustQty ? adjustQty.value : 0, adjustNote ? adjustNote.value : '').then(function () {
          closeModal();
          render();
          toast('Estoque ajustado.');
        }).catch(function (err) {
          toast(err.message, 'error');
        });
        return;
      }

      if (form.id === 'config-form') {
        event.preventDefault();
        saveConfig(form);
      }
    });

    document.addEventListener('change', function (event) {
      var target = event.target;

      if (target.id === 'history-period') {
        ui.historyPeriod = target.value;
        render();
      } else if (target.id === 'history-flavor') {
        ui.historyFlavor = target.value;
        render();
      } else if (target.id === 'report-month') {
        if (target.value) {
          ui.reportMonth = target.value;
          render();
        }
      } else if (target.id === 'import-file') {
        var file = target.files && target.files[0];
        target.value = '';
        importFile(file);
      }
    });

    document.addEventListener('input', function (event) {
      if (event.target.id === 'discount-input') onDiscountInput(event.target);
    });

    document.addEventListener('focusin', function (event) {
      var target = event.target;
      if (target && target.matches && target.matches('input[type="number"]')) {
        try { target.select(); } catch (err) { /* ignore */ }
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && $('#modal-root').children.length) closeModal();
    });

    window.addEventListener('hashchange', function () {
      var hash = (window.location.hash || '').replace('#', '');
      if (VIEWS[hash] && hash !== ui.view) {
        ui.view = hash;
        render();
      }
    });
  }

  /* ---------- inicialização ---------- */

  var RENDERERS = {
    dashboard: renderDashboard,
    pdv: renderPdv,
    estoque: renderEstoque,
    historico: renderHistorico,
    relatorios: renderRelatorios,
    config: renderConfig
  };

  function init() {
    bindEvents();

    var view = $('#view');
    if (view) {
      view.innerHTML = '<div class="empty"><span class="empty-icon">🍪</span>' +
        '<strong>Carregando painel</strong><p>Conectando ao banco de dados…</p></div>';
    }

    Store.load().then(function () {
      var hash = (window.location.hash || '').replace('#', '');
      if (VIEWS[hash]) ui.view = hash;

      render();
      if (!Store.state.setupSeen) openSetup();
    }).catch(function (err) {
      if (view) {
        view.innerHTML = '<div class="empty"><span class="empty-icon">🔌</span>' +
          '<strong>Banco de dados indisponível</strong><p>' + esc(err.message) + '</p></div>';
      }
      $('#page-title').textContent = 'Erro de conexão';
      $('#page-subtitle').textContent = 'Não foi possível carregar os dados';
      toast('Não foi possível carregar os dados.', 'error');
    });
  }

  init();

})();
