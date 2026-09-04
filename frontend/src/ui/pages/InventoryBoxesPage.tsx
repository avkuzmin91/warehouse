import { PlacementRunFeature } from '../features/inventory/PlacementRunFeature'

// Адрес исторический (/inventory/boxes — он же родитель карточки короба), содержимое —
// развозка по местам: реестр коробов уехал в справочник.
export function InventoryBoxesPage() {
  return <PlacementRunFeature />
}
