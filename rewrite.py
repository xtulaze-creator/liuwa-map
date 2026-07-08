with open('app.js', 'r') as f:
    content = f.read()

# === Step 1: Config ===
old = "const OVERPASS_PROXY = '/api/overpass';"
new = "const AMAP_KEY = '9b01248f8dc66dfd7c5df913904bae4f';"
content = content.replace(old, new)
content = content.replace("const OVERPASS_DIRECT = 'https://overpass-api.de/api/interpreter';", "const SEARCH_RADIUS_M = 5000;")
content = content.replace("const SEARCH_RADIUS_M = 5000;\nconst FALLBACK_RADIUS_M = 12000;", "const FALLBACK_RADIUS_M = 12000;")
print("Step 1: Config done")

# === Step 2: CATS ===
idx_start = content.find('const CATS = {')
idx_end   = content.find('// ---- Init ----', idx_start)
old_cats = content[idx_start:idx_end]
new_cats = """const CATS = {
  all: { l: '全部', e: '🗺️' },
  park:       { l: '公园绿地', e: '🌳', t: ['outdoor'],          types: '公园' },
  playground: { l: '游乐场',   e: '🛝', t: ['outdoor'],          types: '游乐场|游乐园|儿童乐园' },
  museum:     { l: '博物馆',   e: '🏛️', t: ['ac', 'indoor'],    types: '博物馆' },
  mall:       { l: '商场空调', e: '🛍️', t: ['ac', 'indoor'],    types: '购物中心|商场' },
  library:    { l: '图书馆',   e: '📚', t: ['ac', 'indoor'],    types: '图书馆' },
  zoo:        { l: '动物园',   e: '🐼', t: ['outdoor','activity'], types: '动物园|水族馆|海洋馆' },
};

// ---- Init ----
"""
content = content.replace(old_cats, new_cats)
print("Step 2: CATS done")

# === Step 3: fetchPlaces → Amap version ===
fp_start = content.find('async function fetchPlaces() {')
op_start = content.find('async function overpassQuery(query) {', fp_start)
# Find end of overpassQuery
search_from = op_start
brace = 0
started = False
op_end = None
for i in range(op_start, len(content)):
    c = content[i]
    if c == '{': brace += 1; started = True
    elif c == '}': brace -= 1
    if started and brace == 0 and i > op_start + 10:
        op_end = i
        break
print(f"overpassQuery end at char {op_end}")

old_fp_block = content[fp_start:op_end+1]

new_block = """async function fetchPlaces() {
  showLoading(true);
  setStatus('busy', '🔍 搜索中...');
  fetchError = null;
  places = [];

  var gcjCenter = wgs84ToGcj02(userLon, userLat);
  var locStr = gcjCenter.lon.toFixed(6) + ',' + gcjCenter.lat.toFixed(6);
  var catKeys = Object.keys(CATS).filter(function(k) { return k !== 'all'; });

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
  var types = CATS[cat].types;
  var url = 'https://restapi.amap.com/v3/place/around?key=' + AMAP_KEY +
    '&location=' + locStr + '&radius=' + radius +
    '&types=' + encodeURIComponent(types) +
    '&offset=25&output=json';
  var ctrl = new AbortController();
  var t = setTimeout(function() { ctrl.abort(); }, 8000);
  var resp = await fetch(url, { signal: ctrl.signal });
  clearTimeout(t);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  var data = await resp.json();
  if (data.status !== '1') throw new Error(data.info || 'API error');
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
"""

content = content.replace(old_fp_block, new_block)
print("Step 3: fetchPlaces + fetchAmapPOI done")

# === Step 4: Replace Nominatim + formatAddress ===
addr_start = content.find('var _addrCache = {};')
if addr_start == -1:
    addr_start = content.find('var _addrCache ')
hav_start = content.find('function haversine(lat1', addr_start)

old_addr = content[addr_start:hav_start]

new_addr = """// 高德 POI 自带地址，直接使用
function formatAddress(p) {
  if (p.address) return p.address;
  var t = p.tags || {};
  var parts = [];
  if (t.city) parts.push(t.city);
  if (t.district) parts.push(t.district);
  return parts.join('');
}

"""
content = content.replace(old_addr, new_addr)
print("Step 4: formatAddress done")

# === Step 5: Fix leftover references ===
content = content.replace('enqueueAddress(p);', '')
content = content.replace("var isCoord = addr && addr.indexOf('°') > 0; // coordinate fallback", '')
content = content.replace("' + (isCoord ? ' p-addr-coord' : '') + '", '')
content = content.replace("formatAddress(p.tags, p.lat, p.lon)", "formatAddress(p)")
content = content.replace('// getBBox removed (using Amap)', '')

# Remove dangling function getBBox
gb_start = content.find('function getBBox(')
if gb_start > 0:
    brace = 0
    gb_end = None
    for i in range(gb_start, len(content)):
        if content[i] == '{': brace += 1
        elif content[i] == '}': brace -= 1
        if brace == 0 and i > gb_start + 10:
            gb_end = i
            break
    if gb_end:
        content = content[:gb_start-1] + content[gb_end+1:]
        print("Removed getBBox")

# Remove all remaining Nominatim references
for term in ['_addrCache', '_addrQueue', '_addrTimer', '___empty___', 
             'cachedAddress(', 'coordAddress(', 'enqueueAddress(', 
             'updateAddressText(', 'flushQueue(', 'Nominatim']:
    content = content.replace(term, '')
    # Remove entire line if only whitespace left
    lines = content.split('\n')
    cleaned = []
    for l in lines:
        stripped = l.strip()
        if stripped == '' and l.strip() != l:
            continue  # skip whitespace-only
        cleaned.append(l)
    content = '\n'.join(cleaned)

# Remove .p-addr-coord CSS class reference if any
content = content.replace('p-addr-coord', '')

with open('app.js', 'w') as f:
    f.write(content)

print("\n=== All steps complete ===")
