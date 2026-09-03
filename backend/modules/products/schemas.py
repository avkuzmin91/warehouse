from __future__ import annotations

from pydantic import BaseModel, Field


class ProductItem(BaseModel):
    id: str
    name: str
    type_id: str
    type_name: str | None = None
    sku_base: str
    sku_pending: bool = False
    weight_grams: int | None = None
    items_per_box: int | None = None
    boxes_per_pallet: int | None = None
    requires_color: bool = False
    requires_size: bool = False
    client_id: str | None = None
    client_name: str | None = None
    variant_count: int = 0
    stock_total: int = 0
    defect_total: int = 0
    is_active: bool
    is_deleted: bool = False
    deleted_at: str | None = None
    deleted_by: str | None = None
    image_urls: list[str] = Field(default_factory=list)
    created_at: str
    created_by: str | None = None
    updated_at: str | None = None
    updated_by: str | None = None


class ProductCreateDimensionBlock(BaseModel):
    length: float = Field(ge=0)
    width: float = Field(ge=0)
    height: float = Field(ge=0)
    sizes: list[str] = Field(default_factory=list)


class ProductCreateInner(BaseModel):
    name: str = Field(min_length=1)
    type_id: str = Field(min_length=1)
    sku_base: str | None = Field(default=None)
    sku_pending: bool = False
    client_id: str = Field(min_length=1)
    weight_grams: int | None = Field(default=None, ge=0)
    items_per_box: int | None = Field(default=None, ge=0)
    boxes_per_pallet: int | None = Field(default=None, ge=0)
    is_active: bool = True
    # Первичный тариф упаковки (удобный ввод при заведении; источник истины — справочник
    # «Финансы → Стоимость упаковки»). Пишется записью с effective_from = сегодня.
    packing_price_good_kop: int | None = Field(default=None, ge=0)
    packing_price_defect_kop: int | None = Field(default=None, ge=0)


class ProductCreateMeta(BaseModel):
    product: ProductCreateInner
    colors: list[str] = Field(default_factory=list)
    dimensions: list[ProductCreateDimensionBlock] = Field(min_length=1)


class ProductUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    type_id: str | None = None
    client_id: str | None = None
    is_active: bool | None = None
    is_deleted: bool | None = None
    sku_base: str | None = Field(default=None, min_length=1)
    sku_pending: bool | None = None
    weight_grams: int | None = Field(default=None, ge=0)
    items_per_box: int | None = Field(default=None, ge=0)
    boxes_per_pallet: int | None = Field(default=None, ge=0)
    image_urls: list[str] | None = None


class ProductVariantDimension(BaseModel):
    length: float = Field(ge=0)
    width: float = Field(ge=0)
    height: float = Field(ge=0)


class ProductBarcodeFileItem(BaseModel):
    id: str
    filename: str
    url: str
    mime_type: str | None = None


class ProductBarcodeItem(BaseModel):
    id: str
    barcode: str
    source: str | None = None
    files: list[ProductBarcodeFileItem] = Field(default_factory=list)


class ProductFileItem(BaseModel):
    """Этикетка из карточки товара для выбора в документах (плоский список).

    Код принадлежит варианту — цвет/размер нужны, чтобы предлагать строке
    документа только этикетки её варианта."""

    id: str
    barcode: str
    variant_id: str | None = None
    color_id: str | None = None
    size_id: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    filename: str
    url: str
    mime_type: str | None = None


class ProductVariantItem(BaseModel):
    id: str
    color_id: str | None
    color_name: str | None = None
    dimension: ProductVariantDimension
    size_id: str | None = None
    size_name: str | None = None
    sku: str
    barcodes: list[ProductBarcodeItem] = Field(default_factory=list)
    images: list[str] = Field(default_factory=list)
    is_active: bool
    stock: int = 0
    defect_qty: int = 0
    has_receipts: bool = False


class ProductBarcodeAdd(BaseModel):
    barcode: str = Field(min_length=1)
    source: str | None = None
    # Вариант обязателен по смыслу; None допустим только для товара с единственным
    # живым вариантом (привязка из упаковки, где вариант уже вычислен строкой).
    variant_id: str | None = None


class ProductVariantDeletePatchRequest(BaseModel):
    is_deleted: bool


class ProductVariantWriteItem(BaseModel):
    id: str | None = None
    sku: str | None = None
    color_id: str | None = None
    dimension: ProductVariantDimension
    size_id: str | None = None
    images: list[str] = Field(default_factory=list)
    is_active: bool = True


class ProductVariantsPatchRequest(BaseModel):
    variants: list[ProductVariantWriteItem]


class VariantIdentityChangeRequest(BaseModel):
    color_id: str | None = None
    size_id: str | None = None
    sku: str | None = None


class ProductVariantFindItem(BaseModel):
    variant_id: str
    product_id: str
    product_name: str
    product_type_name: str | None = None
    client_name: str | None = None
    requires_size: bool
    sku: str
    color_id: str | None
    size_id: str | None
    length: float
    width: float
    height: float
    first_image_url: str | None = None


class ProductVariantFindResponse(BaseModel):
    found: bool
    variant: ProductVariantFindItem | None = None
    needs_size: bool = False


class BarcodeMatch(BaseModel):
    variant_id: str
    product_id: str
    product_name: str
    sku: str
    color_id: str | None = None
    color_name: str | None = None
    size_id: str | None = None
    size_name: str | None = None
    client_id: str | None = None
    client_name: str | None = None


class BarcodeLookupResponse(BaseModel):
    found: bool
    match: BarcodeMatch | None = None


class ProductListResponse(BaseModel):
    items: list[ProductItem]
    total: int
    page: int
    limit: int


class ProductUploadImageResponse(BaseModel):
    url: str


class MessageResponse(BaseModel):
    message: str


class ProductImportRowItem(BaseModel):
    row_no: int
    sku: str = ""
    name: str = ""
    type_name: str = ""
    color_name: str = ""
    size_name: str = ""
    variant_sku: str = ""
    action: str
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ProductImportSummary(BaseModel):
    rows_total: int = 0
    rows_ok: int = 0
    rows_with_errors: int = 0
    rows_with_warnings: int = 0
    products_new: int = 0
    products_existing: int = 0
    variants_new: int = 0
    variants_skipped: int = 0
    barcodes_new: int = 0
    import_ready: bool = False
    can_import_partial: bool = False


class ProductImportPreviewResponse(BaseModel):
    import_id: str
    client_id: str
    client_name: str | None = None
    file_name: str
    status_label: str
    summary: ProductImportSummary
    rows: list[ProductImportRowItem] = Field(default_factory=list)


class ProductImportCommitResponse(BaseModel):
    message: str
    summary: ProductImportSummary
