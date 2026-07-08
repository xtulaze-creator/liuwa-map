// ==================== 遛娃地图 ====================

let map, userMarker, placeGroup = L.layerGroup();
let userLat, userLon;
let currentCat = 'all';
let places = [];
let weatherData = null;
let fetchError = null;

// ---- Configuration ----
const OVERPASS_PROXY = '/api/overpass';
const OVERPASS_DIRECT = 'https://overpass-api.de/api/interpreter';
const SEARCH_RADIUS_M = 5000;
const FALLBACK_RADIUS_M = 12000;

// ---- Category Definitions ----
const CATS = {
  all: { l: '全部', e: '🗺️' },
  park: {
    l: '公园绿地', e: '🌳', t: ['outdoor'],
    q: (bb) => `[out:json][timeout:10];(node["leisure"="park"](${bb});way["leisure"="park"](${bb});node["leisure"="garden"](${bb});node["leisure"="nature_reserve"](${bb}););out center 30;`
  },
  playground: {
    l: '游乐场', e: '🛝', t: ['outdoor'],
    q: (bb) => `[out:json][timeout:10];(node["leisure"="playground"](${bb});way["leisure"="playground"](${bb}););out center 30;`
  },
  museum: {
    l: '博物馆', e: '🏛️', t: ['ac', 'indoor'],
    q: (bb) => `[out:json][timeout:10];(node["tourism"="museum"](${bb});way["tourism"="museum"](${bb});node["tourism"="gallery"](${bb}););out center 30;`
  },
  mall: {
    l: '商场空调', e: '🛍️', t: ['ac', 'indoor'],
    q: (bb) => `[out:json][timeout:10];(node["shop"="mall"](${bb});way["shop"="mall"](${bb});way["building"="retail"](${bb});way["landuse"="retail"](${bb}););out center 30;`
  },
  library: {
    l: '图书馆', e: '📚', t: ['ac', 'indoor'],
    q: (bb) => `[out:json][timeout:10];(node["amenity"="library"](${bb});way["amenity"="library"](${bb}););out center 30;`
  },
  zoo: {
    l: '动物园', e: '🐼', t: ['outdoor', 'activity'],
    q: (bb) => `[out:json][timeout:10];(node["tourism"="zoo"](${bb});way["tourism"="zoo"](${bb});node["tourism"="aquarium"](${bb}););out center 30;`
  },
};

// ---- Init ----
function init() {
  map = L.map('map', {
    center: [31.2304, 121.4737],
    zoom: 13,
    zoomControl: false,
    attributionControl: false
  });

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer(
    'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    { subdomains: '1234', maxZoom: 18 }
  ).addTo(map);

  L.control.attribution({ position: 'bottomright', prefix: '© 高德 | OSM' }).addTo(map);
  placeGroup.addTo(map);

  // Category chips
  document.querySelectorAll('.cat-chip').forEach(c => {
    c.addEventListener('click', () => {
      document.querySelectorAll('.cat-chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      currentCat = c.dataset.cat;
      renderAll();
    });
  });

  // Locate button
  document.getElementById('btnLocate').addEventListener('click', locate);

  // Drawer overlay
  document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);

  // Drawer swipe-down gesture
  let touchStartY = 0;
  const drawer = document.getElementById('drawer');
  drawer.addEventListener('touchstart', e => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  drawer.addEventListener('touchmove', e => {
    if (drawer.scrollTop <= 0 && e.touches[0].clientY - touchStartY > 50) {
      closeDrawer();
    }
  }, { passive: true });

  // Close drawer on map click
  map.on('click', () => {
    if (drawer.classList.contains('open')) closeDrawer();
  });

  locate();
}

// ---- Geolocation ----
function locate() {
  const btn = document.getElementById('btnLocate');
  btn.classList.add('locating');
  showLoading(true);
  setStatus('busy', '🔍 定位中...');
  fetchError = null;

  if (!navigator.geolocation) {
    useDefaultLocation();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude;
      userLon = pos.coords.longitude;
      onReady();
    },
    () => { useDefaultLocation(); },
    { enableHighAccuracy: true, timeout: 6000, maximumAge: 300000 }
  );
}

function useDefaultLocation() {
  userLat = 31.2304;  // Shanghai
  userLon = 121.4737;
  onReady();
}

function onReady() {
  document.getElementById('btnLocate').classList.remove('locating');

  if (userMarker) map.removeLayer(userMarker);
  userMarker = L.circleMarker([userLat, userLon], {
    radius: 9, fillColor: '#2196F3', fillOpacity: 1,
    color: '#fff', weight: 3
  }).addTo(map).bindPopup('<b>📍 我的位置</b>').openPopup();

  map.setView([userLat, userLon], 14, { animate: true });
  fetchWeather();
  fetchPlaces();
}

// ---- Weather ----
async function fetchWeather() {
  const card = document.getElementById('weather-card');
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${userLat}&longitude=${userLon}&current_weather=true&timezone=auto`
    );
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    weatherData = d.current_weather;
    const w = weatherData;
    const advice = weatherAdvice(w.weathercode, w.temperature);
    card.innerHTML = `<span class="temp">${Math.round(w.temperature)}°</span>
      <span class="desc" title="${escHtml(advice)}">${weatherText(w.weathercode)} ${Math.round(w.windspeed)}km/h</span>`;
  } catch (e) {
    card.innerHTML = `<span class="temp">--°</span><span class="desc">天气不可用</span>`;
    console.warn('Weather fetch failed:', e.message);
  }
}

function weatherText(code) {
  if (code <= 1) return '☀️晴';
  if (code === 2) return '⛅多云';
  if (code === 3) return '☁️阴';
  if (code <= 49) return '🌫️雾';
  if (code <= 59) return '🌧️小雨';
  if (code <= 69) return '❄️雪';
  if (code <= 79) return '🌦️阵雨';
  return '⛈️雷暴';
}

function weatherAdvice(code, temp) {
  if (code <= 1) return temp > 30 ? '☀️ 晴天炎热，推荐室内活动（商场/博物馆/图书馆）' : '☀️ 晴天，适合户外遛娃！';
  if (code === 2) return '⛅ 多云，适合各类户外活动';
  if (code === 3) return '☁️ 阴天，公园散步也不错';
  if (code <= 49) return '🌫️ 有雾，建议室内活动';
  if (code <= 59) return '🌧️ 有小雨，建议室内场所（商场/博物馆）';
  if (code <= 69) return '❄️ 下雪天，注意保暖，室内活动为主';
  if (code <= 79) return '🌦️ 阵雨，带好雨具，优先室内';
  return '⛈️ 雷暴天气，建议居家';
}

// ---- Places Search ----
async function fetchPlaces() {
  showLoading(true);
  setStatus('busy', '🔍 搜索中...');
  fetchError = null;

  const bb = getBBox(userLat, userLon, SEARCH_RADIUS_M);
  const bbs = `${bb.south},${bb.west},${bb.north},${bb.east}`;

  const catKeys = Object.keys(CATS).filter(k => k !== 'all');
  const all = [];
  let ok = 0, fail = 0;
  let lastError = null;

  for (const cat of catKeys) {
    try {
      const query = CATS[cat].q(bbs);
      const data = await overpassQuery(query);
      if (data && data.elements) {
        data.elements.forEach(el => {
          const lat = el.lat || el.center?.lat;
          const lon = el.lon || el.center?.lon;
          if (!lat || !lon) return;
          const name = el.tags?.name || el.tags?.['name:zh'] ||
                       el.tags?.['name:en'] || el.tags?.name_zh || CATS[cat].l;
          all.push({
            id: el.type + el.id, lat, lon, cat,
            name: name,
            tags: el.tags || {},
          });
        });
      }
      ok++;
    } catch (e) {
      fail++;
      lastError = e.message;
      console.warn(`[${cat}] 失败:`, e.message);
    }
  }

  // Deduplicate & compute distances
  const seen = new Set();
  places = all.filter(p => seen.has(p.id) ? false : seen.add(p.id));
  places.forEach(p => { p.dist = haversine(userLat, userLon, p.lat, p.lon); });
  places.sort((a, b) => a.dist - b.dist);

  showLoading(false);

  if (places.length > 0) {
    // Success — real data from OSM
    setStatus('ok', '✅ ' + places.length + '个地点');
  } else if (ok === 0 && fail > 0) {
    // All categories failed — network / CORS issue
    fetchError = `数据服务连接失败（${fail}类请求均失败）`;
    setStatus('err', '⚠️ 服务不可用');
  } else if (ok > 0 && places.length === 0) {
    // API worked but no results — try larger radius
    fetchError = null;
    const bb2 = getBBox(userLat, userLon, FALLBACK_RADIUS_M);
    const bbs2 = `${bb2.south},${bb2.west},${bb2.north},${bb2.east}`;
    const retryAll = [];
    let retryOk = 0;
    for (const cat of catKeys) {
      try {
        const query = CATS[cat].q(bbs2);
        const data = await overpassQuery(query);
        if (data && data.elements) {
          data.elements.forEach(el => {
            const lat = el.lat || el.center?.lat;
            const lon = el.lon || el.center?.lon;
            if (!lat || !lon) return;
            const name = el.tags?.name || el.tags?.['name:zh'] ||
                         el.tags?.['name:en'] || el.tags?.name_zh || CATS[cat].l;
            retryAll.push({
              id: el.type + el.id, lat, lon, cat,
              name: name,
              tags: el.tags || {},
            });
          });
        }
        retryOk++;
      } catch (e) { /* ignore */ }
    }
    const seen2 = new Set();
    const retryPlaces = retryAll.filter(p => seen2.has(p.id) ? false : seen2.add(p.id));
    retryPlaces.forEach(p => { p.dist = haversine(userLat, userLon, p.lat, p.lon); });
    retryPlaces.sort((a, b) => a.dist - b.dist);

    if (retryPlaces.length > 0) {
      places = retryPlaces;
      setStatus('ok', '✅ ' + places.length + '个地点（扩大范围）');
    } else {
      setStatus('err', '⚠️ 周边暂无');
      fetchError = '该区域暂无收录的遛娃地点，请尝试移动到城市中心区域。';
    }
  } else {
    // ok === 0 && fail === 0 — shouldn't normally happen
    fetchError = '暂无分类可查询';
    setStatus('err', '⚠️ 无数据');
  }

  renderAll();
}

async function overpassQuery(query) {
  const body = 'data=' + encodeURIComponent(query);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);

  try {
    // Try proxy first (no CORS issues), fallback to direct
    let resp;
    try {
      resp = await fetch(OVERPASS_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body,
        signal: ctrl.signal,
      });
    } catch (proxyErr) {
      // Proxy unavailable — try direct Overpass API (supports CORS)
      console.warn('代理不可用，直连 Overpass API:', proxyErr.message);
      resp = await fetch(OVERPASS_DIRECT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body,
        signal: ctrl.signal,
      });
    }

    clearTimeout(t);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  } finally {
    clearTimeout(t);
  }
}

// ---- Render ----
function renderAll() {
  const filtered = currentCat === 'all'
    ? places
    : places.filter(p => p.cat === currentCat);

  placeGroup.clearLayers();
  const top = filtered.slice(0, 40);

  top.forEach(p => {
    const m = L.marker([p.lat, p.lon], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:${categoryColor(p.cat)};color:#fff;width:28px;height:28px;
          border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;
          align-items:center;justify-content:center;font-size:14px;
          box-shadow:0 2px 6px rgba(0,0,0,0.25);border:2px solid #fff;">
          <span style="transform:rotate(45deg)">${CATS[p.cat]?.e || '📍'}</span></div>`,
        iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28]
      })
    }).addTo(placeGroup);

    const d = formatDistance(p.dist);
    const tg = buildTagHtml(p.cat);
    m.bindPopup(`<div style="font-size:13px"><b>${escHtml(p.name)}</b>
      <div style="color:#666;font-size:11px;margin:2px 0">${CATS[p.cat]?.e} ${CATS[p.cat]?.l} · ${d}</div>
      <div>${tg}</div></div>`);
  });

  updateDrawer(top);
}

function updateDrawer(filtered) {
  const title = document.getElementById('drawer-title');
  const count = document.getElementById('drawer-count');
  const list = document.getElementById('drawer-list');
  const empty = document.getElementById('drawer-empty');
  const emptyMsg = document.getElementById('drawer-empty-msg');

  title.textContent = currentCat === 'all'
    ? '附近遛娃好去处'
    : CATS[currentCat]?.e + ' ' + CATS[currentCat]?.l;
  count.textContent = filtered.length + '个';

  if (filtered.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';

    if (fetchError) {
      // API failure — show error with retry button
      emptyMsg.innerHTML = `${fetchError}<br><br>
        <button onclick="locate()" style="
          padding:8px 20px;border-radius:16px;border:none;
          background:#4CAF50;color:#fff;font-size:13px;cursor:pointer;
          box-shadow:0 2px 8px rgba(76,175,80,0.3);
        ">🔄 重新加载</button>`;
    } else if (places.length === 0 && !fetchError) {
      // Still loading
      emptyMsg.textContent = '正在加载周边地点...';
    } else {
      // Places exist but filtered to zero
      emptyMsg.textContent = '该分类暂无地点';
    }
  } else {
    empty.style.display = 'none';
    list.innerHTML = filtered.map(p => {
      const d = formatDistance(p.dist);
      const tg = buildTagHtml(p.cat);
      return `<div class="place-item" onclick="flyTo(${p.lat},${p.lon})">
        <div class="p-emoji">${CATS[p.cat]?.e || '📍'}</div>
        <div class="p-info">
          <div class="p-name">${escHtml(p.name)}</div>
          <div class="p-meta">${CATS[p.cat]?.l} ${tg}</div>
        </div>
        <div class="p-dist">${d}</div>
      </div>`;
    }).join('');
    openDrawer();
  }
}

function flyTo(lat, lon) {
  map.flyTo([lat, lon], 17, { duration: 0.7 });
  setTimeout(() => {
    placeGroup.eachLayer(l => {
      const ll = l.getLatLng();
      if (Math.abs(ll.lat - lat) < 0.0002 && Math.abs(ll.lng - lon) < 0.0002) {
        l.openPopup();
      }
    });
  }, 800);
  closeDrawer();
}

function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
}

function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

// ---- UI Helpers ----
function setStatus(cls, txt) {
  const b = document.getElementById('status-badge');
  b.className = cls;
  b.textContent = txt;
}

function showLoading(on) {
  document.getElementById('loading-bar').classList.toggle('active', on);
}

function toast(msg) {
  const e = document.getElementById('toast');
  e.textContent = msg;
  e.classList.add('show');
  clearTimeout(e._to);
  e._to = setTimeout(() => e.classList.remove('show'), 2000);
}

// ---- Utility ----
function getBBox(lat, lon, radiusM) {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
  return {
    south: (lat - dLat).toFixed(6),
    north: (lat + dLat).toFixed(6),
    west:  (lon - dLon).toFixed(6),
    east:  (lon + dLon).toFixed(6),
  };
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(m) {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

function categoryColor(cat) {
  const colors = {
    park: '#4CAF50', playground: '#FF9800', museum: '#9C27B0',
    mall: '#2196F3', library: '#607D8B', zoo: '#E91E63'
  };
  return colors[cat] || '#757575';
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function buildTagHtml(cat) {
  const tags = CATS[cat]?.t || [];
  return tags.map(t => {
    if (t === 'ac')       return '<span class="tag ac">有空调</span>';
    if (t === 'outdoor')  return '<span class="tag outdoor">户外</span>';
    if (t === 'indoor')   return '<span class="tag indoor">室内</span>';
    if (t === 'activity') return '<span class="tag activity">亲子活动</span>';
    return '';
  }).join('');
}

// ---- Startup ----
document.addEventListener('DOMContentLoaded', init);
