#!/usr/bin/env python3
"""Cookie's Top — servidor local + API REST com banco SQLite.

Uso:
    python3 server.py                 # http://127.0.0.1:8000
    python3 server.py --port 8080     # outra porta
    python3 server.py --host 0.0.0.0  # aceitar acesso da rede local

O banco fica em data/cookiestop.db e é criado automaticamente.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import shutil
import sqlite3
import threading
import traceback
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.join(BASE_DIR, "data", "cookiestop.db")

PAYMENTS = ["Dinheiro", "Pix", "Débito", "Crédito"]

DEFAULT_FLAVORS = [
    {"id": "tradicional", "name": "Tradicional", "emoji": "🍪", "price": 0, "cost": 0, "stock": 16, "min": 4},
    {"id": "nutella", "name": "Nutella", "emoji": "🍫", "price": 0, "cost": 0, "stock": 16, "min": 4},
    {"id": "redvelvet", "name": "Red Velvet", "emoji": "🧁", "price": 0, "cost": 0, "stock": 16, "min": 4},
    {"id": "brookie", "name": "Brookie", "emoji": "🥧", "price": 0, "cost": 0, "stock": 16, "min": 4},
    {"id": "sorvete", "name": "Sorvete com Cookie", "emoji": "🍦", "price": 0, "cost": 0, "stock": 16, "min": 4},
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flavors (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    emoji    TEXT NOT NULL,
    price    INTEGER NOT NULL DEFAULT 0,
    cost     INTEGER NOT NULL DEFAULT 0,
    stock    INTEGER NOT NULL DEFAULT 0,
    min      INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales (
    id          TEXT PRIMARY KEY,
    date        TEXT NOT NULL,
    discount    INTEGER NOT NULL DEFAULT 0,
    total       INTEGER NOT NULL DEFAULT 0,
    cost        INTEGER NOT NULL DEFAULT 0,
    profit      INTEGER NOT NULL DEFAULT 0,
    payment     TEXT NOT NULL DEFAULT 'Pix',
    note        TEXT NOT NULL DEFAULT '',
    canceled    INTEGER NOT NULL DEFAULT 0,
    canceled_at TEXT
);

CREATE TABLE IF NOT EXISTS sale_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id    TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    flavor_id  TEXT NOT NULL,
    name       TEXT NOT NULL,
    qty        INTEGER NOT NULL,
    unit_price INTEGER NOT NULL,
    unit_cost  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

CREATE TABLE IF NOT EXISTS movements (
    id        TEXT PRIMARY KEY,
    date      TEXT NOT NULL,
    flavor_id TEXT NOT NULL,
    type      TEXT NOT NULL,
    qty       INTEGER NOT NULL,
    note      TEXT NOT NULL DEFAULT ''
);
"""

DB_LOCK = threading.Lock()


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def to_int(value) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if number != number or number in (float("inf"), float("-inf")):
        return 0
    return int(round(number))


def to_bool(value) -> bool:
    return str(value).lower() in {"1", "true", "yes", "sim"}


def uid(prefix: str) -> str:
    import secrets

    stamp = format(int(datetime.now(timezone.utc).timestamp() * 1000), "x")
    return f"{prefix}-{stamp}-{secrets.token_hex(3)}"


def open_db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 20000")
    return conn


def init_db(db_path: str) -> None:
    directory = os.path.dirname(os.path.abspath(db_path))
    os.makedirs(directory, exist_ok=True)

    conn = open_db(db_path)
    try:
        conn.executescript(SCHEMA)
        conn.execute("PRAGMA journal_mode = WAL")

        count = conn.execute("SELECT COUNT(*) FROM flavors").fetchone()[0]
        if count == 0:
            for position, flavor in enumerate(DEFAULT_FLAVORS):
                conn.execute(
                    "INSERT INTO flavors (id, name, emoji, price, cost, stock, min, position)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        flavor["id"],
                        flavor["name"],
                        flavor["emoji"],
                        flavor["price"],
                        flavor["cost"],
                        flavor["stock"],
                        flavor["min"],
                        position,
                    ),
                )

        defaults = {
            "storeName": "Cookie's Top",
            "createdAt": now_iso(),
            "setupSeen": "0",
            "configured": "0",
        }
        for key, value in defaults.items():
            conn.execute("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", (key, value))

        conn.commit()
    finally:
        conn.close()


def read_state(conn: sqlite3.Connection) -> dict:
    meta = {row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM meta")}

    flavors = []
    for row in conn.execute("SELECT * FROM flavors ORDER BY position, id"):
        flavors.append(
            {
                "id": row["id"],
                "name": row["name"],
                "emoji": row["emoji"],
                "price": row["price"],
                "cost": row["cost"],
                "stock": row["stock"],
                "min": row["min"],
            }
        )

    sales = []
    sales_by_id = {}
    for row in conn.execute("SELECT * FROM sales ORDER BY date, id"):
        sale = {
            "id": row["id"],
            "date": row["date"],
            "items": [],
            "discount": row["discount"],
            "total": row["total"],
            "cost": row["cost"],
            "profit": row["profit"],
            "payment": row["payment"],
            "note": row["note"],
            "canceled": bool(row["canceled"]),
            "canceledAt": row["canceled_at"],
        }
        sales.append(sale)
        sales_by_id[sale["id"]] = sale

    for row in conn.execute("SELECT * FROM sale_items ORDER BY id"):
        sale = sales_by_id.get(row["sale_id"])
        if sale is not None:
            sale["items"].append(
                {
                    "flavorId": row["flavor_id"],
                    "name": row["name"],
                    "qty": row["qty"],
                    "unitPrice": row["unit_price"],
                    "unitCost": row["unit_cost"],
                }
            )

    movements = []
    for row in conn.execute("SELECT * FROM movements ORDER BY date, id"):
        movements.append(
            {
                "id": row["id"],
                "date": row["date"],
                "flavorId": row["flavor_id"],
                "type": row["type"],
                "qty": row["qty"],
                "note": row["note"],
            }
        )

    return {
        "version": 1,
        "storeName": meta.get("storeName") or "Cookie's Top",
        "createdAt": meta.get("createdAt") or now_iso(),
        "setupSeen": to_bool(meta.get("setupSeen")),
        "configured": to_bool(meta.get("configured")),
        "flavors": flavors,
        "sales": sales,
        "movements": movements,
    }


def with_read(db_path: str, callback):
    conn = open_db(db_path)
    try:
        return callback(conn)
    finally:
        conn.close()


def with_write(db_path: str, callback):
    with DB_LOCK:
        conn = open_db(db_path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            result = callback(conn)
            conn.commit()
            return result
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def refresh_configured(conn: sqlite3.Connection) -> None:
    total = conn.execute("SELECT COUNT(*) FROM flavors WHERE price <= 0").fetchone()[0]
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('configured', ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ("0" if total else "1",),
    )


def add_movement(conn: sqlite3.Connection, flavor_id: str, movement_type: str, qty: int, note: str) -> None:
    conn.execute(
        "INSERT INTO movements (id, date, flavor_id, type, qty, note) VALUES (?, ?, ?, ?, ?, ?)",
        (uid("mv"), now_iso(), flavor_id, movement_type, qty, note or ""),
    )


# ---------------------------------------------------------------------------
# Regras de negócio
# ---------------------------------------------------------------------------


def create_sale(conn: sqlite3.Connection, payload: dict) -> dict:
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        raise ApiError("Adicione ao menos um cookie ao pedido.")

    merged: dict[str, int] = {}
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        flavor_id = str(item.get("flavorId") or "")
        if not flavor_id:
            continue
        qty = max(0, int(to_int(item.get("qty"))))
        merged[flavor_id] = merged.get(flavor_id, 0) + qty

    flavors = {row["id"]: row for row in conn.execute("SELECT * FROM flavors")}
    lines = []

    for flavor_id, qty in merged.items():
        if qty < 1:
            continue
        flavor = flavors.get(flavor_id)
        if flavor is None:
            continue
        if flavor["price"] <= 0:
            raise ApiError(f'Defina o preço de "{flavor["name"]}" antes de vender.')
        if qty > flavor["stock"]:
            raise ApiError(
                f"Estoque insuficiente de {flavor['name']}: {flavor['stock']} un. disponíveis."
            )
        lines.append((flavor, qty))

    if not lines:
        raise ApiError("Adicione ao menos um cookie ao pedido.")

    sale_items = []
    subtotal = 0
    cost = 0
    for flavor, qty in lines:
        unit_price = int(flavor["price"])
        unit_cost = int(flavor["cost"])
        subtotal += unit_price * qty
        cost += unit_cost * qty
        sale_items.append(
            {
                "flavorId": flavor["id"],
                "name": flavor["name"],
                "qty": qty,
                "unitPrice": unit_price,
                "unitCost": unit_cost,
            }
        )

    discount = min(max(0, to_int(payload.get("discount"))), subtotal)
    total = subtotal - discount
    profit = total - cost

    payment = payload.get("payment")
    if payment not in PAYMENTS:
        payment = "Pix"

    sale_id = uid("sale")
    sale_date = now_iso()

    conn.execute(
        "INSERT INTO sales (id, date, discount, total, cost, profit, payment, note)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (sale_id, sale_date, discount, total, cost, profit, payment, str(payload.get("note") or "")),
    )

    for item in sale_items:
        conn.execute(
            "INSERT INTO sale_items (sale_id, flavor_id, name, qty, unit_price, unit_cost)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                sale_id,
                item["flavorId"],
                item["name"],
                item["qty"],
                item["unitPrice"],
                item["unitCost"],
            ),
        )
        conn.execute(
            "UPDATE flavors SET stock = stock - ? WHERE id = ?",
            (item["qty"], item["flavorId"]),
        )
        add_movement(conn, item["flavorId"], "venda", -item["qty"], f"Venda de {item['qty']} un.")

    return {
        "id": sale_id,
        "date": sale_date,
        "items": sale_items,
        "discount": discount,
        "total": total,
        "cost": cost,
        "profit": profit,
        "payment": payment,
        "note": str(payload.get("note") or ""),
        "canceled": False,
        "canceledAt": None,
    }


def cancel_sale(conn: sqlite3.Connection, sale_id: str) -> dict:
    sale = conn.execute("SELECT * FROM sales WHERE id = ?", (sale_id,)).fetchone()
    if sale is None:
        raise ApiError("Venda não encontrada.", HTTPStatus.NOT_FOUND)
    if sale["canceled"]:
        raise ApiError("Esta venda já foi cancelada.")

    items = conn.execute("SELECT * FROM sale_items WHERE sale_id = ?", (sale_id,)).fetchall()
    canceled_at = now_iso()

    for item in items:
        conn.execute(
            "UPDATE flavors SET stock = stock + ? WHERE id = ?",
            (item["qty"], item["flavor_id"]),
        )
        add_movement(conn, item["flavor_id"], "cancelamento", item["qty"], "Cancelamento de venda")

    conn.execute(
        "UPDATE sales SET canceled = 1, canceled_at = ? WHERE id = ?",
        (canceled_at, sale_id),
    )

    result = dict(sale)
    result["canceled"] = True
    result["canceledAt"] = canceled_at
    result.pop("canceled_at", None)
    return result


def add_stock(conn: sqlite3.Connection, flavor_id: str, payload: dict) -> None:
    flavor = conn.execute("SELECT * FROM flavors WHERE id = ?", (flavor_id,)).fetchone()
    if flavor is None:
        raise ApiError("Sabor não encontrado.", HTTPStatus.NOT_FOUND)

    amount = int(to_int(payload.get("qty")))
    if amount < 1:
        raise ApiError("Informe uma quantidade igual ou maior que 1.")

    conn.execute("UPDATE flavors SET stock = stock + ? WHERE id = ?", (amount, flavor_id))
    add_movement(conn, flavor_id, "entrada", amount, str(payload.get("note") or "Entrada de estoque"))


def set_stock(conn: sqlite3.Connection, flavor_id: str, payload: dict) -> None:
    flavor = conn.execute("SELECT * FROM flavors WHERE id = ?", (flavor_id,)).fetchone()
    if flavor is None:
        raise ApiError("Sabor não encontrado.", HTTPStatus.NOT_FOUND)

    amount = int(to_int(payload.get("qty")))
    if amount < 0:
        raise ApiError("Informe uma quantidade válida.")

    diff = amount - int(flavor["stock"])
    if diff == 0:
        raise ApiError("O estoque já está nessa quantidade.")

    conn.execute("UPDATE flavors SET stock = ? WHERE id = ?", (amount, flavor_id))
    add_movement(conn, flavor_id, "ajuste", diff, str(payload.get("note") or "Ajuste manual de estoque"))


def apply_flavor_patch(conn: sqlite3.Connection, flavor_id: str, patch: dict) -> None:
    flavor = conn.execute("SELECT * FROM flavors WHERE id = ?", (flavor_id,)).fetchone()
    if flavor is None:
        return

    name = flavor["name"]
    emoji = flavor["emoji"]
    price = int(flavor["price"])
    cost = int(flavor["cost"])
    minimum = int(flavor["min"])

    if patch.get("name") is not None:
        candidate = str(patch.get("name")).strip()
        if candidate:
            name = candidate
    if patch.get("emoji") is not None:
        candidate = str(patch.get("emoji")).strip()
        if candidate:
            emoji = candidate[:4]
    if patch.get("price") is not None:
        price = max(0, to_int(patch.get("price")))
    if patch.get("cost") is not None:
        cost = max(0, to_int(patch.get("cost")))
    if patch.get("min") is not None:
        minimum = max(0, to_int(patch.get("min")))

    conn.execute(
        "UPDATE flavors SET name = ?, emoji = ?, price = ?, cost = ?, min = ? WHERE id = ?",
        (name, emoji, price, cost, minimum, flavor_id),
    )


def update_flavors(conn: sqlite3.Connection, entries) -> None:
    if not isinstance(entries, list):
        raise ApiError("Lista de sabores inválida.")
    for entry in entries:
        if isinstance(entry, dict) and entry.get("id"):
            apply_flavor_patch(conn, str(entry["id"]), entry)
    refresh_configured(conn)


def update_settings(conn: sqlite3.Connection, payload: dict) -> None:
    if payload.get("storeName") is not None:
        name = str(payload.get("storeName")).strip()
        if name:
            conn.execute(
                "INSERT INTO meta (key, value) VALUES ('storeName', ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (name,),
            )


def set_setup_seen(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('setupSeen', '1')"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )


def import_state(conn: sqlite3.Connection, payload: dict) -> None:
    if not isinstance(payload, dict) or not isinstance(payload.get("flavors"), list):
        raise ApiError("Este arquivo não parece ser um backup da Cookie's Top.")

    incoming_flavors = {}
    for flavor in payload["flavors"]:
        if isinstance(flavor, dict) and flavor.get("id"):
            incoming_flavors[str(flavor["id"])] = flavor

    conn.execute("DELETE FROM sale_items")
    conn.execute("DELETE FROM sales")
    conn.execute("DELETE FROM movements")
    conn.execute("DELETE FROM flavors")
    conn.execute("DELETE FROM meta")

    for position, default in enumerate(DEFAULT_FLAVORS):
        found = incoming_flavors.get(default["id"]) or {}
        name = str(found.get("name") or default["name"]).strip() or default["name"]
        emoji = str(found.get("emoji") or default["emoji"]).strip()[:4] or default["emoji"]
        conn.execute(
            "INSERT INTO flavors (id, name, emoji, price, cost, stock, min, position)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                default["id"],
                name,
                emoji,
                max(0, to_int(found.get("price"))),
                max(0, to_int(found.get("cost"))),
                max(0, to_int(found.get("stock"))),
                max(0, to_int(found.get("min"))),
                position,
            ),
        )

    store_name = str(payload.get("storeName") or "Cookie's Top").strip() or "Cookie's Top"
    created_at = str(payload.get("createdAt") or now_iso())
    meta = {
        "storeName": store_name,
        "createdAt": created_at,
        "setupSeen": "1" if payload.get("setupSeen") else "0",
    }
    for key, value in meta.items():
        conn.execute("INSERT INTO meta (key, value) VALUES (?, ?)", (key, value))

    sales = payload.get("sales")
    if isinstance(sales, list):
        for raw_sale in sales:
            if not isinstance(raw_sale, dict) or not raw_sale.get("id"):
                continue
            if not isinstance(raw_sale.get("items"), list):
                continue
            sale_id = str(raw_sale["id"])
            payment = raw_sale.get("payment") if raw_sale.get("payment") in PAYMENTS else "Pix"
            conn.execute(
                "INSERT OR REPLACE INTO sales"
                " (id, date, discount, total, cost, profit, payment, note, canceled, canceled_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    sale_id,
                    str(raw_sale.get("date") or now_iso()),
                    max(0, to_int(raw_sale.get("discount"))),
                    to_int(raw_sale.get("total")),
                    to_int(raw_sale.get("cost")),
                    to_int(raw_sale.get("profit")),
                    payment,
                    str(raw_sale.get("note") or ""),
                    1 if raw_sale.get("canceled") else 0,
                    raw_sale.get("canceledAt"),
                ),
            )
            for item in raw_sale["items"]:
                if not isinstance(item, dict):
                    continue
                conn.execute(
                    "INSERT INTO sale_items (sale_id, flavor_id, name, qty, unit_price, unit_cost)"
                    " VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        sale_id,
                        str(item.get("flavorId") or ""),
                        str(item.get("name") or ""),
                        max(0, to_int(item.get("qty"))),
                        max(0, to_int(item.get("unitPrice"))),
                        max(0, to_int(item.get("unitCost"))),
                    ),
                )

    movements = payload.get("movements")
    if isinstance(movements, list):
        for movement in movements:
            if not isinstance(movement, dict) or not movement.get("id"):
                continue
            conn.execute(
                "INSERT OR REPLACE INTO movements (id, date, flavor_id, type, qty, note)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (
                    str(movement["id"]),
                    str(movement.get("date") or now_iso()),
                    str(movement.get("flavorId") or ""),
                    str(movement.get("type") or "ajuste"),
                    to_int(movement.get("qty")),
                    str(movement.get("note") or ""),
                ),
            )

    refresh_configured(conn)


def reset_all(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM sale_items")
    conn.execute("DELETE FROM sales")
    conn.execute("DELETE FROM movements")
    conn.execute("DELETE FROM flavors")
    conn.execute("DELETE FROM meta")

    for position, flavor in enumerate(DEFAULT_FLAVORS):
        conn.execute(
            "INSERT INTO flavors (id, name, emoji, price, cost, stock, min, position)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                flavor["id"],
                flavor["name"],
                flavor["emoji"],
                flavor["price"],
                flavor["cost"],
                flavor["stock"],
                flavor["min"],
                position,
            ),
        )

    for key, value in {
        "storeName": "Cookie's Top",
        "createdAt": now_iso(),
        "setupSeen": "0",
        "configured": "0",
    }.items():
        conn.execute("INSERT INTO meta (key, value) VALUES (?, ?)", (key, value))


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    server_version = "CookiesTop/2.0"
    db_path = DEFAULT_DB

    # -- respostas ----------------------------------------------------------

    def send_json(self, payload: dict, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_api_error(self, error: ApiError) -> None:
        self.send_json({"ok": False, "error": error.message}, error.status)

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        if length > 8 * 1024 * 1024:
            raise ApiError("Requisição muito grande.", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        raw = self.rfile.read(length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError("JSON inválido.")
        if not isinstance(parsed, dict):
            raise ApiError("O corpo da requisição deve ser um objeto JSON.")
        return parsed

    def log_message(self, fmt: str, *args) -> None:
        # Mantém o terminal limpo: mostra só erros 5xx.
        try:
            status = int(args[1]) if len(args) > 1 else 0
        except (TypeError, ValueError):
            status = 0
        if status >= 500:
            super().log_message(fmt, *args)

    # -- estáticos ----------------------------------------------------------

    def serve_static(self, path: str) -> None:
        if path in ("", "/"):
            path = "/index.html"

        relative = unquote(path.lstrip("/"))
        first_part = relative.split("/", 1)[0]
        blocked = (
            first_part in {"data", "__pycache__"}
            or relative.endswith((".py", ".db", ".db-wal", ".db-shm", ".pyc"))
            or any(part.startswith(".") for part in relative.split("/"))
        )
        if blocked:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        target = os.path.abspath(os.path.join(BASE_DIR, relative))
        try:
            if os.path.commonpath([BASE_DIR, target]) != BASE_DIR:
                self.send_error(HTTPStatus.FORBIDDEN)
                return
        except ValueError:
            self.send_error(HTTPStatus.FORBIDDEN)
            return

        if os.path.isdir(target):
            target = os.path.join(target, "index.html")
        if not os.path.isfile(target):
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_type = mimetypes.guess_type(target)[0] or "application/octet-stream"
        if target.endswith(".js"):
            content_type = "text/javascript; charset=utf-8"
        elif target.endswith(".css"):
            content_type = "text/css; charset=utf-8"
        elif target.endswith(".html"):
            content_type = "text/html; charset=utf-8"
        elif target.endswith(".svg"):
            content_type = "image/svg+xml"
        elif target.endswith(".json"):
            content_type = "application/json; charset=utf-8"

        size = os.path.getsize(target)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            with open(target, "rb") as handle:
                shutil.copyfileobj(handle, self.wfile)

    # -- API ----------------------------------------------------------------

    def handle_api(self, method: str, path: str) -> None:
        if method == "GET" and path == "/api/health":
            self.send_json({"ok": True, "database": os.path.basename(self.db_path)})
            return

        if method == "GET" and path == "/api/state":
            state = with_read(self.db_path, read_state)
            self.send_json({"ok": True, "state": state})
            return

        if method == "GET" and path == "/api/backup":
            state = with_read(self.db_path, read_state)
            self.send_json({"ok": True, "state": state})
            return

        if method == "POST" and path == "/api/sales":
            payload = self.read_json()
            sale = with_write(self.db_path, lambda conn: create_sale(conn, payload))
            state = with_read(self.db_path, read_state)
            self.send_json({"ok": True, "sale": sale, "state": state}, HTTPStatus.CREATED)
            return

        match = re.fullmatch(r"/api/sales/([^/]+)/cancel", path)
        if method == "POST" and match:
            sale_id = unquote(match.group(1))
            sale = with_write(self.db_path, lambda conn: cancel_sale(conn, sale_id))
            state = with_read(self.db_path, read_state)
            self.send_json({"ok": True, "sale": sale, "state": state})
            return

        match = re.fullmatch(r"/api/flavors/([^/]+)/stock", path)
        if match and method in {"POST", "PUT"}:
            flavor_id = unquote(match.group(1))
            payload = self.read_json()
            if method == "POST":
                with_write(self.db_path, lambda conn: add_stock(conn, flavor_id, payload))
            else:
                with_write(self.db_path, lambda conn: set_stock(conn, flavor_id, payload))
            state = with_read(self.db_path, read_state)
            self.send_json({"ok": True, "state": state})
            return

        match = re.fullmatch(r"/api/flavors/([^/]+)", path)
        if match and method == "PATCH":
            flavor_id = unquote(match.group(1))
            payload = self.read_json()
            with_write(self.db_path, lambda conn: update_flavors(conn, [dict(payload, id=flavor_id)]))
            state = with_read(self.db_path, read_state)
            self.send_json({"ok": True, "state": state})
            return

        if path == "/api/flavors" and method == "PUT":
            payload = self.read_json()
            with_write(self.db_path, lambda conn: update_flavors(conn, payload.get("flavors")))
            state = with_read(self.db_path, read_state)
            self.send_json({"ok": True, "state": state})
            return

        if path == "/api/settings" and method == "PATCH":
            payload = self.read_json()
            with_write(self.db_path, lambda conn: update_settings(conn, payload))
            state = with_read(self.db_path, read_state)
            self.send_json({"ok": True, "state": state})
            return

        if path == "/api/setup-seen" and method == "POST":
            with_write(self.db_path, set_setup_seen)
            state = with_read(self.db_path, read_state)
            self.send_json({"ok": True, "state": state})
            return

        if path == "/api/import" and method == "POST":
            payload = self.read_json()
            with_write(self.db_path, lambda conn: import_state(conn, payload))
            state = with_read(self.db_path, read_state)
            self.send_json({"ok": True, "state": state})
            return

        if path == "/api/reset" and method == "POST":
            with_write(self.db_path, reset_all)
            state = with_read(self.db_path, read_state)
            self.send_json({"ok": True, "state": state})
            return

        raise ApiError("Rota não encontrada.", HTTPStatus.NOT_FOUND)

    # -- verbos -------------------------------------------------------------

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        try:
            if path.startswith("/api/"):
                self.handle_api("GET", path)
            else:
                self.serve_static(path)
        except ApiError as error:
            self.send_api_error(error)
        except BrokenPipeError:
            pass
        except Exception:
            traceback.print_exc()
            self.send_json(
                {"ok": False, "error": "Erro interno do servidor."},
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_POST(self) -> None:
        self.dispatch("POST")

    def do_PUT(self) -> None:
        self.dispatch("PUT")

    def do_PATCH(self) -> None:
        self.dispatch("PATCH")

    def do_DELETE(self) -> None:
        self.dispatch("DELETE")

    def dispatch(self, method: str) -> None:
        path = urlparse(self.path).path
        try:
            if not path.startswith("/api/"):
                raise ApiError("Rota não encontrada.", HTTPStatus.NOT_FOUND)
            self.handle_api(method, path)
        except ApiError as error:
            self.send_api_error(error)
        except BrokenPipeError:
            pass
        except Exception:
            traceback.print_exc()
            self.send_json(
                {"ok": False, "error": "Erro interno do servidor."},
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )


def main() -> None:
    parser = argparse.ArgumentParser(description="Cookie's Top — servidor local com SQLite")
    parser.add_argument("--host", default="127.0.0.1", help="endereço de escuta (padrão: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="porta HTTP (padrão: 8000)")
    parser.add_argument("--db", default=DEFAULT_DB, help="caminho do arquivo SQLite")
    args = parser.parse_args()

    db_path = os.path.abspath(args.db)
    init_db(db_path)
    Handler.db_path = db_path

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True

    host = "localhost" if args.host in {"127.0.0.1", "0.0.0.0"} else args.host
    print("🍪  Cookie's Top")
    print(f"    Painel: http://{host}:{args.port}")
    print(f"    Banco:  {db_path}")
    print("    Ctrl+C para parar.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
