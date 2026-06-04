/* localStorage storage adapter — replaces the server-backed sync layer */
const Sync = (() => {
  const ITEMS_KEY    = 'map-items';
  const BOUNDARY_KEY = 'map-boundary';
  let onStatusChange = null;

  function getItems() {
    try {
      const s = localStorage.getItem(ITEMS_KEY);
      if (s) return JSON.parse(s);
    } catch(_) {}
    return window.SEED_ITEMS || { items: [] };
  }

  function setItems(data) {
    localStorage.setItem(ITEMS_KEY, JSON.stringify(data));
  }

  function getBoundary() {
    try {
      const s = localStorage.getItem(BOUNDARY_KEY);
      if (s) return JSON.parse(s);
    } catch(_) {}
    return window.SEED_BOUNDARY || {};
  }

  function setBoundary(data) {
    localStorage.setItem(BOUNDARY_KEY, JSON.stringify(data));
  }

  function ok(data) {
    return { ok: true, json: async () => data };
  }

  async function apiFetch(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const body   = opts._body;

    if (url === '/api/items') {
      if (method === 'GET') return ok(getItems());
      if (method === 'POST') {
        const store = getItems();
        const item  = { ...body, id: `itm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
        store.items.push(item);
        setItems(store);
        return ok(item);
      }
    }

    const itemMatch = url.match(/^\/api\/items\/(.+)$/);
    if (itemMatch) {
      const id    = itemMatch[1];
      const store = getItems();
      const idx   = store.items.findIndex(i => i.id === id);
      if (method === 'PUT') {
        if (idx === -1) return { ok: false };
        store.items[idx] = { ...store.items[idx], ...body, id };
        setItems(store);
        return ok(store.items[idx]);
      }
      if (method === 'DELETE') {
        if (idx !== -1) { store.items.splice(idx, 1); setItems(store); }
        return ok({ ok: true });
      }
    }

    if (url === '/api/boundary') {
      if (method === 'GET') return ok(getBoundary());
      if (method === 'PUT') { setBoundary(body); return ok(body); }
    }

    return { ok: false };
  }

  async function init(statusCallback) {
    onStatusChange = statusCallback;
    if (onStatusChange) onStatusChange(true, 0);
  }

  async function flushQueue() {}
  async function pendingCount() { return 0; }
  async function notifyStatus() {
    if (onStatusChange) onStatusChange(true, 0);
  }

  return { init, apiFetch, flushQueue, pendingCount, notifyStatus };
})();
