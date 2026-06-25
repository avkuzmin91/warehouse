from __future__ import annotations

from pydantic import BaseModel


class ScanContextDoc(BaseModel):
    doc_type: str  # 'receipt' | 'shipment' | 'dispatch'
    doc_id: str
    doc_number: str
    status: str
    cargo_type: str | None = None   # для shipment: good|defect (подпись «брак»)
    priority_rank: int | None = None
    planned_qty: int | None = None  # сколько этого варианта в документе (для скана товара)
    done_qty: int | None = None     # принято (receipt) / отгружено (shipment, dispatch)


class ScanContextResponse(BaseModel):
    documents: list[ScanContextDoc]
