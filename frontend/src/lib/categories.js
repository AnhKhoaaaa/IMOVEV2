// Maps a raw POI category string to a design-system category token group (index.css --color-cat-*).
// Single source so POI chips (Trip/Planner) and map dots stay in sync. Chip classes are FULL
// static strings (not interpolated) so Tailwind v4 can generate the utilities.

const CATEGORY_GROUP = {
  food: 'food', dining: 'food', restaurant: 'food', cafe: 'food', hawker: 'food',
  nature: 'nature', park: 'nature', beach: 'nature', garden: 'nature', gardens: 'nature',
  culture: 'culture', heritage: 'culture', museum: 'culture', temple: 'culture', religious: 'culture',
  shopping: 'shopping', market: 'shopping', mall: 'shopping',
  landmark: 'landmark', attraction: 'landmark', sightseeing: 'landmark', viewpoint: 'landmark',
  entertainment: 'entertainment', nightlife: 'entertainment', themepark: 'entertainment',
}

const CATEGORY_HEX = {
  culture: '#7c3aed',
  landmark: '#2563eb',
  nature: '#059669',
  food: '#d97706',
  shopping: '#db2777',
  entertainment: '#c026d3',
  default: '#64748b',
}

const CATEGORY_CHIP = {
  culture:       'bg-cat-culture-50 text-cat-culture',
  landmark:      'bg-cat-landmark-50 text-cat-landmark',
  nature:        'bg-cat-nature-50 text-cat-nature',
  food:          'bg-cat-food-50 text-cat-food',
  shopping:      'bg-cat-shopping-50 text-cat-shopping',
  entertainment: 'bg-cat-entertainment-50 text-cat-entertainment',
  default:       'bg-cat-default-50 text-cat-default',
}

export function categoryGroup(category) {
  return CATEGORY_GROUP[String(category ?? '').toLowerCase()] ?? 'default'
}

export function categoryHex(category) {
  return CATEGORY_HEX[categoryGroup(category)]
}

export function categoryChip(category) {
  return CATEGORY_CHIP[categoryGroup(category)]
}
