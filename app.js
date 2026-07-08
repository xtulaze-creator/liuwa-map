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

// ---- WGS-84 → GCJ-02 坐标转换 ----
// 高德地图瓦片使用 GCJ-02（火星坐标系），而 OSM / 浏览器定位返回 WGS-84。
// 直接标上去会有 100-700m 偏移，必须转换。
function wgs84ToGcj02(wgsLon, wgsLat) {
  const PI = Math.PI;
  const a = 6378245.0;
  const ee = 0.00669342162296594323;

  if (wgsLon < 72.004 || wgsLon > 137.8347 || wgsLat < 0.8293 || wgsLat > 55.8271) {
    // 中国境外不做转换
    return { lat: wgsLat, lon: wgsLon };
  }

  const transformLat = (x, y) => {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * PI) + 320.0 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
    return ret;
  };

  const transformLon = (x, y) => {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 20.0 * PI)) * 2.0 / 3.0;
    return ret;
  };

  const dLat = transformLat(wgsLon - 105.0, wgsLat - 35.0);
  const dLon = transformLon(wgsLon - 105.0, wgsLat - 35.0);
  const radLat = wgsLat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const dLatOut = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * PI);
  const dLonOut = (dLon * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI);

  return { lat: wgsLat + dLatOut, lon: wgsLon + dLonOut };
}


// ---- Category Definitions ----
const CATS = {
  all: { l: '全部', e: '🗺️' },
  park: {
    l: '公园绿地', e: '🌳', t: ['outdoor'],
    q: (bb) => `[out:json][timeout:10];(node["leisure"="park"](${bb});way["leisure"="park"](${bb});node["leisure"="garden"](${bb});way["leisure"="garden"](${bb});node["leisure"="nature_reserve"](${bb});way["leisure"="nature_reserve"](${bb}););out center 30;`
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
    q: (bb) => `[out:json][timeout:10];(node["tourism"="zoo"](${bb});way["tourism"="zoo"](${bb});node["tourism"="aquarium"](${bb}));out center 30;`
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

  // WGS-84 → GCJ-02，与高德瓦片对齐
  const gcj = wgs84ToGcj02(userLon, userLat);

  if (userMarker) map.removeLayer(userMarker);
  userMarker = L.circleMarker([gcj.lat, gcj.lon], {
    radius: 9, fillColor: '#2196F3', fillOpacity: 1,
    color: '#fff', weight: 3
  }).addTo(map).bindPopup('<b>📍 我的位置</b>').openPopup();

  map.setView([gcj.lat, gcj.lon], 14, { animate: true });
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
  places = [];

  const bb = getBBox(userLat, userLon, SEARCH_RADIUS_M);
  const bbs = `${bb.south},${bb.west},${bb.north},${bb.east}`;

  const catKeys = Object.keys(CATS).filter(k => k !== 'all');
  const results = {};  // cat → places[]

  // ====== Phase 1: fire all 6 categories in parallel (6x faster than serial) ======
  const tasks = catKeys.map(async (cat) => {
    try {
      const query = CATS[cat].q(bbs);
      const data = await overpassQuery(query);
      const items = [];
      if (data && data.elements) {
        data.elements.forEach(el => {
          const lat = el.lat || el.center?.lat;
          const lon = el.lon || el.center?.lon;
          if (!lat || !lon) return;
          const name = el.tags?.name || el.tags?.['name:zh'] ||
                       el.tags?.['name:en'] || el.tags?.name_zh || CATS[cat].l;
          const gcj = wgs84ToGcj02(lon, lat);
          items.push({
            id: el.type + el.id, lat: gcj.lat, lon: gcj.lon, cat,
            name: name, tags: el.tags || {},
          });
        });
      }
      results[cat] = items;
      // Progressive: show results as each category finishes
      setStatus('busy', `🔍 已发现 ${Object.values(results).flat().length} 个地点...`);
      mergeAndShow();
    } catch (e) {
      console.warn(`[${cat}] 失败:`, e.message);
    }
  });

  await Promise.allSettled(tasks);
  showLoading(false);

  if (places.length > 0) {
    setStatus('ok', '✅ ' + places.length + '个地点');
    return;
  }

  // ====== Phase 2: all failed — retry with larger radius ======
  setStatus('busy', '🔍 扩大范围搜索...');
  const bb2 = getBBox(userLat, userLon, FALLBACK_RADIUS_M);
  const bbs2 = `${bb2.south},${bb2.west},${bb2.north},${bb2.east}`;

  let anyOk = false;
  const retryTasks = catKeys.map(async (cat) => {
    try {
      const query = CATS[cat].q(bbs2);
      const data = await overpassQuery(query);
      const items = [];
      if (data && data.elements) {
        data.elements.forEach(el => {
          const lat = el.lat || el.center?.lat;
          const lon = el.lon || el.center?.lon;
          if (!lat || !lon) return;
          const name = el.tags?.name || el.tags?.['name:zh'] ||
                       el.tags?.['name:en'] || el.tags?.name_zh || CATS[cat].l;
          const gcj = wgs84ToGcj02(lon, lat);
          items.push({
            id: el.type + el.id, lat: gcj.lat, lon: gcj.lon, cat,
            name: name, tags: el.tags || {},
          });
        });
      }
      if (items.length > 0) { results[cat] = items; anyOk = true; }
    } catch (e) { /* ignore */ }
  });
  await Promise.allSettled(retryTasks);

  if (anyOk) {
    mergeAndShow();
    setStatus('ok', '✅ ' + places.length + '个地点（扩大范围）');
  } else if (Object.keys(results).length === 0) {
    fetchError = '数据服务连接失败，请检查网络后重试。';
    setStatus('err', '⚠️ 服务不可用');
    renderAll();
  } else {
    fetchError = '该区域暂无收录的遛娃地点，请尝试移动到城市中心区域。';
    setStatus('err', '⚠️ 周边暂无');
    renderAll();
  }

  // ====== Merge & render helper ======
  function mergeAndShow() {
    const all = [];
    for (const c of Object.keys(results)) all.push(...results[c]);
    // Deduplicate: node > way for same-name within 300m
    const merged = [];
    all.forEach(p => {
      const dup = merged.find(ex =>
        (p.name || '').trim() === (ex.name || '').trim() &&
        haversine(p.lat, p.lon, ex.lat, ex.lon) < 300
      );
      if (dup) {
        if (p.id.startsWith('node') && !dup.id.startsWith('node')) {
          dup.lat = p.lat; dup.lon = p.lon; dup.id = p.id;
        }
      } else {
        merged.push(p);
      }
    });
    places = merged;
    places.forEach(p => { p.dist = haversine(userLat, userLon, p.lat, p.lon); });
    places.sort((a, b) => a.dist - b.dist);
    renderAll();
  }
}
async function overpassQuery(query) {
  const body = 'data=' + encodeURIComponent(query);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

  // All Overpass endpoints to try
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  const tryFetch = async (url, timeoutMs) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp;
    } finally {
      clearTimeout(t);
    }
  };

  // Phase 1: Race all endpoints + proxy, fastest wins
  const promises = endpoints.map(url => tryFetch(url, 8000));
  if (window.location.protocol !== 'file:') {
    promises.push(tryFetch(OVERPASS_PROXY, 3000).catch(() => null));
  }

  // Wait for the first successful response
  // We use a manual race since Promise.any might not handle null properly
  const results = await Promise.allSettled(promises);
  const firstOk = results.find(r => r.status === 'fulfilled' && r.value && r.value !== null);
  if (firstOk) return await firstOk.value.json();

  // Phase 2: Sequential retry with longer timeout
  for (const url of endpoints) {
    try {
      const resp = await tryFetch(url, 12000);
      return await resp.json();
    } catch (e) {
      console.warn('Overpass retry failed:', url, e.message);
    }
  }

  // Phase 3: Proxy last resort
  try {
    const resp = await tryFetch(OVERPASS_PROXY, 15000);
    return await resp.json();
  } catch (e) { /* ignore */ }

  throw new Error('所有数据源均不可达');
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
