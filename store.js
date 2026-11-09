/* ===========================================================
   Cookie's Top — camada de dados (cliente da API)
   O banco SQLite é a fonte da verdade; o navegador mantém um
   cache em memória para renderizar as telas.
   Valores monetários são guardados em centavos (inteiros).
   =========================================================== */

(function (global) {
  'use strict';

  var PAYMENTS = ['Dinheiro', 'Pix', 'Débito', 'Crédito'];
  var LOCAL_KEY = 'cookiestop:v1';

  var state = null;

  /* ---------- utilidades ---------- */

  function toInt(value) {
    var n = Math.round(Number(value));
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeState(raw) {
    var base = {
      version: 1,
      storeName: "Cookie's Top",
      createdAt: new Date().toISOString(),
      setupSeen: false,
      configured: false,
      flavors: [],
      sales: [],
      movements: []
    };

    if (!raw || typeof raw !== 'object') return base;

    var flavors = Array.isArray(raw.flavors) ? raw.flavors.map(function (flavor) {
      return {
        id: String(flavor.id || ''),
        name: String(flavor.name || ''),
        emoji: String(flavor.emoji || '🍪'),
        price: Math.max(0, toInt(flavor.price)),
        cost: Math.max(0, toInt(flavor.cost)),
        stock: Math.max(0, toInt(flavor.stock)),
        min: Math.max(0, toInt(flavor.min))
      };
    }).filter(function (flavor) { return flavor.id; }) : [];

    var sales = Array.isArray(raw.sales) ? raw.sales.map(function (sale) {
      var items = Array.isArray(sale.items) ? sale.items.map(function (item) {
        return {
          flavorId: String(item.flavorId || ''),
          name: String(item.name || ''),
          qty: Math.max(0, toInt(item.qty)),
          unitPrice: Math.max(0, toInt(item.unitPrice)),
          unitCost: Math.max(0, toInt(item.unitCost))
        };
      }) : [];

      return {
        id: String(sale.id || ''),
        date: sale.date || new Date().toISOString(),
        items: items,
        discount: Math.max(0, toInt(sale.discount)),
        total: toInt(sale.total),
        cost: toInt(sale.cost),
        profit: toInt(sale.profit),
        payment: PAYMENTS.indexOf(sale.payment) >= 0 ? sale.payment : (sale.payment || 'Pix'),
        note: String(sale.note || ''),
        canceled: !!sale.canceled,
        canceledAt: sale.canceledAt || null
      };
    }) : [];

    var movements = Array.isArray(raw.movements) ? raw.movements.map(function (movement) {
      return {
        id: String(movement.id || ''),
        date: movement.date || new Date().toISOString(),
        flavorId: String(movement.flavorId || ''),
        type: String(movement.type || 'ajuste'),
        qty: toInt(movement.qty),
        note: String(movement.note || '')
      };
    }) : [];

    return {
      version: 1,
      storeName: (typeof raw.storeName === 'string' && raw.storeName.trim()) ? raw.storeName.trim() : base.storeName,
      createdAt: raw.createdAt || base.createdAt,
      setupSeen: !!raw.setupSeen,
      configured: !!raw.configured,
      flavors: flavors,
      sales: sales,
      movements: movements
    };
  }

  function applyState(raw) {
    state = normalizeState(raw);
    return state;
  }

  /* ---------- HTTP ---------- */

  function request(method, path, body) {
    var options = { method: method, headers: {} };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    return fetch(path, options).then(function (response) {
      return response.text().then(function (text) {
        var data = {};
        if (text) {
          try {
            data = JSON.parse(text);
          } catch (err) {
            throw new Error('O servidor retornou uma resposta inválida.');
          }
        }
        if (!response.ok) {
          throw new Error(data.error || ('Falha na comunicação com o servidor (' + response.status + ').'));
        }
        return data;
      });
    }, function () {
      throw new Error('Não foi possível conectar ao banco de dados. Inicie o servidor com "python3 server.py" e abra http://localhost:8000.');
    });
  }

  function mutation(method, path, body) {
    return request(method, path, body).then(function (data) {
      if (data && data.state) applyState(data.state);
      return data;
    });
  }

  /* ---------- persistência local antiga (migração) ---------- */

  function readLegacyState() {
    var raw = null;
    try {
      raw = global.localStorage.getItem(LOCAL_KEY);
    } catch (err) {
      return null;
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      removeLegacyState();
      return null;
    }
  }

  function removeLegacyState() {
    try {
      global.localStorage.removeItem(LOCAL_KEY);
    } catch (err) {
      /* ignore */
    }
  }

  function isPristine(serverState) {
    return !serverState.setupSeen &&
      serverState.sales.length === 0 &&
      serverState.movements.length === 0 &&
      serverState.flavors.every(function (flavor) { return flavor.price === 0; });
  }

  function maybeMigrateLegacy(serverState) {
    var legacy = readLegacyState();
    if (!legacy) return Promise.resolve(state);

    if (!Array.isArray(legacy.flavors) || !isPristine(serverState)) {
      removeLegacyState();
      return Promise.resolve(state);
    }

    return mutation('POST', '/api/import', legacy).then(function () {
      removeLegacyState();
      return state;
    }).catch(function () {
      return state;
    });
  }

  function load() {
    return request('GET', '/api/state').then(function (data) {
      var loaded = applyState(data.state);
      return maybeMigrateLegacy(loaded);
    });
  }

  /* ---------- formatos ---------- */

  function brl(cents) {
    var n = (Number(cents) || 0) / 100;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function parseMoney(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? Math.max(0, Math.round(value * 100)) : 0;
    }
    var text = String(value == null ? '' : value).trim().replace(/\s/g, '').replace(/R\$/gi, '');
    if (!text) return 0;
    text = text.replace(/[^0-9,.-]/g, '');
    if (text.indexOf(',') >= 0) {
      text = text.replace(/\./g, '').replace(',', '.');
    }
    var n = parseFloat(text);
    return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
  }

  /* ---------- consultas ---------- */

  function findFlavor(id) {
    for (var i = 0; i < state.flavors.length; i++) {
      if (state.flavors[i].id === id) return state.flavors[i];
    }
    return null;
  }

  function salesBetween(from, to) {
    var start = from instanceof Date ? from.getTime() : Number(from);
    var end = to instanceof Date ? to.getTime() : Number(to);
    return state.sales.filter(function (sale) {
      var time = new Date(sale.date).getTime();
      return time >= start && time < end;
    });
  }

  function summary(sales) {
    var active = (sales || []).filter(function (s) { return !s.canceled; });
    var revenue = 0, cost = 0, profit = 0, units = 0;

    active.forEach(function (sale) {
      revenue += sale.total;
      cost += sale.cost;
      profit += sale.profit;
      sale.items.forEach(function (item) { units += item.qty; });
    });

    var count = active.length;
    return {
      revenue: revenue,
      cost: cost,
      profit: profit,
      units: units,
      count: count,
      ticket: count ? Math.round(revenue / count) : 0,
      margin: revenue ? (profit / revenue) * 100 : 0
    };
  }

  /* ---------- mutações (API) ---------- */

  function addSale(payload) {
    return mutation('POST', '/api/sales', payload || {}).then(function (data) {
      return data.sale;
    });
  }

  function cancelSale(id) {
    return mutation('POST', '/api/sales/' + encodeURIComponent(id) + '/cancel').then(function (data) {
      return data.sale;
    });
  }

  function addStock(flavorId, qty, note) {
    return mutation('POST', '/api/flavors/' + encodeURIComponent(flavorId) + '/stock', {
      qty: Number(qty),
      note: note || ''
    });
  }

  function setStock(flavorId, qty, note) {
    return mutation('PUT', '/api/flavors/' + encodeURIComponent(flavorId) + '/stock', {
      qty: Number(qty),
      note: note || ''
    });
  }

  function updateFlavor(id, patch) {
    return mutation('PATCH', '/api/flavors/' + encodeURIComponent(id), patch || {});
  }

  function updateFlavors(entries) {
    return mutation('PUT', '/api/flavors', { flavors: entries || [] });
  }

  function updateSettings(patch) {
    return mutation('PATCH', '/api/settings', patch || {});
  }

  function setSetupSeen() {
    return mutation('POST', '/api/setup-seen', {});
  }

  function importJSON(text) {
    var parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return Promise.reject(new Error('Arquivo inválido: não é um JSON válido.'));
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.flavors)) {
      return Promise.reject(new Error('Este arquivo não parece ser um backup da Cookie\'s Top.'));
    }
    return mutation('POST', '/api/import', parsed);
  }

  function resetAll() {
    return mutation('POST', '/api/reset', {});
  }

  /* ---------- backup ---------- */

  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }

  function csvCell(value) {
    var text = String(value == null ? '' : value).replace(/"/g, '""');
    return '"' + text + '"';
  }

  function exportCSV(sales) {
    var rows = [['Data', 'Hora', 'Itens', 'Pagamento', 'Desconto', 'Total', 'Custo', 'Lucro', 'Status']];

    (sales || []).slice().sort(function (a, b) {
      return new Date(a.date) - new Date(b.date);
    }).forEach(function (sale) {
      var when = new Date(sale.date);
      var items = sale.items.map(function (item) {
        return item.qty + 'x ' + item.name;
      }).join(' + ');

      rows.push([
        when.toLocaleDateString('pt-BR'),
        when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        items,
        sale.payment,
        (sale.discount / 100).toFixed(2).replace('.', ','),
        (sale.total / 100).toFixed(2).replace('.', ','),
        (sale.cost / 100).toFixed(2).replace('.', ','),
        (sale.profit / 100).toFixed(2).replace('.', ','),
        sale.canceled ? 'Cancelada' : 'Concluída'
      ]);
    });

    return '\uFEFF' + rows.map(function (row) {
      return row.map(csvCell).join(';');
    }).join('\r\n');
  }

  /* ---------- API ---------- */

  var Store = {
    load: load,
    brl: brl,
    parseMoney: parseMoney,
    getFlavor: findFlavor,
    salesBetween: salesBetween,
    summary: summary,
    addSale: addSale,
    cancelSale: cancelSale,
    addStock: addStock,
    setStock: setStock,
    updateFlavor: updateFlavor,
    updateFlavors: updateFlavors,
    updateSettings: updateSettings,
    setSetupSeen: setSetupSeen,
    exportJSON: exportJSON,
    importJSON: importJSON,
    resetAll: resetAll,
    exportCSV: exportCSV,
    PAYMENTS: PAYMENTS
  };

  Object.defineProperty(Store, 'state', {
    get: function () { return state; }
  });

  Object.defineProperty(Store, 'ready', {
    get: function () { return state !== null; }
  });

  global.Store = Store;
})(window);
