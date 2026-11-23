import source from '../../content/menu.source.json'

/** Map each named dish to the reference-photo slot that shows what HIS photo of it should look like. */
const SLOT: Record<string, string> = {
  'Seafood Vol-au-Vent': 'dish-vol-au-vent',
  'Lobster Bisque': 'dish-lobster-bisque',
  'Seafood Paella': 'dish-seafood-paella',
  'Beef Stroganoff': 'dish-beef-stroganoff',
  'Thai Chicken Curry': 'dish-thai-chicken-curry',
}

export const dishes = source.named.map((d) => ({ name: d.name, slot: SLOT[d.name] ?? null }))
export const unnamedDishes = source.unnamed_in_photos_ask_sergio
