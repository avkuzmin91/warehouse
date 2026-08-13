"""Порядок списка задач упаковки: недатированный черновик не тонет в хвосте."""
from __future__ import annotations

import os
import uuid

import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("Нужен DATABASE_URL", allow_module_level=True)

from tests.conftest import make_client_id, cleanup_client


@pytest.fixture
def client_id():
    cid = make_client_id()
    yield cid
    cleanup_client(cid)


def _payload(cid: str, ship_date: str | None) -> dict:
    return {
        "cargo_type": "good",
        "client_id": cid,
        "client_name": "Test Client",
        "destination": "Moscow",
        "ship_date": ship_date,
        "comment": "ТЗ",
        "lines": [{
            "product_id": str(uuid.uuid4()),
            "product_name": "Order Product",
            "product_sku": "ORD-001",
            "color_id": None, "color_name": None,
            "size_id": None, "size_name": None,
            "qty": 5,
        }],
    }


def test_undated_draft_is_listed_above_older_dated_docs(admin_client, client_id):
    dated = admin_client.post("/shipments", json=_payload(client_id, "2020-02-01"))
    assert dated.status_code == 200, dated.text
    draft = admin_client.post("/shipments", json=_payload(client_id, None))
    assert draft.status_code == 200, draft.text

    r = admin_client.get("/shipments", params={"client_id": client_id})
    assert r.status_code == 200, r.text
    ids = [item["id"] for item in r.json()["items"]]
    assert ids.index(draft.json()["message"]) < ids.index(dated.json()["message"])


def test_undated_draft_lines_listed_above_older_dated_docs(admin_client, client_id):
    dated = admin_client.post("/shipments", json=_payload(client_id, "2020-02-01"))
    draft = admin_client.post("/shipments", json=_payload(client_id, None))

    r = admin_client.get("/shipments/lines", params={"client_id": client_id})
    assert r.status_code == 200, r.text
    doc_ids = [item["doc_id"] for item in r.json()["items"]]
    assert doc_ids.index(draft.json()["message"]) < doc_ids.index(dated.json()["message"])
