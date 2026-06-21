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
    items_per_pallet: int | None = None
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
    items_per_pallet: int | None = Field(default=None, ge=0)
    is_active: bool = True


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
    items_per_pallet: int | None = Field(default=None, ge=0)
    image_urls: list[str] | None = None


class ProductVariantDimension(BaseModel):
    length: float = Field(ge=0)
    width: float = Field(ge=0)
    height: float = Field(ge=0)


class ProductVariantItem(BaseModel):
    id: str
    color_id: str | None
    color_name: str | None = None
    dimension: ProductVariantDimension
    size_id: str | None = None
    size_name: str | None = None
    sku: str
    barcode: str | None = None
    images: list[str] = Field(default_factory=list)
    is_active: bool
    stock: int = 0
    defect_qty: int = 0
    has_receipts: bool = False


class VariantBarcodeUpdate(BaseModel):
    barcode: str | None = None


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
