"""Simple HTTP server that also proxies Overpass API requests to avoid CORS issues."""
import http.server
import urllib.request
import urllib.parse
import json
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9999
ROOT = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        if self.path == '/api/overpass':
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length).decode('utf-8')
                data = urllib.parse.unquote(body)
                if data.startswith('data='):
                    data = data[5:]

                # Try Overpass endpoints
                endpoints = [
                    'https://overpass-api.de/api/interpreter',
                    'https://overpass.kumi.systems/api/interpreter',
                ]
                result = None
                last_err = None
                for url in endpoints:
                    try:
                        req = urllib.request.Request(url, data=body.encode('utf-8'), headers={
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'User-Agent': 'LiuwaMap/1.0',
                        })
                        with urllib.request.urlopen(req, timeout=20) as resp:
                            result = resp.read()
                            break
                    except Exception as e:
                        last_err = e
                        continue

                if result is not None:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(result)
                else:
                    raise last_err or Exception('All endpoints failed')

            except Exception as e:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': str(e),
                    'elements': [],
                }).encode('utf-8'))
        else:
            super().do_POST()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, format, *args):
        # Only log non-static-file requests
        if self.path.startswith('/api/'):
            print(f'  [{self.command}] {self.path}')

print(f'🧒 遛娃地图服务启动: http://localhost:{PORT}')
print(f'   静态文件: {ROOT}')
print(f'   API代理: /api/overpass')
http.server.HTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
