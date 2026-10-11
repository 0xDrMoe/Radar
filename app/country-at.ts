// Which of Radar's two countries a bare point is in, and what time it is there.
//
// A search from "my location" arrives as a latitude and a longitude and nothing else, and the API
// used to file every one under Canada and Toronto time. A reader in Knoxville was answered as a
// Canadian: the nationwide list was Canada's chains, distances came back in kilometres, and a
// national offer's "Tuesday only" turned over at midnight in Toronto.
//
// The border is drawn here, coarsely, rather than asked of a geocoder: a device search is the one
// request that must not wait on a network call or spend one, and a country is all that is needed.
// Near the border - Detroit and Windsor are a river apart - no line this coarse can be trusted, so
// countryAt says so, and the caller settles it with the visitor's own network country.
//
// Import-free, so tests load it as it is.

type Point = readonly [number, number]; // [longitude, latitude]

// Canada, as a polygon: the border with the lower 48 from the Pacific to the Bay of Fundy, then out
// round the Atlantic provinces and the Arctic, down the Alaska border and its panhandle, and back
// along the Pacific. Through the Great Lakes it follows the water boundary closely enough that land
// on either shore falls on the right side, which is all it is for.
const CANADA: Point[] = [
  // Open Pacific, south of Vancouver Island.
  [-131.0, 48.49], [-124.73, 48.49],
  // Juan de Fuca, Haro Strait and Boundary Pass, then round Point Roberts to the 49th parallel.
  [-124.0, 48.29], [-123.4, 48.23], [-123.22, 48.32], [-123.23, 48.45], [-123.25, 48.58], [-123.21, 48.68],
  [-123.07, 48.76], [-123.0, 48.83], [-123.32, 49.0],
  // The 49th parallel to Lake of the Woods, and the Northwest Angle.
  [-95.153, 49.0], [-95.153, 49.384], [-94.82, 49.32],
  // Rainy River, Rainy Lake and the boundary waters to the Pigeon River.
  [-94.7, 48.84], [-94.6, 48.72], [-94.25, 48.66], [-93.85, 48.63], [-93.41, 48.606], [-92.95, 48.62], [-92.5, 48.45],
  [-92.0, 48.32], [-91.5, 48.1], [-91.0, 48.24], [-90.5, 48.1], [-90.0, 48.1], [-89.6, 48.0],
  // Lake Superior, north of Isle Royale and the Keweenaw.
  [-89.3, 48.02], [-88.4, 48.3], [-87.9, 48.0], [-86.5, 47.6], [-85.5, 47.1], [-84.85, 46.9], [-84.6, 46.5],
  // St. Marys River, past the two Sault Ste. Maries.
  [-84.35, 46.51], [-84.12, 46.5], [-84.0, 46.3], [-83.95, 46.1], [-83.6, 46.05], [-83.45, 45.97],
  // Lake Huron to Sarnia and Port Huron.
  [-82.5, 45.3], [-82.2, 44.0], [-82.15, 43.3], [-82.42, 43.0],
  // St. Clair River, Lake St. Clair, and the Detroit River between Detroit and Windsor.
  [-82.45, 42.8], [-82.52, 42.62], [-82.7, 42.47], [-82.93, 42.35], [-82.98, 42.335], [-83.04, 42.322],
  [-83.075, 42.31], [-83.11, 42.28], [-83.13, 42.2], [-83.13, 42.1], [-83.12, 42.03],
  // Lake Erie, south round Pelee Island, to Buffalo and Fort Erie.
  [-83.0, 41.88], [-82.85, 41.75], [-82.7, 41.67], [-82.45, 41.68], [-81.9, 41.9], [-81.0, 42.2], [-80.05, 42.35],
  [-79.3, 42.62], [-78.93, 42.88],
  // The Niagara River.
  [-79.03, 43.02], [-79.075, 43.08], [-79.064, 43.095], [-79.061, 43.105], [-79.068, 43.118], [-79.05, 43.15], [-79.06, 43.27],
  // Lake Ontario, and the St. Lawrence past Wolfe Island and the Thousand Islands to Cornwall.
  [-78.0, 43.63], [-77.0, 43.6], [-76.5, 43.7], [-76.44, 44.05], [-76.3, 44.14], [-76.1, 44.22], [-75.95, 44.35],
  [-75.75, 44.47], [-75.45, 44.72], [-75.2, 44.87], [-74.95, 44.98], [-74.67, 45.0],
  // The 45th parallel, then New Hampshire and Maine to Passamaquoddy Bay.
  [-71.5, 45.01], [-71.08, 45.3], [-70.83, 45.4], [-70.4, 45.73], [-70.25, 45.95], [-70.0, 46.35], [-69.99, 46.7],
  [-69.23, 47.45], [-68.9, 47.18], [-68.33, 47.36], [-67.79, 47.07], [-67.78, 45.95], [-67.43, 45.61],
  [-67.28, 45.19], [-67.05, 45.05], [-66.95, 44.8],
  // Out through the Bay of Fundy, round Nova Scotia and Newfoundland, and over the Arctic.
  [-66.7, 44.5], [-66.7, 43.0], [-50.0, 43.0], [-50.0, 84.0], [-141.0, 84.0],
  // Down the 141st meridian, then the Alaska panhandle to Dixon Entrance.
  [-141.0, 60.3], [-139.0, 60.33], [-137.5, 59.2], [-136.4, 59.55], [-135.2, 59.75], [-134.0, 58.9], [-133.4, 58.4],
  [-132.0, 57.0], [-130.9, 56.35], [-130.0, 55.9], [-130.02, 55.3], [-130.6, 54.7],
  // Out past Haida Gwaii and down the open Pacific.
  [-134.5, 54.6], [-134.0, 51.0],
];

// The part of that polygon that is a border with the lower 48 rather than a coastline: from the
// Juan de Fuca entrance to Passamaquoddy Bay. A point within BORDER_BAND_KM of it is one countryAt
// will not decide on its own.
const LOWER_48_BORDER: Point[] = CANADA.slice(1, CANADA.findIndex(([lng, lat]) => lng === -66.95 && lat === 44.8) + 1);
const BORDER_BAND_KM = 25;

// Mexico, coarsely, so the box below does not claim Tijuana or Monterrey. Its border cities are no
// better placed by this line than Windsor would be by a straight one, and nothing Radar shows
// depends on getting them right: a point here is simply in neither country.
const MEXICO: Point[] = [
  [-118.5, 32.53], [-117.13, 32.53], [-114.72, 32.72], [-114.81, 32.49], [-111.07, 31.33], [-108.21, 31.33],
  [-108.21, 31.78], [-106.53, 31.78], [-105.0, 30.68], [-104.5, 29.65], [-103.15, 28.98], [-102.4, 29.78],
  [-101.4, 29.77], [-100.3, 28.3], [-99.52, 27.49], [-99.1, 26.4], [-98.2, 26.05], [-97.5, 25.87], [-97.14, 25.95],
  [-96.0, 25.95], [-96.0, 14.0], [-118.5, 14.0],
];

// The United States: the lower 48 (less whatever the two polygons above claim), Alaska, Hawaii and
// Puerto Rico, as [west, south, east, north].
const US_BOXES: Array<readonly [number, number, number, number]> = [
  [-125.0, 24.3, -66.9, 49.4],
  [-180.0, 51.0, -129.9, 71.6],
  [-160.5, 18.8, -154.7, 22.4],
  [-67.5, 17.6, -64.5, 18.6],
];

function inside(polygon: Point[], lng: number, lat: number) {
  let within = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}

/** Kilometres from a point to the nearest segment of a line, on a flat projection - ample at this scale. */
function kmToLine(line: Point[], lng: number, lat: number) {
  const kmPerLng = 111.32 * Math.cos((lat * Math.PI) / 180), kmPerLat = 110.57;
  let nearest = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - lng) * kmPerLng, ay = (line[i - 1][1] - lat) * kmPerLat;
    const bx = (line[i][0] - lng) * kmPerLng, by = (line[i][1] - lat) * kmPerLat;
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return nearest;
}

export type Country = "US" | "CA";

/**
 * The country a point is in, and whether the line drawn here is too coarse to say. `country` is
 * null outside both countries; `nearBorder` is true within BORDER_BAND_KM of the US-Canada border,
 * where the caller should prefer a better signal when it has one.
 */
export function countryAt(latitude: number, longitude: number): { country: Country | null; nearBorder: boolean } {
  const nearBorder = kmToLine(LOWER_48_BORDER, longitude, latitude) < BORDER_BAND_KM;
  if (inside(CANADA, longitude, latitude)) return { country: "CA", nearBorder };
  if (inside(MEXICO, longitude, latitude)) return { country: null, nearBorder };
  const inUs = US_BOXES.some(([west, south, east, north]) => longitude >= west && longitude <= east && latitude >= south && latitude <= north);
  return { country: inUs ? "US" : null, nearBorder };
}

/**
 * A device point's country: the drawn line, unless the point is close enough to the border that the
 * visitor's network country is the better witness. That can be wrong for someone roaming on a
 * home carrier across the border; the line is wrong for someone standing in Windsor. Within
 * 25 km of the border either answer puts deals from both sides in range, which is what matters most.
 */
export function deviceCountry(latitude: number, longitude: number, networkCountry: string | null | undefined): Country | null {
  const { country, nearBorder } = countryAt(latitude, longitude);
  const network = networkCountry === "US" || networkCountry === "CA" ? networkCountry : null;
  if (nearBorder && network) return network;
  return country ?? network;
}

// A zone by longitude, for when nothing better is known. Coarse on purpose - the lines between
// zones wander by county - and only ever the last resort after the reader's own clock and their
// network's.
export function roughTimezone(country: Country | null, latitude: number, longitude: number): string {
  if (country === "US") {
    if (latitude < 23 && longitude < -150) return "Pacific/Honolulu";
    if (latitude > 51 && longitude < -129.9) return "America/Anchorage";
    if (latitude < 19 && longitude > -68) return "America/Puerto_Rico";
    // Arizona keeps standard time all year; southern Idaho and eastern Oregon keep Mountain.
    if (latitude > 31.3 && latitude < 37 && longitude > -114.8 && longitude < -109.05) return "America/Phoenix";
    if (latitude > 42 && latitude < 45.6 && longitude > -117.2 && longitude < -111) return "America/Boise";
    if (longitude < -114.5) return "America/Los_Angeles";
    if (longitude < -102) return "America/Denver";
    if (longitude < -86.5) return "America/Chicago";
    return "America/New_York";
  }
  if (country === "CA") {
    if (longitude < -118) return "America/Vancouver";
    if (longitude < -110) return "America/Edmonton";
    if (longitude < -102) return "America/Regina";
    if (longitude < -90) return "America/Winnipeg";
    // The Maritimes sit south of the Gaspé, which keeps Quebec's time as far east as -64.
    if (longitude > -59.5 && latitude < 51.4) return "America/St_Johns";
    if (longitude > -69 && latitude < 48) return "America/Halifax";
    if (longitude > -67 && latitude > 51.4) return "America/Goose_Bay";
    return "America/Toronto";
  }
  return "America/Toronto";
}
