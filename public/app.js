/* main app */
'use strict';

// ---- Tag config ----
let TAG_CONFIG = (() => {
  try {
    const s = localStorage.getItem('map-tags');
    if (s) return JSON.parse(s);
  } catch(_) {}
  return { ...window.SEED_TAGS };
})();
const DEFAULT_TAG_COLOR = '#64748b';

function tagColor(tag) {
  return TAG_CONFIG[tag]?.color || DEFAULT_TAG_COLOR;
}

function tagEmoji(tag) {
  return TAG_CONFIG[tag]?.emoji || '📌';
}

// ---- Display settings ----
const displaySettings = { labelMode: 'hover', fontSize: 12, pinSize: 1.0, boundaryMode: 'both' };
const SETTINGS_KEY = 'map-display-settings';

function loadDisplaySettings() {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (s) Object.assign(displaySettings, JSON.parse(s));
  } catch(_) {}
}

function saveDisplaySettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(displaySettings));
}

// ---- State ----
let allItems = [];
let markers = {};       // id → L.Marker
// Pre-populate all known tags as active so first-load markers are visible
let activeTags = new Set(Object.keys(TAG_CONFIG));
let boundaryLayer = null;
let reserveLayer = null;
let gpsMarker = null;
let gpsCircle = null;
let gpsWatchId = null;
let gpsActive = false;
let addPinMode = false;
let editingId = null;
let searchQuery = '';

// ---- Map init ----
const map = L.map('map', { zoomControl: true, tap: true });
map.setView([51.1789, -1.8262], 4); // placeholder; overridden by initMapView()

const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 21,
});
const satLayer = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { attribution: 'Tiles © Esri', maxZoom: 21, maxNativeZoom: 18 }
);
const googleSatLayer = L.tileLayer(
  'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
  { subdomains: ['0','1','2','3'], attribution: 'Imagery © Google', maxZoom: 21, maxNativeZoom: 21 }
);
googleSatLayer.addTo(map);

const layerControl = L.control.layers(
  { 'Satélite (Google)': googleSatLayer, 'Satélite (Esri)': satLayer, 'Mapa (OSM)': osmLayer },
  {},
  { position: 'topright' }
).addTo(map);

// ---- Marker icon factory ----
function makeIcon(tag, name = '') {
  const s = displaySettings.pinSize;
  const w = Math.round(20 * s);
  const h = Math.round(25 * s);
  const color = tagColor(tag);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 28 36">
    <path d="M14 0C6.3 0 0 6.3 0 14c0 9.9 14 22 14 22S28 23.9 28 14C28 6.3 21.7 0 14 0z"
      fill="${color}"/>
    <circle cx="14" cy="14" r="6" fill="white" fill-opacity="0.35"/>
  </svg>`;
  const labelHtml = (name && displaySettings.labelMode === 'all')
    ? `<div class="pin-label-embed">${escHtml(name)}</div>` : '';
  return L.divIcon({
    html: `<div class="pin-icon-wrap">${svg}${labelHtml}</div>`,
    iconSize: [w, h],
    iconAnchor: [Math.round(w / 2), h],
    popupAnchor: [0, -h],
    className: '',
  });
}

// ---- Pin label (tooltip) ----
function applyLabel(id) {
  const item = allItems.find(i => i.id === id);
  const m = markers[id];
  if (!item || !m) return;
  m.unbindTooltip();
  if (displaySettings.labelMode !== 'hover') return;
  const h = Math.round(36 * displaySettings.pinSize);
  m.bindTooltip(item.name, {
    permanent: false,
    direction: 'top',
    offset: [0, -h],
    className: 'pin-label',
    interactive: false,
  });
}

function applyDisplaySettings() {
  document.documentElement.style.setProperty('--pin-label-font-size', `${displaySettings.fontSize}px`);
  allItems.forEach(item => {
    const m = markers[item.id];
    if (!m) return;
    m.setIcon(makeIcon(item.tags[0] || 'incerto', item.name));
    applyLabel(item.id);
  });
}

// ---- Build popup HTML ----
function buildPopupHTML(item) {
  const tagsHTML = item.tags.map(t =>
    `<span class="tag-chip" style="--tag-color:${tagColor(t)}">${t}</span>`
  ).join('');
  const notesHTML = item.notes ? `<div class="popup-notes">${escHtml(item.notes)}</div>` : '';
  return `
    <div class="popup-name">${escHtml(item.name)}</div>
    <div class="popup-tags">${tagsHTML}</div>
    ${notesHTML}
    <button class="popup-btn" onclick="openEditModal('${item.id}')">Editar</button>
  `;
}

// ---- Add / refresh single marker ----
function upsertMarker(item) {
  const primaryTag = item.tags[0] || 'incerto';
  const icon = makeIcon(primaryTag, item.name);
  if (markers[item.id]) {
    markers[item.id].setLatLng([item.lat, item.lon]);
    markers[item.id].setIcon(icon);
    markers[item.id].setPopupContent(buildPopupHTML(item));
  } else {
    const m = L.marker([item.lat, item.lon], { icon })
      .bindPopup(buildPopupHTML(item), { maxWidth: 260 });
    m.addTo(map);
    markers[item.id] = m;
  }
  applyLabel(item.id);
  applyVisibility(item.id);
}

function removeMarker(id) {
  if (markers[id]) {
    markers[id].remove();
    delete markers[id];
  }
}

// ---- Visibility ----
function applyVisibility(id) {
  const item = allItems.find(i => i.id === id);
  if (!item || !markers[id]) return;
  const visible = item.tags.some(t => activeTags.has(t)) || item.tags.length === 0;
  const matchesSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery);
  if (visible && matchesSearch) {
    if (!map.hasLayer(markers[id])) markers[id].addTo(map);
  } else {
    if (map.hasLayer(markers[id])) markers[id].remove();
  }
}

function refreshAllVisibility() {
  allItems.forEach(i => applyVisibility(i.id));
}

// ---- Sidebar filters ----
function buildSidebar() {
  const tagCounts = {};
  allItems.forEach(item => {
    item.tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
    if (item.tags.length === 0) tagCounts['sem tag'] = (tagCounts['sem tag'] || 0) + 1;
  });

  // Merge known tags + any new ones from data
  const allTags = new Set([...Object.keys(TAG_CONFIG), ...Object.keys(tagCounts)]);

  const container = document.getElementById('tag-filters');
  const existing = container.querySelectorAll('.tag-filter-row');
  existing.forEach(e => e.remove());

  allTags.forEach(tag => {
    if (!tagCounts[tag]) return; // no items with this tag
    if (!activeTags.has(tag)) activeTags.add(tag); // default all on

    const color = tagColor(tag);
    const row = document.createElement('label');
    row.className = 'tag-filter-row';
    row.style.setProperty('--tag-color', color);
    row.innerHTML = `
      <input type="checkbox" data-tag="${tag}" ${activeTags.has(tag) ? 'checked' : ''}>
      <span class="tag-color-dot"></span>
      <span class="tag-filter-label">${tagEmoji(tag)} ${tag}</span>
      <span class="tag-filter-count">${tagCounts[tag]}</span>
    `;
    row.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) activeTags.add(tag); else activeTags.delete(tag);
      updateToggleAllBtn();
      refreshAllVisibility();
      buildItemList();
    });
    container.appendChild(row);
  });

  updateToggleAllBtn();
  refreshAllVisibility();
  buildItemList();
}

function updateToggleAllBtn() {
  const checkboxes = document.querySelectorAll('#tag-filters input[type=checkbox]');
  const anyChecked = [...checkboxes].some(c => c.checked);
  document.getElementById('btn-toggle-all').textContent = anyChecked ? 'Desmarcar todos' : 'Marcar todos';
}

document.getElementById('btn-toggle-all').addEventListener('click', () => {
  const checkboxes = document.querySelectorAll('#tag-filters input[type=checkbox]');
  const anyChecked = [...checkboxes].some(c => c.checked);
  checkboxes.forEach(c => {
    c.checked = !anyChecked;
    const tag = c.dataset.tag;
    if (!anyChecked) activeTags.add(tag); else activeTags.delete(tag);
  });
  updateToggleAllBtn();
  refreshAllVisibility();
  buildItemList();
});

// ---- Search ----
document.getElementById('search-input').addEventListener('input', e => applySearch(e.target.value));


// ---- Load data ----
async function loadItems() {
  const r = await Sync.apiFetch('/api/items');
  const data = await r.json();
  allItems = data.items || [];
  allItems.forEach(item => upsertMarker(item));
  buildSidebar();
  buildItemList();
}

// ---- Item list panel ----
function activeItems() {
  return allItems.filter(item => item.tags.some(t => activeTags.has(t)) || item.tags.length === 0);
}

function buildItemList() {
  const sorted = [...activeItems()].sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  const filtered = listSearchQuery
    ? sorted.filter(i => i.name.toLowerCase().includes(listSearchQuery))
    : sorted;
  renderItemList(filtered);
}

function renderItemList(items) {
  const container = document.getElementById('items-list');
  container.innerHTML = '';
  items.forEach(item => {
    const color = tagColor(item.tags[0] || 'incerto');
    const row = document.createElement('div');
    row.className = 'item-list-row';
    row.style.setProperty('--item-color', color);
    row.innerHTML = `
      <span class="item-list-dot"></span>
      <span class="item-list-name" title="${escHtml(item.name)}">${escHtml(item.name)}</span>
      <button class="item-list-nav" title="Navegar para este pin">→</button>
    `;
    row.querySelector('.item-list-name').addEventListener('click', () => navigateToItem(item));
    row.querySelector('.item-list-nav').addEventListener('click', () => navigateToItem(item));
    container.appendChild(row);
  });
  document.getElementById('list-count').textContent = items.length;
  document.getElementById('tags-count-badge').textContent = items.length;
}

function navigateToItem(item) {
  map.setView([item.lat, item.lon], Math.max(map.getZoom(), 20));
  const m = markers[item.id];
  if (m) setTimeout(() => m.openPopup(), 200);
  // Close sidebar on mobile
  if (window.innerWidth <= 600) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar').classList.add('closed');
  }
}

let listSearchQuery = '';

function applySearch(raw) {
  const query = raw.toLowerCase().trim();
  searchQuery = listSearchQuery = query;

  // Sync both inputs without re-triggering events (setting .value doesn't fire 'input')
  const si = document.getElementById('search-input');
  const ls = document.getElementById('list-search');
  if (si.value !== raw) si.value = raw;
  if (ls.value !== raw) ls.value = raw;

  // Sync clear buttons
  document.getElementById('search-input-clear').classList.toggle('hidden', !query);
  document.getElementById('list-search-clear').classList.toggle('hidden', !query);

  refreshAllVisibility();
  buildItemList();
  applyListMapFilter();
}

function applyListMapFilter() {
  if (!listSearchQuery) {
    refreshAllVisibility();
    return;
  }
  const matchIds = new Set(
    allItems.filter(i => i.name.toLowerCase().includes(listSearchQuery)).map(i => i.id)
  );
  allItems.forEach(item => {
    if (!markers[item.id]) return;
    if (matchIds.has(item.id)) {
      const visible = item.tags.some(t => activeTags.has(t)) || item.tags.length === 0;
      if (visible) { if (!map.hasLayer(markers[item.id])) markers[item.id].addTo(map); }
      else { if (map.hasLayer(markers[item.id])) markers[item.id].remove(); }
    } else {
      if (map.hasLayer(markers[item.id])) markers[item.id].remove();
    }
  });
}

document.getElementById('list-search').addEventListener('input', e => applySearch(e.target.value));

// ---- Sidebar tab switching ----
document.getElementById('sidebar-tabs').addEventListener('click', e => {
  const tab = e.target.closest('.sidebar-tab');
  if (!tab) return;
  document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.add('hidden'));
  tab.classList.add('active');
  document.getElementById(tab.dataset.panel).classList.remove('hidden');
});

let boundaryVertexLayers = [];

async function loadBoundary() {
  try {
    const r = await Sync.apiFetch('/api/boundary');
    const data = await r.json();

    if (boundaryLayer) boundaryLayer.remove();
    if (reserveLayer) reserveLayer.remove();
    boundaryVertexLayers.forEach(l => l.remove());
    boundaryVertexLayers = [];

    if (data.coordinates && data.coordinates.length >= 3) {
      const latlngs = data.coordinates.map(c => Array.isArray(c) ? c : [c.lat, c.lon]);
      boundaryLayer = L.polygon(latlngs, {
        color: '#dedc4a', weight: 2.5, fillColor: '#dedc4a', fillOpacity: 0.1,
        dashArray: '6 4',
      });

      if (data.points) {
        const vertexIcon = L.divIcon({
          html: `<div style="width:8px;height:8px;border-radius:50%;background:#4ade80;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`,
          iconSize: [8, 8], iconAnchor: [4, 4], className: '',
        });
        data.points.forEach(pt => {
          const m = L.marker([pt.lat, pt.lon], { icon: vertexIcon, interactive: false })
            .bindTooltip(pt.desc, { permanent: false, direction: 'top', offset: [0, -8], className: 'pin-label' });
          boundaryVertexLayers.push(m);
        });
      }
    }

    if (data.reserve && data.reserve.length >= 3) {
      const reserveM2 = polygonAreaM2(data.reserve);
      const areaHa = (reserveM2 / 10000).toFixed(2);
      const pct = data.coordinates && data.coordinates.length >= 3
        ? ((reserveM2 / polygonAreaM2(data.coordinates)) * 100).toFixed(1) + '%'
        : '';
      reserveLayer = L.polygon(data.reserve, {
        color: '#0bf52a65', weight: 1.5, fillColor: '#0bf52a65', fillOpacity: 0.5,
        dashArray: '4 3',
      });
      reserveLayer.bindTooltip(`Reserva Legal\n${areaHa} ha${pct ? ' · ' + pct : ''}`, {
        permanent: true, direction: 'center', className: 'reserve-label',
      });
    }

    applyBoundaryVisibility();
  } catch (_) {}
}

function applyBoundaryVisibility() {
  const mode = displaySettings.boundaryMode;

  // boundary polygon + vertices
  const showBoundary = mode === 'boundary' || mode === 'both';
  if (boundaryLayer) {
    showBoundary ? boundaryLayer.addTo(map) : boundaryLayer.remove();
  }
  boundaryVertexLayers.forEach(l => showBoundary ? l.addTo(map) : l.remove());

  // reserve polygon
  if (reserveLayer) {
    mode === 'both' ? reserveLayer.addTo(map) : reserveLayer.remove();
  }
}

// ---- GPS ----
document.getElementById('btn-gps').addEventListener('click', () => {
  if (gpsActive) {
    stopGPS();
  } else {
    startGPS();
  }
});

function startGPS() {
  if (!navigator.geolocation) {
    alert('Geolocalização não suportada neste navegador.');
    return;
  }
  gpsWatchId = navigator.geolocation.watchPosition(
    pos => {
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;
      if (!gpsMarker) {
        const gpsIcon = L.divIcon({
          html: `<div style="width:14px;height:14px;border-radius:50%;background:#0ea5e9;border:2px solid white;box-shadow:0 0 6px rgba(14,165,233,.8)"></div>`,
          iconSize: [14, 14], iconAnchor: [7, 7], className: '',
        });
        gpsMarker = L.marker([lat, lon], { icon: gpsIcon, zIndexOffset: 1000 }).addTo(map);
        gpsCircle = L.circle([lat, lon], { radius: accuracy, className: 'gps-accuracy' }).addTo(map);
        map.setView([lat, lon], Math.max(map.getZoom(), 18));
      } else {
        gpsMarker.setLatLng([lat, lon]);
        gpsCircle.setLatLng([lat, lon]).setRadius(accuracy);
      }
    },
    err => {
      console.warn('GPS error:', err.message);
      stopGPS();
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
  );
  gpsActive = true;
  document.getElementById('btn-gps').classList.add('active');
  document.getElementById('btn-gps').title = 'Parar localização';
}

function stopGPS() {
  if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
  gpsWatchId = null;
  gpsActive = false;
  if (gpsMarker) { gpsMarker.remove(); gpsMarker = null; }
  if (gpsCircle) { gpsCircle.remove(); gpsCircle = null; }
  document.getElementById('btn-gps').classList.remove('active');
  document.getElementById('btn-gps').title = 'Minha localização';
}

// ---- Sidebar toggle ----
document.getElementById('btn-menu').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar').classList.toggle('closed');
});

// ---- Add pin mode ----
document.getElementById('btn-add-pin').addEventListener('click', () => {
  addPinMode = true;
  document.getElementById('add-pin-hint').classList.remove('hidden');
  map.getContainer().style.cursor = 'crosshair';
});

document.getElementById('btn-cancel-add').addEventListener('click', cancelAddPin);

function cancelAddPin() {
  addPinMode = false;
  document.getElementById('add-pin-hint').classList.add('hidden');
  map.getContainer().style.cursor = '';
}

map.on('click', e => {
  if (!addPinMode) return;
  cancelAddPin();
  const newItem = {
    name: 'Novo pin',
    lat: parseFloat(e.latlng.lat.toFixed(7)),
    lon: parseFloat(e.latlng.lng.toFixed(7)),
    ele: 0,
    time: new Date().toISOString(),
    tags: [],
    notes: '',
    customFields: {},
  };
  openEditModal(null, newItem);
});

// ---- Edit modal ----
window.openEditModal = function(id, newItemData) {
  editingId = id;
  const item = id ? allItems.find(i => i.id === id) : newItemData;
  if (!item) return;

  document.getElementById('modal-title').textContent = id ? `Editar: ${item.name}` : 'Novo pin';
  document.getElementById('edit-name').value = item.name;
  document.getElementById('edit-notes').value = item.notes || '';
  document.getElementById('btn-delete').style.display = id ? '' : 'none';

  // Tags
  renderEditTags([...item.tags]);

  // Custom fields
  renderCustomFields({ ...item.customFields });

  // Coords
  document.getElementById('modal-lat-lon').textContent = `Lat: ${item.lat.toFixed(6)}, Lon: ${item.lon.toFixed(6)}`;
  document.getElementById('modal-ele').textContent = item.ele ? `Alt: ${item.ele.toFixed(0)} m` : '';

  // Store new item data for save
  if (!id) {
    document.getElementById('modal').dataset.newItem = JSON.stringify(newItemData);
  } else {
    delete document.getElementById('modal').dataset.newItem;
  }

  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('edit-name').focus();
  updateTagSuggestions();
};

// ---- Tag suggestions dropdown ----
let tagSugActiveIdx = -1;

function allKnownTags() {
  return new Set([
    ...Object.keys(TAG_CONFIG),
    ...allItems.flatMap(i => i.tags),
  ]);
}

function openTagSuggestions(query) {
  const current = new Set(getEditTags());
  const q = query.toLowerCase().trim();
  const candidates = [...allKnownTags()]
    .filter(t => !current.has(t) && (!q || t.includes(q)))
    .sort();

  const dl = document.getElementById('tag-suggestions-dropdown');
  dl.innerHTML = '';
  tagSugActiveIdx = -1;

  if (!candidates.length) { dl.classList.remove('open'); return; }

  candidates.forEach(tag => {
    const li = document.createElement('li');
    li.dataset.tag = tag;
    li.innerHTML = `
      <span class="sug-emoji">${tagEmoji(tag)}</span>
      <span class="sug-dot" style="background:${tagColor(tag)}"></span>
      <span>${escHtml(tag)}</span>
    `;
    li.addEventListener('mousedown', e => {
      e.preventDefault();
      addTag(tag);
    });
    dl.appendChild(li);
  });
  dl.classList.add('open');
}

function closeTagSuggestions() {
  document.getElementById('tag-suggestions-dropdown').classList.remove('open');
  tagSugActiveIdx = -1;
}

function addTag(tag) {
  tag = tag.trim().toLowerCase();
  if (!tag) return;
  const current = getEditTags();
  if (!current.includes(tag)) renderEditTags([...current, tag]);
  const input = document.getElementById('edit-tag-input');
  input.value = '';
  input.focus();
  openTagSuggestions('');
}

function renderEditTags(tags) {
  const container = document.getElementById('edit-tags-chips');
  container.innerHTML = '';
  tags.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.style.setProperty('--tag-color', tagColor(tag));
    chip.innerHTML = `${escHtml(tag)}<button class="remove-tag" title="Remover tag">×</button>`;
    chip.querySelector('.remove-tag').addEventListener('click', () => { chip.remove(); });
    container.appendChild(chip);
  });
}

function getEditTags() {
  return [...document.getElementById('edit-tags-chips').querySelectorAll('.tag-chip')]
    .map(c => c.childNodes[0].textContent.trim());
}

const tagInput = document.getElementById('edit-tag-input');

tagInput.addEventListener('input', e => openTagSuggestions(e.target.value));
tagInput.addEventListener('click', e => openTagSuggestions(e.target.value));
tagInput.addEventListener('blur', () => closeTagSuggestions());

tagInput.addEventListener('keydown', e => {
  const dl = document.getElementById('tag-suggestions-dropdown');
  const items = [...dl.querySelectorAll('li')];
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    tagSugActiveIdx = Math.min(tagSugActiveIdx + 1, items.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    tagSugActiveIdx = Math.max(tagSugActiveIdx - 1, -1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (tagSugActiveIdx >= 0 && items[tagSugActiveIdx]) {
      addTag(items[tagSugActiveIdx].dataset.tag);
    } else {
      addTagFromInput();
    }
    return;
  } else if (e.key === 'Escape') {
    closeTagSuggestions(); return;
  }
  items.forEach((li, i) => li.classList.toggle('active', i === tagSugActiveIdx));
  if (items[tagSugActiveIdx]) items[tagSugActiveIdx].scrollIntoView({ block: 'nearest' });
});

document.getElementById('btn-add-tag').addEventListener('click', addTagFromInput);

function addTagFromInput() {
  const input = document.getElementById('edit-tag-input');
  addTag(input.value);
}

function updateTagSuggestions() {} // kept for compat — no-op now

function renderCustomFields(fields) {
  const list = document.getElementById('custom-fields-list');
  list.innerHTML = '';
  Object.entries(fields).forEach(([k, v]) => addCustomFieldRow(k, v));
}

function addCustomFieldRow(key = '', value = '') {
  const list = document.getElementById('custom-fields-list');
  const row = document.createElement('div');
  row.className = 'custom-field-row';
  row.innerHTML = `
    <input type="text" class="cf-key" placeholder="Campo" value="${escHtml(key)}">
    <span class="field-sep">:</span>
    <input type="text" class="cf-val" placeholder="Valor" value="${escHtml(value)}">
    <button class="btn-remove-field" title="Remover">×</button>
  `;
  row.querySelector('.btn-remove-field').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

document.getElementById('btn-add-field').addEventListener('click', () => addCustomFieldRow());

function getCustomFields() {
  const fields = {};
  document.querySelectorAll('#custom-fields-list .custom-field-row').forEach(row => {
    const k = row.querySelector('.cf-key').value.trim();
    const v = row.querySelector('.cf-val').value.trim();
    if (k) fields[k] = v;
  });
  return fields;
}

// ---- Save ----
document.getElementById('btn-save').addEventListener('click', async () => {
  const name = document.getElementById('edit-name').value.trim();
  if (!name) { document.getElementById('edit-name').focus(); return; }

  const tags = getEditTags();
  const notes = document.getElementById('edit-notes').value;
  const customFields = getCustomFields();

  if (editingId) {
    // Update existing
    const item = allItems.find(i => i.id === editingId);
    const updated = { ...item, name, tags, notes, customFields };

    const r = await Sync.apiFetch(`/api/items/${editingId}`, { method: 'PUT', _body: updated });
    if (r.ok) {
      const saved = r._offline ? updated : await r.json();
      const idx = allItems.findIndex(i => i.id === editingId);
      allItems[idx] = saved;
      upsertMarker(saved);
      buildSidebar();
    }
  } else {
    // Create new
    const base = JSON.parse(document.getElementById('modal').dataset.newItem || '{}');
    const newItem = { ...base, name, tags, notes, customFields };
    const r = await Sync.apiFetch('/api/items', { method: 'POST', _body: newItem });
    if (r.ok) {
      const saved = r._offline ? { ...newItem, id: `tmp_${Date.now()}` } : await r.json();
      allItems.push(saved);
      upsertMarker(saved);
      buildSidebar();
    }
  }

  closeModal();
  await Sync.notifyStatus();
});

// ---- Delete ----
document.getElementById('btn-delete').addEventListener('click', async () => {
  if (!editingId) return;
  const item = allItems.find(i => i.id === editingId);
  if (!await customConfirm(`Excluir "${item.name}"?`, { confirmLabel: 'Excluir', danger: true })) return;

  const r = await Sync.apiFetch(`/api/items/${editingId}`, { method: 'DELETE', _body: {} });
  if (r.ok) {
    allItems = allItems.filter(i => i.id !== editingId);
    removeMarker(editingId);
    buildSidebar();
  }

  closeModal();
  await Sync.notifyStatus();
});

// ---- Close modal ----
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('btn-cancel').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  editingId = null;
}

// ---- Sync UI ----
function updateStatusUI(online, pendingCount) {
  const badge = document.getElementById('status-badge');
  const label = document.getElementById('status-label');
  const toast = document.getElementById('sync-toast');
  const msg = document.getElementById('sync-msg');

  badge.className = 'status';
  if (!online) {
    badge.classList.add('offline');
    label.textContent = 'Offline';
  } else if (pendingCount > 0) {
    badge.classList.add('pending');
    label.textContent = `${pendingCount} pendente${pendingCount > 1 ? 's' : ''}`;
  } else {
    badge.classList.add('online');
    label.textContent = 'Online';
  }

  if (pendingCount > 0) {
    msg.textContent = `${pendingCount} alteraç${pendingCount > 1 ? 'ões' : 'ão'} pendente${pendingCount > 1 ? 's' : ''}`;
    toast.classList.remove('hidden');
  } else {
    toast.classList.add('hidden');
  }
}

document.getElementById('btn-sync-now').addEventListener('click', async () => {
  await Sync.flushQueue();
  await loadItems();
});

document.getElementById('btn-sync-dismiss').addEventListener('click', () => {
  document.getElementById('sync-toast').classList.add('hidden');
});

// ---- Helpers ----
function polygonAreaM2(coords) {
  const n = coords.length;
  const avgLat = coords.reduce((s, c) => s + c[0], 0) / n;
  const mLat = 111320;
  const mLon = 111320 * Math.cos(avgLat * Math.PI / 180);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [lat1, lon1] = coords[i];
    const [lat2, lon2] = coords[(i + 1) % n];
    area += (lon1 * mLon) * (lat2 * mLat) - (lon2 * mLon) * (lat1 * mLat);
  }
  return Math.abs(area) / 2;
}

function polygonPerimeterM(coords) {
  const n = coords.length;
  const avgLat = coords.reduce((s, c) => s + c[0], 0) / n;
  const mLat = 111320;
  const mLon = 111320 * Math.cos(avgLat * Math.PI / 180);
  let perim = 0;
  for (let i = 0; i < n; i++) {
    const [lat1, lon1] = coords[i];
    const [lat2, lon2] = coords[(i + 1) % n];
    perim += Math.hypot((lon2 - lon1) * mLon, (lat2 - lat1) * mLat);
  }
  return perim;
}

function polygonInsetAreaM2(coords, d) {
  // Area of convex polygon shrunk inward by d meters: A - P·d + π·d²
  return Math.max(0, polygonAreaM2(coords) - polygonPerimeterM(coords) * d + Math.PI * d * d);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function customConfirm(message, { confirmLabel = 'Confirmar', danger = false } = {}) {
  return new Promise(resolve => {
    const overlay  = document.getElementById('confirm-overlay');
    const okBtn    = document.getElementById('confirm-ok');
    document.getElementById('confirm-message').textContent = message;
    okBtn.textContent = confirmLabel;
    okBtn.className = danger ? 'btn-danger' : 'btn-primary';
    overlay.classList.remove('hidden');

    function done(result) {
      overlay.classList.add('hidden');
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onKey(e) { if (e.key === 'Escape') done(false); }
    document.addEventListener('keydown', onKey);
    okBtn.onclick = () => done(true);
    document.getElementById('confirm-cancel').onclick = () => done(false);
    overlay.onclick = e => { if (e.target === overlay) done(false); };
  });
}

// ---- Display settings UI ----
function initDisplaySettingsUI() {
  const fontRange = document.getElementById('font-size-range');
  const pinRange  = document.getElementById('pin-size-range');
  fontRange.value = displaySettings.fontSize;
  pinRange.value  = displaySettings.pinSize;
  document.getElementById('font-size-val').textContent = displaySettings.fontSize;
  document.getElementById('pin-size-val').textContent  = displaySettings.pinSize.toFixed(1);

  // Label mode buttons
  document.querySelectorAll('#label-mode-btns .mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === displaySettings.labelMode);
  });
  document.getElementById('label-mode-btns').addEventListener('click', e => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    displaySettings.labelMode = btn.dataset.mode;
    document.querySelectorAll('#label-mode-btns .mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    saveDisplaySettings();
    applyDisplaySettings();
  });

  // Boundary mode buttons
  document.querySelectorAll('#boundary-mode-btns .mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.bmode === displaySettings.boundaryMode);
  });
  document.getElementById('boundary-mode-btns').addEventListener('click', e => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    displaySettings.boundaryMode = btn.dataset.bmode;
    document.querySelectorAll('#boundary-mode-btns .mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    saveDisplaySettings();
    applyBoundaryVisibility();
  });

  // Font size slider
  fontRange.addEventListener('input', () => {
    displaySettings.fontSize = parseInt(fontRange.value, 10);
    document.getElementById('font-size-val').textContent = displaySettings.fontSize;
    document.documentElement.style.setProperty('--pin-label-font-size', `${displaySettings.fontSize}px`);
    saveDisplaySettings();
  });

  // Pin size slider
  pinRange.addEventListener('input', () => {
    displaySettings.pinSize = parseFloat(pinRange.value);
    document.getElementById('pin-size-val').textContent = displaySettings.pinSize.toFixed(1);
    saveDisplaySettings();
    applyDisplaySettings();
  });
}

// ---- Map initial view ----
async function initMapView() {
  if (allItems.length > 0) {
    const group = L.featureGroup(Object.values(markers));
    map.fitBounds(group.getBounds().pad(0.15));
    return;
  }
  const located = await new Promise(resolve => {
    if (!navigator.geolocation) { resolve(false); return; }
    navigator.geolocation.getCurrentPosition(
      pos => { map.setView([pos.coords.latitude, pos.coords.longitude], 14); resolve(true); },
      () => resolve(false),
      { timeout: 6000 }
    );
  });
  if (!located) map.setView([51.1789, -1.8262], 15); // Stonehenge
}

// ---- Tag editor modal ----
function openTagsModal() {
  const list = document.getElementById('tag-editor-list');
  list.innerHTML = '';
  Object.entries(TAG_CONFIG).forEach(([name, cfg]) => addTagEditorRow(name, cfg.color, cfg.emoji));
  document.getElementById('tags-modal-overlay').classList.remove('hidden');
}

function closeTagsModal() {
  document.getElementById('tags-modal-overlay').classList.add('hidden');
}

function addTagEditorRow(name = '', color = '#64748b', emoji = '🏷') {
  const list = document.getElementById('tag-editor-list');
  const row  = document.createElement('div');
  row.className = 'tag-editor-row';
  row.dataset.original = name;
  row.innerHTML = `
    <input type="color" class="tag-color-picker" value="${color}" title="Cor">
    <input type="text"  class="tag-emoji-input"  value="${escHtml(emoji)}" maxlength="4" placeholder="🏷">
    <input type="text"  class="tag-name-input"   value="${escHtml(name)}" placeholder="Nome da tag">
    <button class="btn-remove-tag-row" title="Remover">&#215;</button>
  `;
  row.querySelector('.btn-remove-tag-row').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

async function saveTagsModal() {
  const rows      = [...document.querySelectorAll('.tag-editor-row')];
  const renameMap = {};
  const newConfig = {};

  rows.forEach(row => {
    const original = row.dataset.original;
    const name     = row.querySelector('.tag-name-input').value.trim().toLowerCase();
    const color    = row.querySelector('.tag-color-picker').value;
    const emoji    = row.querySelector('.tag-emoji-input').value.trim() || '🏷';
    if (!name) return;
    newConfig[name] = { color, emoji };
    if (original && original !== name) renameMap[original] = name;
  });

  // Migrate tag names in all items
  if (Object.keys(renameMap).length > 0) {
    allItems.forEach(item => {
      item.tags = item.tags.map(t => renameMap[t] ?? t);
    });
    localStorage.setItem('map-items', JSON.stringify({ items: allItems }));
  }

  // Update TAG_CONFIG in-place so all references stay valid
  Object.keys(TAG_CONFIG).forEach(k => delete TAG_CONFIG[k]);
  Object.assign(TAG_CONFIG, newConfig);
  localStorage.setItem('map-tags', JSON.stringify(TAG_CONFIG));

  // Sync activeTags: add new, remove deleted
  activeTags = new Set([...activeTags, ...Object.keys(TAG_CONFIG)]
    .filter(t => TAG_CONFIG[t] || allItems.some(i => i.tags.includes(t))));

  applyDisplaySettings();
  buildSidebar();
  closeTagsModal();
}

// ---- Import / Export ----
function exportData() {
  const payload = {
    version: 1,
    exportDate: new Date().toISOString(),
    items: JSON.parse(localStorage.getItem('map-items') || 'null') || window.SEED_ITEMS || { items: [] },
    boundary: JSON.parse(localStorage.getItem('map-boundary') || 'null') || window.SEED_BOUNDARY || {},
    tagConfig: TAG_CONFIG,
    displaySettings: { ...displaySettings },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `map_backup_${new Date().toISOString().replace('T', '_').replace(/[^0-9_]/g, "-").slice(0, 19)}.json`;
  a.click();
}

async function importData(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.items || !data.boundary) { alert('Arquivo inválido: faltam campos obrigatórios.'); return; }
    if (!await customConfirm('Isso vai substituir todos os dados atuais. Continuar?', { confirmLabel: 'Importar' })) return;
    localStorage.setItem('map-items', JSON.stringify(data.items));
    localStorage.setItem('map-boundary', JSON.stringify(data.boundary));
    if (data.tagConfig) localStorage.setItem('map-tags', JSON.stringify(data.tagConfig));
    if (data.displaySettings) localStorage.setItem('map-display-settings', JSON.stringify(data.displaySettings));
    location.reload();
  } catch(e) {
    alert('Erro ao importar: ' + e.message);
  }
}

// ---- Bootstrap ----
(async () => {
  loadDisplaySettings();
  document.documentElement.style.setProperty('--pin-label-font-size', `${displaySettings.fontSize}px`);

  await Sync.init(updateStatusUI);
  await loadItems();
  await initMapView();
  await loadBoundary();

  initDisplaySettingsUI();

  function initSearchClear(inputId, clearId) {
    const input = document.getElementById(inputId);
    const btn   = document.getElementById(clearId);
    input.addEventListener('input', () => btn.classList.toggle('hidden', !input.value));
    btn.addEventListener('click', () => {
      input.value = '';
      btn.classList.add('hidden');
      input.dispatchEvent(new Event('input'));
      input.focus();
    });
  }
  initSearchClear('search-input', 'search-input-clear');
  initSearchClear('list-search', 'list-search-clear');

  document.getElementById('btn-edit-tags').addEventListener('click', openTagsModal);
  document.getElementById('tags-modal-close').addEventListener('click', closeTagsModal);
  document.getElementById('btn-tags-cancel').addEventListener('click', closeTagsModal);
  document.getElementById('btn-tags-save').addEventListener('click', saveTagsModal);
  document.getElementById('btn-add-tag-row').addEventListener('click', () => addTagEditorRow());
  document.getElementById('tags-modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('tags-modal-overlay')) closeTagsModal();
  });

  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = '';
  });

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
