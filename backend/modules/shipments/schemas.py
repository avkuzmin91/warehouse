from __future__ import annotations

from pydantic import BaseModel, Field


class ShipmentLineIn(BaseModel):
    product_id:        str
    product_name:      str
    product_sku:       str
    color_id:          str | None = None
    color_name:        str | None = None
    size_id:           str | None = None
    size_name:         str | None = None
    qty:               int = Field(ge=1)
    shipped_qty:       int = Field(ge=0, default=0)
    storage_zone_id:   str | None = None
    storage_zone_name: str | None = None
    store_id:          str | None = None
    store_name:        str | None = None


class ShipmentLineStoreUpdate(BaseModel):
    # None / пустая строка — «без магазина».
    store_id: str | None = None


class ShipmentLinePackPayload(BaseModel):
    good_delta:   int = Field(ge=0, default=0)
    defect_delta: int = Field(ge=0, default=0)
    packed_date:  str  # YYYY-MM-DD — бизнес-дата упаковки


class ShipmentPackingEntry(BaseModel):
    id:               str
    packed_date:      str | None = None
    good:             int
    defect:           int
    created_at:       str
    created_by:       str | None = None
    created_by_email: str | None = None
    # 'free' | 'paid' — запись сделана в режиме переупаковки; None — обычная упаковка.
    repack_kind:      str | None = None
    reversed:         bool = False


class ShipmentPackingResponse(BaseModel):
    plan:               int
    available_for_pack: int
    packed_good:        int
    packed_defect:      int
    entries:            list[ShipmentPackingEntry]


class ShipmentPackingProductivityRow(BaseModel):
    client_id:    str | None = None
    client_name:  str | None = None
    product_id:   str
    product_sku:  str | None = None
    product_name: str | None = None
    good:         int
    defect:       int
    total:        int
    good_earn_kop:   int = 0
    defect_earn_kop: int = 0
    earn_kop:        int = 0
    price_missing:   bool = False
    repack_kind:     str | None = None
    doc_ids:         list[str] = []


class ShipmentPackingProductivityDay(BaseModel):
    packed_date: str
    good:        int
    defect:      int
    total:       int
    sku_count:   int
    doc_count:   int
    good_earn_kop:   int = 0
    defect_earn_kop: int = 0
    earn_kop:        int = 0
    rows:        list[ShipmentPackingProductivityRow]


class ShipmentPackingProductivityResponse(BaseModel):
    days:         list[ShipmentPackingProductivityDay]
    total_good:   int
    total_defect: int
    total:        int
    total_good_earn_kop:   int = 0
    total_defect_earn_kop: int = 0
    total_earn_kop:        int = 0
    with_earnings:         bool = False


class ProductivityPackEntry(BaseModel):
    id:               str
    packed_date:      str | None = None
    good:             int
    defect:           int
    created_at:       str
    created_by_email: str | None = None
    doc_id:           str | None = None
    doc_number:       str | None = None
    reversed:         bool = False


class ProductivityEntriesResponse(BaseModel):
    entries: list[ProductivityPackEntry]


class PackingDayLine(BaseModel):
    product_id:    str
    product_sku:   str | None = None
    product_name:  str | None = None
    good:          int
    defect:        int
    total:         int
    earn_kop:      int = 0
    price_missing: bool = False
    repack_kind:   str | None = None


class PackingDayDoc(BaseModel):
    doc_id:        str
    doc_number:    str
    status:        str
    client_id:     str | None = None
    client_name:   str | None = None
    good:          int
    defect:        int
    total:         int
    earn_kop:      int = 0
    price_missing: bool = False
    lines:         list[PackingDayLine]


class PackingDayResponse(BaseModel):
    packed_date:   str
    good:          int
    defect:        int
    total:         int
    earn_kop:      int = 0
    with_earnings: bool = False
    docs:          list[PackingDayDoc]


class PackDateMovePayload(BaseModel):
    entry_ids: list[str] = Field(min_length=1)
    new_date:  str  # YYYY-MM-DD — целевая бизнес-дата упаковки


class ShipmentMoveAllocation(BaseModel):
    from_zone_id: str | None = None
    qty: int = Field(ge=1)


class ShipmentMoveToPackingPayload(BaseModel):
    # Явная разбивка по зонам-источникам. Каждая аллокация — сколько и откуда взять.
    allocations: list[ShipmentMoveAllocation] | None = None
    # Back-compat одиночного перемещения: qty (+ опц. from_zone_id). from_zone_id=None — FIFO по местам.
    qty: int | None = Field(default=None, ge=1)
    from_zone_id: str | None = None

    def to_allocations(self) -> list[ShipmentMoveAllocation]:
        if self.allocations:
            return self.allocations
        if self.qty is not None:
            return [ShipmentMoveAllocation(from_zone_id=self.from_zone_id, qty=self.qty)]
        return []


class ShipmentMassMoveLine(BaseModel):
    line_id:     str
    allocations: list[ShipmentMoveAllocation] = []


class ShipmentMassMoveToPackingPayload(BaseModel):
    lines: list[ShipmentMassMoveLine] = []


class ShipmentReturnFromPackingPayload(BaseModel):
    # None — вернуть весь нерешённый пул строки.
    qty: int | None = Field(default=None, ge=1)


class ShipmentRelocateAllocation(BaseModel):
    zone_id:   str
    zone_name: str | None = None
    qty:       int = Field(ge=1)


class ShipmentRelocateLine(BaseModel):
    line_id: str
    good:    list[ShipmentRelocateAllocation] = []
    defect:  list[ShipmentRelocateAllocation] = []


class ShipmentFinishRelocationPayload(BaseModel):
    lines: list[ShipmentRelocateLine] = []


class ShipmentDefectSourceAllocation(BaseModel):
    zone_id:   str
    zone_name: str | None = None
    qty:       int = Field(ge=1)


class ShipmentDefectRelocateLine(BaseModel):
    line_id: str
    sources: list[ShipmentDefectSourceAllocation] = []


class ShipmentFinishDefectRelocationPayload(BaseModel):
    lines: list[ShipmentDefectRelocateLine] = []


class ShipmentDocCreate(BaseModel):
    cargo_type:      str = "good"
    client_id:       str | None = None
    client_name:     str | None = None
    destination:     str | None = None
    carrier:         str | None = None
    logistics_cost:  float | None = None
    ship_date:       str | None = None
    comment:         str | None = None
    lines:           list[ShipmentLineIn] = []


class ShipmentDocUpdate(BaseModel):
    cargo_type:      str | None = None
    client_id:       str | None = None
    client_name:     str | None = None
    destination:     str | None = None
    carrier:         str | None = None
    logistics_cost:  float | None = None
    ship_date:       str | None = None
    priority_rank:   int | None = Field(default=None, ge=1, le=2)
    actual_ship_date: str | None = None
    comment:         str | None = None


class ShipmentPriorityUpdate(BaseModel):
    priority_rank: int | None = Field(default=None, ge=1, le=2)


class ShipmentReturnToPackingPayload(BaseModel):
    # rework — обычная доработка (текущее поведение return_to_packing);
    # repack_free — переупаковка за наш счёт; repack_paid — за счёт клиента.
    mode:   str = "rework"
    # Причина переупаковки — обязательна для repack_* (валидируется в service).
    reason: str | None = None
    # Только repack_paid: цена переупаковки за единицу в копейках
    # (None — стандартный тариф упаковки) + работы сверх тарифа.
    unit_price_kop:   int | None = Field(default=None, ge=0)
    extra_amount_kop: int | None = Field(default=None, ge=0)
    extra_comment:    str | None = None
    # Осознанный частичный возврат, когда часть товара уже уехала рейсом.
    force:  bool = False


class ShipmentLineFileBarcode(BaseModel):
    code:                str
    status:              str  # confirmed | unknown | other_variant | other_product
    other_product_name:  str | None = None
    other_variant_label: str | None = None


class ShipmentLineFile(BaseModel):
    id:         str
    filename:   str
    url:        str
    mime_type:  str | None = None
    barcodes:   list[str] = []
    # Те же коды с актуальным статусом относительно варианта строки — считается при
    # чтении деталки, чтобы «непривязанные ШК» были видны и после закрытия диалога.
    barcode_details: list[ShipmentLineFileBarcode] = []
    created_at: str


class ShipmentLineFileBindBarcode(BaseModel):
    code: str


class ShipmentLinePlacement(BaseModel):
    kind:      str  # 'good' | 'defect'
    zone_id:   str | None
    zone_name: str | None
    qty:       int


class ShipmentLineItem(BaseModel):
    id:                str
    product_id:        str
    product_name:      str
    product_sku:       str
    sku_pending:       bool = False
    color_id:          str | None
    color_name:        str | None
    size_id:           str | None
    size_name:         str | None
    qty:               int
    shipped_qty:       int
    packed_good:       int = 0
    packed_defect:     int = 0
    # Упаковано, но ещё не размещено по местам (корзина packed). Размещённое в ready
    # частичным «Разместить готовое» сюда не входит — оно уже доступно к отгрузке.
    packed_pending_good:   int = 0
    packed_pending_defect: int = 0
    available_for_pack: int = 0
    storage_zone_id:   str | None
    storage_zone_name: str | None
    store_id:          str | None
    store_name:        str | None
    placements:        list[ShipmentLinePlacement] = []
    files:             list[ShipmentLineFile] = []


class ShipmentListItem(BaseModel):
    id:           str
    doc_number:   str
    cargo_type:   str
    client_id:    str | None
    client_name:  str | None
    destination:  str | None
    carrier:      str | None
    logistics_cost: float | None
    ship_date:    str | None
    priority_rank: int | None = None
    status:       str
    status_label: str
    sku_count:    int
    total_qty:    int
    total_shipped_qty: int = 0
    total_packed_qty: int = 0
    total_free_qty: int = 0
    lines_with_shipped_qty: int = 0
    lines_with_packed_qty: int = 0
    lines_with_zone: int = 0
    created_at:   str
    created_by_name: str | None = None


class ShipmentListResponse(BaseModel):
    items: list[ShipmentListItem]
    total: int
    page:  int
    limit: int


class ShipmentLinesListItem(BaseModel):
    line_id:           str
    doc_id:            str
    doc_number:        str
    cargo_type:        str
    client_id:         str | None
    client_name:       str | None
    destination:       str | None
    ship_date:         str | None
    status:            str
    status_label:      str
    product_id:        str
    product_name:      str
    product_sku:       str
    color_name:        str | None
    size_name:         str | None
    qty:               int
    shipped_qty:       int
    packed_good:       int = 0
    storage_zone_name: str | None
    store_name:        str | None


class ShipmentLinesResponse(BaseModel):
    items: list[ShipmentLinesListItem]
    total: int
    page:  int
    limit: int


class ShipmentOpItem(BaseModel):
    id:               str
    op_type:          str
    comment:          str | None
    created_at:       str
    created_by:       str | None
    created_by_email: str | None


class ShipmentDetailResponse(BaseModel):
    id:           str
    doc_number:   str
    cargo_type:   str
    client_id:    str | None
    client_name:  str | None
    destination:  str | None
    carrier:      str | None
    logistics_cost: float | None
    ship_date:    str | None
    priority_rank: int | None = None
    actual_ship_date: str | None = None
    comment:      str | None
    status:       str
    status_label: str
    # Переупаковка (задача была поставлена с ошибкой): kind 'free'|'paid' остаётся
    # после завершения (бейдж «была переупакована»), active=true — пока пакуют заново.
    # Денежные поля (цена/доп. работы) отдаются только ролям, видящим стоимости.
    repack_kind:   str | None = None
    repack_reason: str | None = None
    repack_active: bool = False
    repack_price_kop:        int | None = None
    repack_extra_amount_kop: int | None = None
    repack_extra_comment:    str | None = None
    created_at:   str
    created_by:   str | None
    created_by_name: str | None = None
    updated_at:   str | None
    lines:        list[ShipmentLineItem]
    ops:          list[ShipmentOpItem]
    sku_count:    int
    total_qty:    int


class ShipmentDuplicateCheckLine(BaseModel):
    product_id: str
    color_id:   str | None = None
    size_id:    str | None = None
    qty:        int = Field(ge=1)


class ShipmentDuplicateCheck(BaseModel):
    cargo_type: str = "good"
    client_id:  str | None = None
    ship_date:  str | None = None
    lines:      list[ShipmentDuplicateCheckLine] = []


class DuplicateMatchLine(BaseModel):
    product_sku:  str | None = None
    product_name: str | None = None
    color_name:   str | None = None
    size_name:    str | None = None
    qty:          int


class DuplicateMatch(BaseModel):
    id:              str
    doc_number:      str
    status:          str
    status_label:    str
    created_at:      str
    created_by_name: str | None = None
    lines:           list[DuplicateMatchLine] = []


class DuplicateCheckResponse(BaseModel):
    matches: list[DuplicateMatch] = []


class LineFileFromProduct(BaseModel):
    """Прикрепление этикетки из карточки товара к строке задачи."""

    product_file_id: str
