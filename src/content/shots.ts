/**
 * The shot list. Each slot is a place in the layout that needs one of Sergio's OWN photos.
 * The watermarked reference image shows the look; the spec says how to shoot his version.
 */
export type Shot = { slot: string; use: string; aspect: string; spec: string }

export const shots: Shot[] = [
  { slot: 'hero-dish', use: 'Home page hero: the dish on the corner of the menu card', aspect: '1:1, shown as a circle',
    spec: 'Straight overhead: one of his dishes in a round pan or on a round plate, filling about 90% of a square frame, dead center. Plain dark wood or stone underneath, daylight from one side, no props in the corners (they are cropped away). His Seafood Paella in the pan is ideal.' },
  { slot: 'hero-chef-plating', use: 'Home page, first screen', aspect: '4:5 vertical + 3:2 horizontal',
    spec: 'Sergio plating a course at a client\'s kitchen island, mid-motion. Warm practical light from the room, no flash. Shoot at counter height, 50mm. Guests soft in the background.' },
  { slot: 'chef-portrait', use: 'About page, home "Meet" section', aspect: '4:5',
    spec: 'Sergio in his chef jacket in a real home kitchen, window light from the side, looking at the camera, relaxed. 85mm, eye level. No studio backdrop.' },
  { slot: 'guests-at-table', use: 'Private dining page', aspect: '3:2',
    spec: 'Real clients mid-dinner, a plated course just set down. Candid, laughing, not posed. Get written permission (model release) from everyone visible.' },
  { slot: 'class-hands', use: 'Cooking classes page', aspect: '3:2',
    spec: 'Close on a client\'s hands doing the work (folding, rolling, searing) with Sergio\'s hands guiding. The client\'s own kitchen visible.' },
  { slot: 'sergios-table', use: "Sergio's table page, home switch", aspect: '3:2',
    spec: 'His own dining table, set for guests, in his own dining room, evening light with candles. Then the same table mid-dinner with Sergio serving.' },
  { slot: 'catering-table', use: 'Catering page', aspect: '3:2',
    spec: 'A table he actually set: his linens, dinnerware, glassware, centerpiece. Shoot before guests arrive, from a standing 45° angle, all lights on plus candles.' },
  { slot: 'mise-en-place', use: 'Home "Standards" section', aspect: '1:1',
    spec: 'The organic produce and proteins for a real event, prepped and laid out before cooking. Overhead, daylight. This photo proves the "organic, no seed oils, nothing frozen" line.' },
  { slot: 'dish-vol-au-vent', use: 'Dish row', aspect: '4:5', spec: 'His Seafood Vol-au-Vent on the plate he serves it on. 45° angle, window light, plain background.' },
  { slot: 'dish-lobster-bisque', use: 'Dish row', aspect: '4:5', spec: 'His Lobster Bisque in the bowl, garnish just added. Overhead or 45°, window light.' },
  { slot: 'dish-seafood-paella', use: 'Dish row', aspect: '4:5', spec: 'His Seafood Paella in the pan, straight overhead, whole pan in frame.' },
  { slot: 'dish-beef-stroganoff', use: 'Dish row', aspect: '4:5', spec: 'His Beef Stroganoff as plated or in the chafing dish he uses. 45°, close.' },
  { slot: 'dish-thai-chicken-curry', use: 'Dish row', aspect: '4:5', spec: 'His Thai Chicken Curry with its garnish and rice. 45°, close.' },
]

export const shotBySlot = Object.fromEntries(shots.map((s) => [s.slot, s]))
