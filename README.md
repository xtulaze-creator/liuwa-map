# 🧒 遛娃地图

一个帮助家长发现周边遛娃好去处的 Web 工具。

## 功能特性

- 📍 **自动定位**：获取当前位置，展示周边遛娃地点
- 🌤️ **实时天气**：显示当前天气，智能推荐适合的活动类型
- 🗺️ **地图浏览**：基于高德地图瓦片，支持国内流畅访问
- 🏷️ **分类筛选**：公园绿地、游乐场、博物馆、商场空调、图书馆、动物园六大类
- 📋 **地点列表**：抽屉式列表，按距离排序，一键导航到目标地点
- 📱 **移动适配**：支持手机和桌面端，触摸交互友好

## 数据来源

- **地图**：高德地图瓦片（国内CDN，访问流畅）
- **天气**：[Open-Meteo](https://open-meteo.com/) 免费天气API
- **地点**：[OpenStreetMap Overpass API](https://overpass-api.de/) 开源地理数据

## 使用方法

### 方式一：直接打开

```bash
open index.html
```

> ⚠️ 部分浏览器的安全策略可能限制 `file://` 协议下的地理位置权限，建议使用方式二。

### 方式二：本地服务器

```bash
# Python 3
python3 -m http.server 8080

# 或 Node.js
npx serve .
```

然后打开 http://localhost:8080

### 方式三：VSCode Live Server

安装 Live Server 插件，右键 `index.html` → "Open with Live Server"

## 项目结构

```
liuwa-map/
├── index.html    # 主页面（单文件应用）
└── README.md     # 项目说明
```

## 分类说明

| 分类 | 图标 | 特点 | OSM数据源 |
|------|------|------|-----------|
| 公园绿地 | 🌳 | 户外、自然 | leisure=park, garden, nature_reserve |
| 游乐场 | 🛝 | 户外、儿童设施 | leisure=playground |
| 博物馆 | 🏛️ | 室内、有空调 | tourism=museum, gallery |
| 商场空调 | 🛍️ | 室内、有空调 | shop=mall, building=retail |
| 图书馆 | 📚 | 室内、有空调 | amenity=library |
| 动物园 | 🐼 | 户外、亲子活动 | tourism=zoo, aquarium |

## 技术栈

- [Leaflet.js](https://leafletjs.com/) - 开源地图库
- 高德地图瓦片 - 国内地图渲染
- Open-Meteo API - 天气数据
- OpenStreetMap - 开源地理数据库
