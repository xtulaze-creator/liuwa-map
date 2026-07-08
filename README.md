# 🧒 遛娃地图

一个帮助家长发现周边遛娃好去处的 Web 工具。

## 功能特性

- 📍 **自动定位**：获取当前位置，展示周边遛娃地点
- 🌤️ **实时天气**：显示当前天气，智能推荐适合的活动类型（晴/雨/高温等）
- 🗺️ **地图浏览**：基于高德地图瓦片，支持国内流畅访问
- 🏷️ **分类筛选**：公园绿地、游乐场、博物馆、商场空调、图书馆、动物园六大类
- 📋 **地点列表**：抽屉式列表，按距离排序，点击跳转地图
- 📱 **移动适配**：支持手机和桌面端，触摸交互友好
- 🔄 **智能重试**：首次搜索无结果时自动扩大范围重试
- 🛡️ **离线兜底**：API 不可用时自动使用演示数据

## 数据来源

- **地图**：高德地图瓦片（国内CDN，访问流畅）
- **天气**：[Open-Meteo](https://open-meteo.com/) 免费天气API
- **地点**：[OpenStreetMap Overpass API](https://overpass-api.de/) 开源地理数据

## 项目结构

```
liuwa-map/
├── index.html    # 主页面（HTML 结构）
├── style.css     # 样式表（独立文件）
├── app.js        # 应用逻辑（独立文件）
├── proxy.py      # 本地代理服务器，解决 CORS 问题
├── screenshot.png
└── README.md
```

## 使用方法

### 方式一：代理服务器（推荐）

启动代理后，可通过 `/api/overpass` 代理请求，避免跨域问题：

```bash
python3 proxy.py 8080
```

然后打开 http://localhost:8080

### 方式二：直接 HTTP 服务器

```bash
# Python 3
python3 -m http.server 8080

# 或 Node.js
npx serve .
```

然后打开 http://localhost:8080

### 方式三：直接打开文件

```bash
open index.html
```

> ⚠️ `file://` 协议下部分浏览器可能限制地理位置权限和跨域请求。

## 分类说明

| 分类 | 图标 | 特点 | OSM数据源 |
|------|------|------|-----------|
| 公园绿地 | 🌳 | 户外、自然 | `leisure=park` `leisure=garden` `leisure=nature_reserve` |
| 游乐场 | 🛝 | 户外、儿童设施 | `leisure=playground` |
| 博物馆 | 🏛️ | 室内、有空调 | `tourism=museum` `tourism=gallery` |
| 商场空调 | 🛍️ | 室内、有空调 | `shop=mall` `building=retail` `landuse=retail` |
| 图书馆 | 📚 | 室内、有空调 | `amenity=library` |
| 动物园 | 🐼 | 户外、亲子活动 | `tourism=zoo` `tourism=aquarium` |

## 天气智能推荐

应用会根据天气状况给出遛娃建议：
- ☀️ 晴天高温（>30°C）→ 推荐室内（商场/博物馆/图书馆）
- ☀️ 晴天舒适 → 推荐户外活动
- 🌧️ 雨天 → 建议室内场所
- ⛈️ 雷暴 → 建议居家

## 技术栈

- [Leaflet.js](https://leafletjs.com/) - 开源地图库
- 高德地图瓦片 - 国内地图渲染
- Open-Meteo API - 天气数据
- OpenStreetMap / Overpass API - 开源地理数据库
