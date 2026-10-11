// Which state a US ZIP code is in, from its first three digits.
//
// Why this is a table and not a lookup
// ------------------------------------
// The deal page narrows its location list to the reader's own state, and it learned the state from
// `postal_cache` - a table the geocoder fills as postal codes are resolved. That works in Canada,
// where Radar has been resolving postal codes for a year. In the US it is empty, so every ZIP a
// reader typed into the deal page missed the cache and the page quietly showed them all 10,482
// McDonald's anyway. The feature existed and did nothing.
//
// Geocoding on a page render was the other option and is worse: an external call in the render
// path, on a route that has a CPU ceiling and is otherwise pure database reads.
//
// USPS allocates ZIP prefixes to states in contiguous blocks, so the whole mapping is about sixty
// ranges rather than forty thousand rows. It is reference data, not a guess: 750-799 is Texas the
// way 900-961 is California.
//
// Territories (PR, VI, GU) and the military prefixes (AA/AE/AP) are deliberately absent. Radar has
// no locations there, and an unknown prefix returns null, which the caller treats as "they did not
// say where they are" - the whole list plus the prompt, which is the honest answer.

/** [first prefix, last prefix, state] — inclusive, non-overlapping, ascending. */
const ZIP_RANGES: ReadonlyArray<readonly [number, number, string]> = [
  [5, 5, "NY"], [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"],
  [50, 59, "VT"], [60, 69, "CT"], [70, 89, "NJ"], [100, 149, "NY"], [150, 196, "PA"],
  [197, 199, "DE"], [200, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"],
  [270, 289, "NC"], [290, 299, "SC"], [300, 319, "GA"], [320, 339, "FL"], [341, 349, "FL"],
  [350, 369, "AL"], [370, 385, "TN"], [386, 397, "MS"], [398, 399, "GA"], [400, 427, "KY"],
  [430, 459, "OH"], [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"], [530, 549, "WI"],
  [550, 567, "MN"], [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"], [600, 629, "IL"],
  [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"], [700, 714, "LA"], [716, 729, "AR"],
  [730, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"], [820, 831, "WY"], [832, 838, "ID"],
  [840, 847, "UT"], [850, 865, "AZ"], [870, 884, "NM"], [885, 885, "TX"], [889, 898, "NV"],
  [900, 961, "CA"], [967, 968, "HI"], [970, 979, "OR"], [980, 994, "WA"], [995, 999, "AK"],
];

/**
 * The state a five-digit US ZIP belongs to, or null when the prefix is not a state's.
 *
 * Takes a normalized postal code — digits only, as normalizedPostal leaves them. A Canadian postal
 * code returns null here and is resolved through postal_cache instead, which does hold Canada.
 */
export function regionForZip(postal: string): string | null {
  if (!/^\d{5}(\d{4})?$/.test(postal)) return null;
  const prefix = Number(postal.slice(0, 3));
  for (const [from, to, region] of ZIP_RANGES) {
    if (prefix >= from && prefix <= to) return region;
  }
  return null;
}

export const ZIP_RANGES_FOR_TEST = ZIP_RANGES;

// The same fallback for a Canadian postal code, whose first letter names its province.
//
// postal_cache holds most of the Canadian codes readers type, but only the ones someone has typed
// before: a code the geocoder has never been asked about missed the cache, and the deal page
// narrowed nothing and said nothing, handing the reader back the prompt they had just answered.
// Canada Post assigns the first letter by province, so the letter alone is enough to narrow a list
// to the reader's province. It is not enough for a distance, which is why a caller gets no point.
const FSA_PROVINCES: Record<string, string> = {
  A: "NL", B: "NS", C: "PE", E: "NB", G: "QC", H: "QC", J: "QC",
  K: "ON", L: "ON", M: "ON", N: "ON", P: "ON", R: "MB", S: "SK", T: "AB", V: "BC", Y: "YT",
};

// X is shared by the two eastern territories. Nunavut has three forward sortation areas of its own
// (X0A, X0B, X0C); every other X code is the Northwest Territories.
const NUNAVUT_FSAS = new Set(["X0A", "X0B", "X0C"]);

/**
 * The province or territory a Canadian postal code belongs to, or null when it is not one.
 *
 * Takes a normalized postal code (A1A1A1, as normalizedPostal leaves it). A US ZIP returns null
 * here and goes to regionForZip instead.
 */
export function provinceForPostal(postal: string): string | null {
  if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(postal)) return null;
  const letter = postal[0];
  if (letter === "X") return NUNAVUT_FSAS.has(postal.slice(0, 3)) ? "NU" : "NT";
  return FSA_PROVINCES[letter] ?? null;
}
