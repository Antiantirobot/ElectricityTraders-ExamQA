import hashlib
import json
import mimetypes
import os
import sqlite3
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / 'sync_progress.db'
HOST = os.getenv('HOST', '0.0.0.0')
PORT = int(os.getenv('PORT', '8000'))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def password_hash(user_id: str, password: str) -> str:
    raw = f'ETQB::{user_id}::{password}::v1'.encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


def init_db() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            '''
            CREATE TABLE IF NOT EXISTS users (
              user_id TEXT PRIMARY KEY,
              password_hash TEXT NOT NULL,
              created_at TEXT NOT NULL
            )
            '''
        )
        conn.execute(
            '''
            CREATE TABLE IF NOT EXISTS sync_state (
              user_id TEXT PRIMARY KEY,
              state_json TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(user_id) REFERENCES users(user_id)
            )
            '''
        )


def ensure_user(user_id: str, password: str, create_if_missing: bool) -> tuple[bool, str]:
    user_id = user_id.strip()
    if not user_id or not password:
        return False, '账号和密码不能为空'

    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute('SELECT password_hash FROM users WHERE user_id = ?', (user_id,)).fetchone()
        if row is None:
            if not create_if_missing:
                return False, '账号不存在，请先在任意设备上传一次进度完成注册'
            conn.execute(
                'INSERT INTO users(user_id, password_hash, created_at) VALUES (?, ?, ?)',
                (user_id, password_hash(user_id, password), now_iso())
            )
            return True, 'created'

        if row[0] != password_hash(user_id, password):
            return False, '账号或密码错误'

    return True, 'ok'


def read_json_body(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get('Content-Length', '0') or '0')
    raw = handler.rfile.read(length) if length > 0 else b'{}'
    try:
        return json.loads(raw.decode('utf-8'))
    except Exception:
        return {}


def send_json(handler: BaseHTTPRequestHandler, data: dict, status: int = 200):
    payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(payload)))
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Access-Control-Allow-Headers', 'Content-Type')
    handler.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    handler.end_headers()
    handler.wfile.write(payload)


def serve_file(handler: BaseHTTPRequestHandler, rel_path: str):
    safe = rel_path.split('?', 1)[0].split('#', 1)[0].lstrip('/')
    if not safe:
        safe = 'index.html'
    full = (BASE_DIR / safe).resolve()
    if BASE_DIR not in full.parents and full != BASE_DIR:
        send_json(handler, {'ok': False, 'message': '非法路径'}, 403)
        return
    if full.is_dir():
        full = full / 'index.html'
    if not full.exists() or not full.is_file():
        send_json(handler, {'ok': False, 'message': 'Not Found'}, 404)
        return

    ctype, _ = mimetypes.guess_type(str(full))
    if not ctype:
        ctype = 'application/octet-stream'

    data = full.read_bytes()
    handler.send_response(200)
    handler.send_header('Content-Type', f'{ctype}; charset=utf-8' if ctype.startswith('text/') or ctype in {'application/javascript', 'application/json'} else ctype)
    handler.send_header('Content-Length', str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.end_headers()

    def do_GET(self):
        p = urlparse(self.path).path
        if p == '/api/health':
            send_json(self, {'ok': True, 'time': now_iso(), 'db': str(DB_PATH.name)})
            return

        # SPA + 静态资源
        if p == '/' or p == '':
            serve_file(self, 'index.html')
            return
        serve_file(self, p)

    def do_POST(self):
        p = urlparse(self.path).path
        if p == '/api/sync/pull':
            body = read_json_body(self)
            user_id = str(body.get('userId', '')).strip()
            password = str(body.get('password', ''))

            ok, msg = ensure_user(user_id, password, create_if_missing=False)
            if not ok:
                send_json(self, {'ok': False, 'message': msg}, 401)
                return

            with sqlite3.connect(DB_PATH) as conn:
                row = conn.execute('SELECT state_json, updated_at FROM sync_state WHERE user_id = ?', (user_id,)).fetchone()

            if row is None:
                send_json(self, {'ok': True, 'hasData': False, 'state': None, 'updatedAt': None})
                return

            state = json.loads(row[0]) if row[0] else {}
            send_json(self, {'ok': True, 'hasData': True, 'state': state, 'updatedAt': row[1]})
            return

        if p == '/api/sync/push':
            body = read_json_body(self)
            user_id = str(body.get('userId', '')).strip()
            password = str(body.get('password', ''))
            state = body.get('state', {})

            if not isinstance(state, dict):
                send_json(self, {'ok': False, 'message': 'state 格式错误'}, 400)
                return

            ok, msg = ensure_user(user_id, password, create_if_missing=True)
            if not ok:
                send_json(self, {'ok': False, 'message': msg}, 401)
                return

            updated_at = now_iso()
            with sqlite3.connect(DB_PATH) as conn:
                exists = conn.execute('SELECT 1 FROM sync_state WHERE user_id = ?', (user_id,)).fetchone()
                payload = json.dumps(state, ensure_ascii=False)
                if exists:
                    conn.execute('UPDATE sync_state SET state_json = ?, updated_at = ? WHERE user_id = ?', (payload, updated_at, user_id))
                else:
                    conn.execute('INSERT INTO sync_state(user_id, state_json, updated_at) VALUES (?, ?, ?)', (user_id, payload, updated_at))

            send_json(self, {'ok': True, 'updatedAt': updated_at, 'message': 'saved'})
            return

        send_json(self, {'ok': False, 'message': 'Not Found'}, 404)


def main():
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'Listening on http://{HOST}:{PORT}')
    print(f'DB: {DB_PATH}')
    server.serve_forever()


if __name__ == '__main__':
    main()
