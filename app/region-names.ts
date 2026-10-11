// A state or province code as a reader says it: "TN" is "Tennessee".
//
// Its own module because app/geocode.ts, which holds the reverse mapping, imports the Worker
// runtime and cannot be bundled into a client component - and the homepage's nationwide list,
// which says "Chains with restaurants in Tennessee", is one. Proper nouns, so one spelling serves
// every locale; the provinces keep their English names the way the rest of the site does.

const NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "Washington, DC", FL: "Florida", GA: "Georgia", HI: "Hawaii",
  ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// Canadian codes are kept apart because "CA" is California in the table above.
const PROVINCES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island",
  QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};

/** The name of a state or province, or the code itself when it is neither. */
export function regionName(code: string | null | undefined, country?: string | null): string {
  const key = String(code || "").trim().toUpperCase();
  if (!key) return "";
  const table = String(country || "").toUpperCase() === "CA" ? PROVINCES : NAMES;
  return table[key] || PROVINCES[key] || NAMES[key] || key;
}
