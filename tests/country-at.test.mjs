// A bare point's country and clock (app/country-at.ts). The line is coarse by design, so these are
// the places it has to get right: every covered market, and the pairs of towns that face each other
// across the border, where a coarse line is most likely to put one of them on the wrong side.
import assert from "node:assert/strict";
import test from "node:test";
import { countryAt, deviceCountry, roughTimezone } from "../app/country-at.ts";

const US = {
  Knoxville: [35.9606, -83.9207], "Morristown, TN": [36.2135, -83.2949], Chicago: [41.8781, -87.6298],
  "New York": [40.7128, -74.006], Seattle: [47.6062, -122.3321], Minneapolis: [44.9778, -93.265],
  Boston: [42.3601, -71.0589], Duluth: [46.7867, -92.1005], "Marquette, MI": [46.5436, -87.3954],
  Cleveland: [41.4993, -81.6944], "Erie, PA": [42.1292, -80.0851], Rochester: [43.1566, -77.6088],
  "Burlington, VT": [44.4759, -73.2121], Bangor: [44.8016, -68.7712], Anchorage: [61.2181, -149.9003],
  Juneau: [58.3019, -134.4197], Ketchikan: [55.3422, -131.6461], Honolulu: [21.3069, -157.8583],
  "San Juan": [18.4655, -66.1057], Miami: [25.7617, -80.1918], "San Diego": [32.7157, -117.1611],
  "El Paso": [31.7619, -106.485], Laredo: [27.5306, -99.4803], Bellingham: [48.7519, -122.4787],
  "Port Angeles": [48.1181, -123.4307], "Friday Harbor": [48.5343, -123.0171], "Point Roberts": [48.9854, -123.0726],
  Fargo: [46.8772, -96.7898], "Grand Forks": [47.9253, -97.0329], "International Falls": [48.6011, -93.4107],
  "Presque Isle, ME": [46.6812, -68.0159], "Sault Ste. Marie, MI": [46.4953, -84.3453], "Port Huron": [42.9709, -82.4249],
  Detroit: [42.3314, -83.0458], Buffalo: [42.8864, -78.8784], "Niagara Falls, NY": [43.0962, -79.0377],
  Massena: [44.9281, -74.8919], Plattsburgh: [44.6995, -73.4529], Toledo: [41.6528, -83.5379], "Green Bay": [44.5133, -88.0133],
  Denver: [39.7392, -104.9903], Austin: [30.2672, -97.7431], Phoenix: [33.4484, -112.074], Boise: [43.615, -116.2023],
};

const CA = {
  Toronto: [43.6532, -79.3832], Ottawa: [45.4215, -75.6972], Montreal: [45.5019, -73.5674], "Quebec City": [46.8139, -71.208],
  Vancouver: [49.2827, -123.1207], Victoria: [48.4284, -123.3656], "Sidney, BC": [48.6502, -123.3987], Surrey: [49.1913, -122.849],
  Tsawwassen: [49.0166, -123.0828], Calgary: [51.0447, -114.0719], Edmonton: [53.5461, -113.4938], Winnipeg: [49.8951, -97.1384],
  Regina: [50.4452, -104.6189], Saskatoon: [52.1332, -106.67], "Thunder Bay": [48.3809, -89.2477],
  "Sault Ste. Marie, ON": [46.5219, -84.3461], Windsor: [42.3149, -83.0364], Leamington: [42.0531, -82.5998],
  "Pelee Island": [41.7708, -82.6508], "London, ON": [42.9849, -81.2453], Sarnia: [42.9745, -82.4066],
  "Niagara Falls, ON": [43.0896, -79.0849], "Fort Erie": [42.9018, -78.9722], Kingston: [44.2312, -76.486],
  "Wolfe Island": [44.1981, -76.4295], Cornwall: [45.0213, -74.7303], Sherbrooke: [45.4042, -71.8929],
  Fredericton: [45.9636, -66.6431], "Saint John": [45.2733, -66.0633], Moncton: [46.0878, -64.7782], Halifax: [44.6488, -63.5752],
  Yarmouth: [43.8375, -66.1174], Charlottetown: [46.2382, -63.1311], "St. John's": [47.5615, -52.7126],
  Edmundston: [47.3737, -68.3251], Whitehorse: [60.7212, -135.0568], Yellowknife: [62.454, -114.3718], Iqaluit: [63.7467, -68.517],
  "Prince Rupert": [54.3150, -130.3208], Kenora: [49.7667, -94.4894], "Fort Frances": [48.6089, -93.4003],
  "Stewart, BC": [55.9361, -129.9894], Kelowna: [49.888, -119.496], Osoyoos: [49.0325, -119.4682],
  Barrie: [44.3894, -79.6903], Burnaby: [49.2488, -122.9805], Gatineau: [45.4765, -75.7013], Hamilton: [43.2557, -79.8711],
  Kitchener: [43.4516, -80.4925], Laval: [45.6066, -73.7124], "Richmond Hill": [43.8828, -79.4403], Waterloo: [43.4643, -80.5204],
};

test("every US place on the list is placed in the US", () => {
  for (const [name, [lat, lng]] of Object.entries(US)) assert.equal(countryAt(lat, lng).country, "US", name);
});

test("every Canadian place on the list is placed in Canada", () => {
  for (const [name, [lat, lng]] of Object.entries(CA)) assert.equal(countryAt(lat, lng).country, "CA", name);
});

test("a point in neither country is not claimed by either", () => {
  for (const [name, lat, lng] of [["Tijuana", 32.5149, -117.0382], ["Monterrey", 25.6866, -100.3161], ["Mexico City", 19.4326, -99.1332], ["Havana", 23.1136, -82.3666], ["London, UK", 51.5072, -0.1276]]) {
    assert.equal(countryAt(lat, lng).country, null, name);
  }
});

test("towns facing each other across the border are the ones the line will not decide alone", () => {
  for (const name of ["Detroit", "Buffalo", "Port Huron", "Sault Ste. Marie, MI", "International Falls", "Point Roberts"]) {
    assert.equal(countryAt(...US[name]).nearBorder, true, name);
  }
  for (const name of ["Windsor", "Fort Erie", "Sarnia", "Sault Ste. Marie, ON", "Fort Frances", "Victoria"]) {
    assert.equal(countryAt(...CA[name]).nearBorder, true, name);
  }
  // And well inside either country, the line alone decides.
  for (const [lat, lng] of [US.Knoxville, US.Chicago, US.Seattle, CA.Toronto, CA.Ottawa, CA.Montreal, CA.Vancouver]) {
    assert.equal(countryAt(lat, lng).nearBorder, false, `${lat},${lng}`);
  }
});

test("near the border the visitor's network settles it; elsewhere the map does", () => {
  // Across the Detroit River: whichever side the network is on.
  assert.equal(deviceCountry(...US.Detroit, "CA"), "CA");
  assert.equal(deviceCountry(...CA.Windsor, "US"), "US");
  // With no usable network country, the line's own answer.
  assert.equal(deviceCountry(...US.Detroit, null), "US");
  assert.equal(deviceCountry(...CA.Windsor, "FR"), "CA");
  // A Canadian roaming in Knoxville reads as Canadian to the network and is in the US all the same.
  assert.equal(deviceCountry(...US.Knoxville, "CA"), "US");
  assert.equal(deviceCountry(...CA.Toronto, "US"), "CA");
  // Outside both, the network's country if it is one of Radar's, else nothing.
  assert.equal(deviceCountry(19.4326, -99.1332, "US"), "US");
  assert.equal(deviceCountry(51.5072, -0.1276, "GB"), null);
});

test("a guessed clock is the right one where Radar's readers are", () => {
  const zone = (country, [lat, lng]) => roughTimezone(country, lat, lng);
  assert.equal(zone("US", US.Knoxville), "America/New_York");
  assert.equal(zone("US", US.Chicago), "America/Chicago");
  assert.equal(zone("US", US.Denver), "America/Denver");
  assert.equal(zone("US", US.Phoenix), "America/Phoenix");
  assert.equal(zone("US", US.Boise), "America/Boise");
  assert.equal(zone("US", US.Seattle), "America/Los_Angeles");
  assert.equal(zone("US", US.Anchorage), "America/Anchorage");
  assert.equal(zone("US", US.Honolulu), "Pacific/Honolulu");
  assert.equal(zone("CA", CA.Vancouver), "America/Vancouver");
  assert.equal(zone("CA", CA.Kelowna), "America/Vancouver");
  assert.equal(zone("CA", CA.Calgary), "America/Edmonton");
  assert.equal(zone("CA", CA.Regina), "America/Regina");
  assert.equal(zone("CA", CA.Winnipeg), "America/Winnipeg");
  assert.equal(zone("CA", CA.Kenora), "America/Winnipeg");
  assert.equal(zone("CA", CA["Thunder Bay"]), "America/Toronto");
  assert.equal(zone("CA", CA.Montreal), "America/Toronto");
  assert.equal(zone("CA", CA.Fredericton), "America/Halifax");
  assert.equal(zone("CA", CA.Halifax), "America/Halifax");
  assert.equal(zone("CA", CA["St. John's"]), "America/St_Johns");
});
