// ==================== 遛娃地图 ====================

let map, userMarker, placeGroup = L.layerGroup();
let userLat, userLon;
let currentCat = 'all';
let places = [];
let weatherData = null;
let fetchError = null;

// ---- Configuration ----
const AMAP_KEY = '9b01248f8dc66dfd7c5df913904bae4f';
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
  park:       { l: '公园绿地', e: '🌳', t: ['outdoor'],          types: '公园' },
  playground: { l: '游乐场',   e: '🛝', t: ['outdoor'],          types: '游乐场|游乐园|儿童乐园', keywords: '游乐场|儿童乐园|亲子乐园' },
  museum:     { l: '博物馆',   e: '🏛️', t: ['ac', 'indoor'],    types: '博物馆' },
  mall:       { l: '商场空调', e: '🛍️', t: ['ac', 'indoor'],    types: '购物中心|商场', keywords: '商场|购物中心|百货' },
  library:    { l: '图书馆',   e: '📚', t: ['ac', 'indoor'],    types: '图书馆' },
  zoo:        { l: '动物园',   e: '🐼', t: ['outdoor','activity'], types: '动物园|水族馆|海洋馆', keywords: '动物园|海洋馆|水族馆' },
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
    c.addEventListener('click', function() {
      var cat = this.dataset.cat;
      if (cat === 'nursery' || cat === 'hospital' || cat === 'babyShop') {
        document.querySelectorAll('.cat-chip').forEach(function(x) { x.classList.remove('active'); });
        this.classList.add('active');
        currentCat = cat;
        fetchEmergency(cat);
        return;
      }
      document.querySelectorAll('.cat-chip').forEach(function(x) { x.classList.remove('active'); });
      this.classList.add('active');
      currentCat = cat;
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


// 应急点位搜索（母婴室/医院/母婴用品）
async function fetchEmergency(cat) {
  showLoading(true);
  setStatus('busy', '🔍 搜索中...');
  places = [];

  var gcjCenter = wgs84ToGcj02(userLon, userLat);
  var locStr = gcjCenter.lon.toFixed(6) + ',' + gcjCenter.lat.toFixed(6);

  try {
    var items = await fetchAmapPOI(cat, locStr, FALLBACK_RADIUS_M);
    if (items && items.length > 0) {
      items.forEach(function(p) { p.cat = cat; });
      var seen = {};
      var merged = [];
      items.forEach(function(p) {
        var k = p.lat.toFixed(4) + ',' + p.lon.toFixed(4);
        if (!seen[k]) { seen[k] = true; merged.push(p); }
      });
      places = merged;
      places.forEach(function(p) { p.dist = haversine(userLat, userLon, p.lat, p.lon); });
      places.sort(function(a, b) { return a.dist - b.dist; });
      setStatus('ok', '✅ ' + places.length + '个' + CATS[cat].l);
    } else {
      setStatus('ok', '⚠️ 周边暂无');
    }
  } catch(e) {
    setStatus('err', '⚠️ 请求失败');
  }
  showLoading(false);
  renderAll();
}

async function fetchPlaces() {
  showLoading(true);
  setStatus('busy', '🔍 搜索中...');
  fetchError = null;
  places = [];

  var gcjCenter = wgs84ToGcj02(userLon, userLat);
  var locStr = gcjCenter.lon.toFixed(6) + ',' + gcjCenter.lat.toFixed(6);
  var catKeys = Object.keys(CATS).filter(function(k) { return k !== 'all' && k !== 'nursery' && k !== 'hospital' && k !== 'babyShop'; });

  // Phase 1: parallel Amap POI search (all categories at once)
  var results;
  try {
    results = await Promise.all(catKeys.map(function(cat) {
      return fetchAmapPOI(cat, locStr, SEARCH_RADIUS_M);
    }));
  } catch(e) { results = []; }

  var all = [];
  var anyOk = false;
  (results || []).forEach(function(items, i) {
    if (items && items.length > 0) {
      anyOk = true;
      items.forEach(function(p) { p.cat = catKeys[i]; });
      all = all.concat(items);
    }
  });

  // Phase 2: if nothing found, expand radius
  if (!anyOk) {
    setStatus('busy', '🔍 扩大范围搜索...');
    try {
      results = await Promise.all(catKeys.map(function(cat) {
        return fetchAmapPOI(cat, locStr, FALLBACK_RADIUS_M);
      }));
      (results || []).forEach(function(items, i) {
        if (items && items.length > 0) {
          items.forEach(function(p) { p.cat = catKeys[i]; });
          all = all.concat(items);
        }
      });
    } catch(e) { console.warn('Expanded search failed:', e.message); }
  }

  // Deduplicate by 100m proximity
  var seen = {};
  var merged = [];
  all.forEach(function(p) {
    var key = p.lat.toFixed(4) + ',' + p.lon.toFixed(4);
    if (!seen[key]) { seen[key] = true; merged.push(p); }
  });
  places = merged;
  places.forEach(function(p) {
    p.dist = haversine(userLat, userLon, p.lat, p.lon);
  });
  places.sort(function(a, b) { return a.dist - b.dist; });

  showLoading(false);
  if (places.length > 0) {
    setStatus('ok', '✅ ' + places.length + '个地点');
  } else {
    fetchError = '该区域暂无收录的遛娃地点，请尝试移动到城市中心区域。';
    setStatus('err', '⚠️ 周边暂无');
  }
  renderAll();
}

async function fetchAmapPOI(cat, locStr, radius) {
  var kw = CATS[cat].keywords;
  var params = [
    'key=' + AMAP_KEY,
    'location=' + locStr,
    'radius=' + radius,
    'keywords=' + encodeURIComponent(kw),
    'offset=25',
    'output=json'
  ].join('&');
  var url = 'https://restapi.amap.com/v3/place/around?' + params;

  // Try direct fetch first (works through proxy, or if Amap adds CORS)
  try {
    var ctrl = new AbortController();
    var t = setTimeout(function() { ctrl.abort(); }, 8000);
    var resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (resp.ok) {
      var data = await resp.json();
      if (data && data.status === '1') {
        return parseAmapResults(data);
      }
    }
  } catch(e) {
    console.log('Direct fetch failed, trying JSONP...');
  }

  // JSONP fallback for browser CORS restriction
  return new Promise(function(resolve, reject) {
    var cbName = '_amapCb_' + (Math.random() + '').replace('.', '');
    var timedOut = false;
    var t = setTimeout(function() {
      timedOut = true;
      cleanup();
      resolve([]); // Silent fallback: empty result
    }, 8000);

    window[cbName] = function(data) {
      if (timedOut) return;
      cleanup();
      try {
        if (data && data.status === '1') {
          resolve(parseAmapResults(data));
        } else {
          resolve([]);
        }
      } catch(e) {
        resolve([]);
      }
    };

    var script = document.createElement('script');
    script.src = url + '&callback=' + cbName;
    script.onerror = function() {
      if (!timedOut) { cleanup(); resolve([]); }
    };
    document.head.appendChild(script);

    function cleanup() {
      clearTimeout(t);
      window[cbName] = undefined;
      if (script.parentNode) script.parentNode.removeChild(script);
    }
  });
}

// Parse Amap POI results into our format
function parseAmapResults(data) {
  return (data.pois || []).map(function(p) {
    var loc = p.location.split(',');
    return {
      id: 'a_' + p.id,
      lat: parseFloat(loc[1]),
      lon: parseFloat(loc[0]),
      name: p.name,
      address: p.address || '',
      tags: { district: p.adname || '', city: p.cityname || '' },
    };
  });
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
    const addr2 = formatAddress(p);
    const addrLine = addr2 ? `<div style="color:#666;font-size:10px;margin-top:3px">📍 ${escHtml(addr2)}</div>` : '';
    m.bindPopup(`<div style="font-size:13px;min-width:180px"><b>${escHtml(p.name)}</b>
      <div style="color:#666;font-size:11px;margin:2px 0">${CATS[p.cat]?.e} ${CATS[p.cat]?.l} · ${d}</div>
      <div>${tg}</div>${addrLine}
      <a href="${navUrl(p.name, p.lat, p.lon)}" target="_blank" style="
        display:inline-block;margin-top:6px;padding:4px 14px;
        background:#4CAF50;color:#fff;border-radius:14px;
        font-size:12px;text-decoration:none;
      ">🧭 导航到这里</a></div>`);
  });

  // Kick off async address lookups (throttled queue, 1/sec)
  top.forEach(function(p) {
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
      const addr = formatAddress(p);
      const isCoord = addr && addr.indexOf('°') > 0; // coordinate fallback
      return '<div class="place-item" data-id="' + p.id + '">' +
        '<div class="p-left" onclick="flyTo(' + p.lat + ',' + p.lon + ')">' +
          '<div class="p-emoji">' + (CATS[p.cat]?.e || '📍') + '</div>' +
          '<div class="p-info">' +
            '<div class="p-name">' + escHtml(p.name) + '</div>' +
            '<div class="p-meta">' + CATS[p.cat]?.l + ' ' + tg + '</div>' +
            '<div class="p-addr">📍 ' + escHtml(addr) + '</div>' +
          '</div>' +
          '<div class="p-dist">' + d + '</div>' +
        '</div>' +
        '<a class="p-nav-btn" href="' + navUrl(p.name, p.lat, p.lon) + '" target="_blank" onclick="event.stopPropagation()" title="导航">🧭</a>' +
      '</div>';
    }).join('');
    openDrawer();
  }
}

// 生成各大地图导航链接（默认高德，兜底 Apple/Google）
function navUrl(name, lat, lon) {
  // 高德：使用 https URI 兼容所有平台
  var gdLon = lon.toFixed(6);
  var gdLat = lat.toFixed(6);
  return 'https://uri.amap.com/navigation?to=' + gdLon + ',' + gdLat + ',' +
    encodeURIComponent(name) + '&mode=car&coordinate=gaode';
}

// 点击导航按钮
function doNav(name, lat, lon) {
  window.open(navUrl(name, lat, lon), '_blank');
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

// 高德 POI 自带地址，直接使用
function formatAddress(p) {
  if (p.address) return p.address;
  var t = p.tags || {};
  var parts = [];
  if (t.city) parts.push(t.city);
  if (t.district) parts.push(t.district);
  return parts.join('');
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
  var colors = {
    park: '#4CAF50', playground: '#FF9800', museum: '#9C27B0',
    mall: '#2196F3', library: '#607D8B', zoo: '#E91E63',
    nursery: '#e57373', hospital: '#e53935', babyShop: '#f06292'
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
