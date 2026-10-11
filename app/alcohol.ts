// Which deals reference alcohol, and why this exists at all.
//
// Radar's catalog is 74% happy hour, and every happy-hour deal in it references drinks. Under
// Apple's 2025 age ratings that frequency is "Frequent alcohol, tobacco, or drug use or
// references", which rates an app 18+ outright — there is no middle rung between Infrequent (13+)
// and Frequent (18+). The questionnaire's own instruction is to "consider what a user who has
// [in-app controls] turned on will encounter", so this module is the control: with it on, the app
// serves the food-only catalog and a minor never encounters the drinks half of the product.
//
// That makes this a compliance surface, not a convenience filter. Two consequences follow:
//
// It is deliberately over-eager. A false positive hides a wing special from someone who would
// have liked it; a false negative shows a cocktail listing to a thirteen-year-old in an app that
// told Apple it wouldn't. Those costs are not symmetric, so every rule here rounds toward
// hiding, and `Happy hour` is treated as alcohol categorically rather than by keyword — 93 of 93
// happy-hour deals referenced drinks when measured, and the 33 that name no specific drink
// ("Happy Hour · From $5") are advertising a bar's discounted bar menu regardless.
//
// It runs at read time rather than from a column. The whole search pipeline already filters in
// JS over deals held in memory, a regex over a few hundred rows costs nothing next to the
// queries around it, and — the actual reason — a deal added tomorrow is classified without any
// staff member remembering to tick a box. A column would be exactly as accurate as this function
// and would additionally be wrong whenever someone forgot.

// Alcohol-serving venue types. A wine bar's "house special" needs no keyword to be a drink.
//
// Matched as words rather than as a list of whole strings to equal. The editor's dropdown
// (app/cuisines.ts) names only "Bar & Pub" and "Wine Bar", but it ends in "Other" with a freeform
// field behind it, and the catalog predates the dropdown: "Bar", "Sports bar", "Irish pub",
// "Brewpub" and "Cocktail bar" are all live values today. Matching whole strings meant each of
// those read as an ordinary restaurant, and would have again the next time somebody typed a venue
// the dropdown does not offer. A set extended by hand every time a bar describes itself a new way
// is the wrong shape for the one rule in this app that has to hold.
const VENUES = [
  "bar", "beer garden", "beer hall", "brewery", "brewpub", "cidery", "distillery", "gastropub",
  "meadery", "pub", "saloon", "speakeasy", "tap room", "taproom", "tavern", "winery",
];
const VENUE_PATTERN = new RegExp(`(?<![\\p{L}])(?:${VENUES.join("|")})s?(?![\\p{L}])`, "iu");

// The exception that makes matching "bar" as a word safe: the qualifier in front of it decides
// whether it is a place to drink. "Sports bar" and "Wine bar" are; "sushi bar" and "juice bar"
// are the other direction, and hiding every sushi restaurant would be a real cost rather than the
// cheap false positive the rest of these rules accept.
const FOOD_BARS = /(?<![\p{L}])(?:breakfast|candy|coffee|dessert|espresso|ice cream|juice|noodle|oyster|poke|ramen|salad|sandwich|smoothie|soup|sushi|taco|tea)[\s-]+bars?(?![\p{L}])/giu;

// Food that contains a drink word without being a drink. `caesar` is in WORDS below because the
// cocktail is, which made an alcohol reference of two ordinary things: "Little Caesars pricing
// varies by province", a line of fine print on a pizza deal, and the Caesar salad that sits in
// half the combo deals on any casual menu — "2 Medium Pizzas, Caesar Salad and Fritters $45.99".
// The rest are the same mistake waiting for its deal: a shrimp cocktail is an appetizer, sour
// cream goes on nachos, and a Scotch egg or a Reuben on rye is lunch.
//
// These, the three lists after them and DRINK_CONDITION further down are the only rules in the
// file that run toward showing rather than hiding, so they are kept narrow on purpose: whole
// phrases, never the drink word alone. Stripping `caesar` outright would let a bar's "$6 Caesars"
// through, which is the failure this module exists to prevent — and that is the line these
// patterns are drawn to keep. A caesar with a salad after it is lunch; a caesar with a price in
// front of it is a drink.
const FOOD_PHRASES = /(?<![\p{L}])(?:little\s+caesars?|caesar\s+(?:salad|wrap|dressing)s?|chicken\s+caesars?|(?:shrimp|prawn|seafood|fruit)\s+cocktails?|sour\s+cream|sweet\s+(?:and|&|n['’]?)\s+sour|scotch\s+(?:eggs?|bonnets?)|rye\s+(?:bread|toast)|marble\s+rye|on\s+rye)(?![\p{L}])/giu;

// Soft drinks named with a drink word. Dunkin's free coffee and Cinnabon's coffee-or-soda deal
// were both withheld from the 13+ catalog because their fine print says "cold brew", and
// Cinnabon's also says "sparkling lemonade" (measured 2026-09-29). A root beer float is a child's
// order. The hard versions keep their drink word: "hard root beer" is alcohol, and stays hidden.
const SOFT_DRINKS = /(?<![\p{L}])(?:(?<!hard\s+)(?:root\s+beer|ginger\s+ale)|cold[\s-]+brew|sparkling\s+(?:water|lemonade|juice))s?(?![\p{L}])/giu;

// Places and records named after a drink. Canada names its arenas after beer — Budweiser Gardens
// in London, Budweiser Stage in Toronto, the Sleeman Centre in Guelph, Labatt Park — and Denver
// names its ballpark after Coors, so "steps from Budweiser Gardens" on a wing night is directions,
// not a drink. Several names in BRANDS below are only safe to match with these taken out first,
// "bud" most of all: "taste buds" and "Bud's Burgers" are not a beer.
const NOT_DRINKS = /(?<![\p{L}])(?:taste\s+buds?|bud['’]s|budweiser\s+(?:gardens|stage)|coors\s+field|corona\s+del\s+mar|guinness\s+(?:world\s+records?|book)|(?:john\s+)?labatt\s+(?:park|cent(?:re|er))|sleeman\s+cent(?:re|er)|kokanee\s+(?:salmon|creek|glacier)|jameson\s+(?:ave(?:nue)?|st(?:reet)?))(?![\p{L}])/giu;

// Alcohol named only to exclude it. "Does not apply to alcohol" on a student discount and
// "excludes taxes, gratuities, alcohol and gift cards" on a CAA one withheld both from the 13+
// catalog (measured 2026-09-29), though the offer is food and the fine print says so.
//
// The mirror of DRINK_CONDITION, and narrow the same way: the exclusion has to be the whole
// clause, so the word has to be followed by the end of the sentence or by another thing excluded
// ("and gift cards"). "Everything half price except alcohol, which is $5" is not an exclusion,
// and stays hidden.
const EXCLUDED_ALONGSIDE = "(?:taxes|tax|tips?|gratuit(?:y|ies)|gift\\s+(?:cards?|certificates?)|delivery|fees?|service\\s+charges?)";
const ALCOHOL_NAMED = "(?:alcohol|alcoholic\\s+(?:beverages?|drinks?)|liquor)";
const ALCOHOL_EXCLUSION = new RegExp(
  [
    // "Does not apply to alcohol.", "Not valid on alcohol.", "Excludes taxes, gratuities, alcohol and gift cards."
    `(?:(?:does\\s+not|doesn['’]t)\\s+(?:apply\\s+to|include)|not\\s+(?:valid|applicable|available)\\s+(?:on|for|to|with)|not\\s+including|excludes?|excluding|except(?:\\s+for)?)\\s+(?:${EXCLUDED_ALONGSIDE}\\s*,?\\s*(?:(?:and|or|&)\\s+)?)*${ALCOHOL_NAMED}(?=\\s*(?:[.;:!)]|$|,?\\s*(?:(?:and|or|&)\\s+)?${EXCLUDED_ALONGSIDE}(?![\\p{L}])))`,
    // "Alcohol excluded.", "Alcohol not included."
    `${ALCOHOL_NAMED}\\s+(?:(?:is|are)\\s+)?(?:excluded|not\\s+included)`,
  ].join("|"),
  "giu",
);

/** Copy as the drink vocabulary should read it: the food, soft drinks, places and exclusions that only look like drinks taken out. */
function readable(printed: string): string {
  return printed
    .replace(FOOD_PHRASES, " ")
    .replace(SOFT_DRINKS, " ")
    .replace(NOT_DRINKS, " ")
    .replace(ALCOHOL_EXCLUSION, " ");
}

/**
 * Whether a piece of copy names an alcoholic drink, read through the same exceptions as a deal's
 * copy (a Caesar salad, root beer, Coors Field). For checks that need to know which sentence of a
 * deal is about drink, such as the advertising rules in app/drink-rules.ts.
 */
export function namesDrink(text: string | null | undefined): boolean {
  const copy = String(text || "");
  return PATTERN.test(copy) && PATTERN.test(readable(copy));
}

/** Deal categories that are about drinking, whatever the copy says. */
const CATEGORIES = new Set(["happy hour"]);

// Food, named plainly enough that a deal saying one of these is about eating.
//
// This list is the escape hatch from the venue rule below, and it exists because the venue rule
// alone was hiding 76 live deals that were food by every other measure: "85¢ wing Wednesday",
// "All-you-can-eat wings Thursday", "Half-price wings Monday". Every one was categorized by staff
// as `Tonight` or `Food deal` rather than `Happy hour`, and not one named a drink anywhere in its
// copy. They were hidden from the 13+ catalog for no reason other than the restaurant being a
// pub, which is where a wing night is normally found.
//
// Kept to words that are food and nothing else. `menu` was a candidate and was left out on
// purpose: a bar's "drink menu" would match it, and `drink` is deliberately absent from the
// alcohol vocabulary below (a soft drink is not one), so `menu` was the one word here that could
// have carried a drinks promotion past both rules at once.
//
// A word missing from this list never leaks a drink; it hides food, which is the cheap direction
// and therefore the quiet one. `slider` was found that way, and only by accident: The Irish
// Rover's seven Denver specials cleared the venue rule because one line of their prose happened
// to say "chicken". A card shows a sibling offer as its title and price alone, so a dish whose
// name is not here rests on whatever else the copy happens to mention.
const FOOD_WORDS = [
  "appetizer", "app", "bacon", "bagel", "bowl", "breakfast", "brunch", "burger", "burrito",
  "calamari", "cheese", "chicken", "chip", "combo", "curry", "dessert", "dim sum", "dinner", "dish",
  "donair", "dumpling", "eat", "egg", "entree", "entrée", "fajita", "fish", "food", "fries",
  "handheld",
  "kids", "lasagna", "lunch", "meal", "meat", "mussel", "nacho", "noodle", "oyster", "pasta",
  "perogy", "pho", "pizza", "plate", "platter", "poutine", "prawn", "quesadilla", "ramen", "rib",
  "rice", "roll", "salad", "sandwich", "schnitzel", "seafood", "shawarma", "shrimp", "shuck",
  "slice", "slider", "souvlaki", "spaghetti", "starter", "steak", "sub", "sushi", "taco", "tender",
  "waffle", "wing", "wrap",
];
// No `g` flag: this is used with .test(), which is stateful across calls on a global regex.
const FOOD_PATTERN = new RegExp(`(?<![\\p{L}])(?:${FOOD_WORDS.join("|")})(?:s|es)?(?![\\p{L}])`, "iu");

// Words that are not alcohol anywhere else, but are at a bar.
//
// `drink` is deliberately absent from the alcohol vocabulary below, because a soft drink is not
// one — "free drink with any combo" at a pizzeria is a child's deal and should stay visible. At a
// drinking venue the same word carries the opposite weight: "15% student discount on food &
// drinks" at a brewery taproom is a discount on beer, and it reached the filtered catalog
// because `food` in the title cleared the venue rule.
//
// So these only ever apply where the venue already says drink, and they only withdraw the food
// escape — they never flag a deal at a restaurant. Eight of the nine deals this caught are wing
// nights whose fine print reads "with any regularly priced beverage", where the offer is food and
// the drink is a condition. They are hidden anyway: at a licensed venue that beverage is as
// likely to be a pint as a Coke, and this file's rule for what it cannot tell apart is to hide.
const VENUE_DRINK_WORDS = ["beverage", "bevvie", "drink", "libation", "refreshment"];
const VENUE_DRINK_PATTERN = new RegExp(`(?<![\\p{L}])(?:${VENUE_DRINK_WORDS.join("|")})s?(?![\\p{L}])`, "iu");

// A beverage named as a CONDITION of a food offer, which is not a reference to alcohol.
//
// The rule above was too blunt on its own. "Half-price wings with beverage purchase" is a wing
// night: the beverage is what you have to buy, not what is on offer, and nothing says it is
// alcohol. St. Louis Bar & Grill writes "any regularly priced beverage" and means it; a Montana's
// wing or taco night is satisfied by a soft drink. Withholding those answered "does this sentence
// contain the word beverage" when the question is "does this deal reference alcohol".
//
// Measured across the live catalog before the change: sixteen deals were withheld by this rule
// alone, and fifteen were wing or dish nights at seven pubs whose only drink word sat inside a
// purchase condition.
//
// The sixteenth is why the rule is narrowed rather than dropped. Beyond the Pale's "15% off food
// & drinks" is a brewery taproom discounting its own beer — there the drink is the object of the
// offer, no "with" or "purchase" attaches to it, and it stays withheld. That deal is the reason
// the venue-drink rule was written, and it is still doing its job.
//
// Deliberately narrow, like FOOD_PHRASES above: only the whole condition phrase is stripped, and
// the drink word has to be bound to a purchase by "with", "requires", "purchase of" or "must be
// purchased". The bare word still counts everywhere else.
const DRINK_WORDS_ALT = VENUE_DRINK_WORDS.join("|");
const DRINK_CONDITION = new RegExp(
  [
    // "with beverage purchase", "with the purchase of any regularly priced drink", "with a drink"
    `with\\s+(?:the\\s+)?(?:purchase\\s+of\\s+)?(?:any\\s+|a\\s+|an\\s+)?(?:regularly[\\s-]priced\\s+)?(?:${DRINK_WORDS_ALT})s?(?:\\s+purchase)?`,
    // "requires drink purchase", "requires the purchase of any regularly priced beverage"
    `requires?\\s+(?:the\\s+)?(?:purchase\\s+of\\s+)?(?:any\\s+|a\\s+|an\\s+)?(?:regularly[\\s-]priced\\s+)?(?:${DRINK_WORDS_ALT})s?(?:\\s+purchase)?`,
    // "a beverage must be purchased"
    `(?:a\\s+|an\\s+|any\\s+)?(?:${DRINK_WORDS_ALT})s?\\s+must\\s+be\\s+purchased`,
    // "beverage purchase required", and the bare noun phrase on its own
    `(?:${DRINK_WORDS_ALT})s?\\s+purchase(?:\\s+required)?`,
  ].join("|"),
  "giu",
);

// Drinks, drink containers, and the vocabulary bars use to sell them. Singular only — the pattern
// below allows the plural — and matched whole-word, so "ginger" is not gin and "portion" is not
// port. A few are ambiguous in isolation ("punch" can be fruit punch, "shot" can be espresso);
// they stay, because this rounds toward hiding.
const WORDS = [
  "alcohol", "alcoholic", "ale", "aperitif", "aperitivo", "aperol", "beer", "bellini", "bevvy",
  "booze", "bottle", "bourbon", "brew", "bubbly", "caesar", "carafe", "cava", "champagne", "cider",
  "cocktail", "cooler", "daiquiri", "digestif", "draft", "draught", "gin", "highball", "hooch",
  "ipa", "lager", "liqueur", "liquor", "marg", "margarita", "martini", "mead", "mezcal", "mimosa",
  "mojito", "negroni", "nightcap", "paloma", "pilsner", "pint", "pitcher", "port", "prosecco",
  "punch", "rose", "rosé", "rum", "rye", "sake", "sangria", "scotch", "seltzer", "shooter", "shot",
  "soju", "sour", "sparkling", "spirit", "spritz", "stein", "stout", "tallboy", "tequila",
  "vermouth", "vino", "vodka", "whiskey", "whisky", "wine",
  // Kinds of drink, which a menu prints as often as the word for the drink: "$7 house merlot",
  // "$5 radlers", "$6 Bloody Marys". Added 2026-09-29 with BRANDS. Left out where the word is also
  // food or a place a deal would name: Old Fashioned is a Tim Hortons donut, Manhattan and Long
  // Island are places (the iced tea is here by its full name), Shiraz names Persian restaurants as
  // often as a wine, Marsala and sherry are sauces, and "spiked" is how a menu describes an aioli.
  "absinthe", "amaretto", "amaro", "armagnac", "baijiu", "brandy", "cachaca", "cachaça", "cognac",
  "fernet", "grappa", "limoncello", "makgeolli", "ouzo", "pisco", "sambuca", "schnapps", "shochu",
  "triple sec",
  "albarino", "albariño", "cabernet", "chardonnay", "gewurztraminer", "gewürztraminer", "grenache",
  "icewine", "lambrusco", "malbec", "merlot", "moscato", "pinot", "riesling", "sangiovese",
  "sauvignon", "syrah", "tempranillo", "vinho verde", "viognier", "zinfandel",
  "brewski", "growler", "hefeweizen", "kolsch", "kölsch", "lambic", "radler", "shandy", "tall can",
  "tallcan", "weissbier", "witbier",
  "black russian", "bloody mary", "caipirinha", "chelada", "cuba libre", "french 75", "frosé",
  "gimlet", "hard iced tea", "hard kombucha", "hard lemonade", "hot toddy", "julep",
  "long island iced tea", "long island ice tea", "mai tai", "michelada", "moscow mule",
  "pina colada", "piña colada", "sazerac", "tom collins", "white russian",
  "boozy", "tipsy",
  "biere", "bière", "cerveza", "cidre", "sangría", "vin blanc", "vin rouge",
];

// Drinks sold by name. "$5 Corona Extra", "$7 Michelob Ultra" and "$6 Budweiser" all read as no
// drink at all until 2026-09-29, when eleven live deals named a beer this way and showed in the
// 13+ catalog: ten Kelseys and Montana's promotions that had been entered by brand, and Broadway's
// "Bud & a pound of wings". drizzle/0054 reworded the ten and 0055 archives Broadway's, which was
// also one price for food and a beer. This is what catches the next one.
//
// Only names that mean the drink and nothing else a deal would mean by them, because a brand that
// is also a word, a person or a place hides that thing along with it. Left out on that test:
// Stella (Stella's Cafe is a Winnipeg breakfast chain; Stella Artois is here by its full name),
// Blue Moon (diners), Carling (Ottawa's Carling Avenue, where Radar lists a Swiss Chalet), Lone
// Star (a restaurant chain Radar lists), Miller, Busch and Keith's (surnames; their beers are here
// by full name), Moretti (Moretti's pizzerias), Sapporo, Asahi, Kirin, Tsingtao and Pacifico
// (cities, a ramen style, restaurant names), Kahlua without its accent (kalua pork is spelled that
// way often enough), Campari (the tomato), Southern Comfort (southern comfort food), Fireball (a
// candy), Tito's (Tito's Tacos) and El Jimador (an agave harvester, and a Mexican grill Radar
// lists). A drink these miss is still caught when the copy also says beer, pint, shot or bottle,
// which it nearly always does; the food they would hide has no second chance.
//
// NOT_DRINKS runs first, which is what makes "bud" safe beside "taste buds" and "Bud's Burgers".
const BRANDS = [
  // Beer
  "alexander keith", "amstel", "birra moretti", "boddingtons", "bud", "bud light", "bud lite",
  "budweiser", "busch light", "carlsberg", "chimay", "coors", "corona", "coronita", "dos equis",
  "duvel", "grolsch", "guinness", "heineken", "hoegaarden", "keystone light", "kokanee",
  "kronenbourg", "labatt", "lagunitas", "leffe", "michelob", "miller high life", "miller light",
  "miller lite", "modelo", "molson", "moosehead", "natty light", "pabst", "paulaner", "pbr",
  "peroni", "rolling rock", "sam adams", "samuel adams", "shiner bock", "shock top", "sleeman",
  "smithwick", "spaten", "steam whistle", "stella artois", "tecate", "tuborg", "yuengling",
  // Cider, seltzer and malt drinks
  "angry orchard", "bulmers", "magners", "mike's hard", "nutrl", "nütrl", "somersby", "strongbow",
  "twisted tea", "white claw",
  // Spirits and liqueurs
  "absolut", "bacardi", "baileys", "bombay sapphire", "buffalo trace", "bulleit", "canadian club",
  "captain morgan", "casamigos", "cointreau", "courvoisier", "crown royal", "cuervo", "disaronno",
  "frangelico", "glenfiddich", "glenlivet", "grand marnier", "grey goose", "hennessy", "hornitos",
  "jack daniel", "jager bomb", "jagerbomb", "jagermeister", "jäger bomb", "jägerbomb",
  "jägermeister", "jameson", "jim beam", "johnnie walker", "kahlúa", "ketel one", "knob creek",
  "macallan", "maker's mark", "patrón", "pimm's", "remy martin", "rémy martin", "sailor jerry",
  "smirnoff", "svedka", "tanqueray", "woodford reserve",
];

// A vocabulary as one alternation, factored by shared prefixes: "bud", "bud light", "bud lite" and
// "budweiser" become bud(?:[\s-]+li(?:ght|te)|weiser)?. The regex engine tries a flat alternation's
// every entry at the start of every word it reads. At 263 entries that took 1.7 ms a pass over the
// catalog against the old 73-word pattern's 0.75 (measured locally), on a Worker with a tight
// per-request CPU allowance that runs this over every deal whenever drinks are hidden.
// Factored, a word follows one branch, and the pass takes 0.7. Between words any run of spaces or
// a hyphen matches ("Bud-Light"), and an apostrophe is optional ("Jack Daniel's", "Jack Daniels").
type Trie = { end: boolean; next: Map<string, Trie> };
function alternation(entries: string[]): string {
  const root: Trie = { end: false, next: new Map() };
  for (const entry of entries) {
    let node = root;
    for (const char of entry) {
      let child = node.next.get(char);
      if (!child) node.next.set(char, (child = { end: false, next: new Map() }));
      node = child;
    }
    node.end = true;
  }
  const piece = (char: string) => (char === " " ? "[\\s-]+" : char === "'" ? "['’]?" : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const emit = (node: Trie): string => {
    const branches = [...node.next].map(([char, child]) => piece(char) + emit(child));
    if (!branches.length) return "";
    const group = branches.length > 1 || node.end ? `(?:${branches.join("|")})` : branches[0];
    return node.end ? `${group}?` : group;
  };
  return emit(root);
}

// Built once. Word-bounded on both sides, with an optional plural: "$5 drafts" is a real line from
// the catalog and a list of singulars alone would have walked straight past it. Writing the
// plural into the pattern rather than into the list means a word added later is covered in both
// forms without anyone remembering to add two.
const PATTERN = new RegExp(`(?<![\\p{L}])(?:${alternation([...WORDS, ...BRANDS])})s?(?![\\p{L}])`, "iu");

/** Whether a cuisine describes a place people go to drink. */
function isDrinkingVenue(cuisine: string): boolean {
  if (VENUE_PATTERN.test(cuisine.replace(FOOD_BARS, " "))) return true;
  // And a freeform cuisine that names the drink itself — "Beer & Wings" — is one of these too.
  return PATTERN.test(cuisine);
}

/**
 * The fields of a deal referencesAlcohol reads, less a chain's per-branch offers.
 *
 * Exported for the list endpoint, which keeps this function's answer about a card only while the
 * card still prints exactly its deals' words in these fields (DRINK_VERDICTS in
 * app/api/deals/route.ts). `Readable` below is built from this list, so a field the check starts to
 * read has to be added here, and that comparison takes it in without anyone remembering to.
 */
export const READABLE_FIELDS = ["restaurant", "title", "price", "description", "category", "cuisine", "terms", "restrictions", "schedule"] as const;

/** Every string on a deal a person can actually read, including the per-branch offers on a chain. */
type Readable = { [Field in (typeof READABLE_FIELDS)[number]]?: string | null } & {
  brand_offers?: Array<{ title?: string | null; price?: string | null; category?: string | null }> | null;
};

/**
 * Whether this deal references alcohol.
 *
 * Checked against the copy the app displays rather than any internal field, because the claim
 * being made to Apple is about what a user encounters on screen — a deal whose title reads
 * "$6 pints" is an alcohol reference no matter how it is tagged in the database.
 */
export function referencesAlcohol(deal: Readable): boolean {
  if (CATEGORIES.has(String(deal.category || "").trim().toLowerCase())) return true;

  // A chain deal shows its branches' offers on the same screen, so one branch pouring pints makes
  // the whole card an alcohol reference — filtering the parent and leaving the children visible
  // would defeat the point.
  //
  // Read through the same exceptions as the deal's own copy. They were once applied to the deal
  // and not to its offers, so a sibling offer titled "Chicken Caesar wrap" passed on its own row
  // and then hid the whole card it sat on.
  for (const offer of deal.brand_offers || []) {
    if (CATEGORIES.has(String(offer?.category || "").trim().toLowerCase())) return true;
    const offerCopy = [offer?.title, offer?.price].filter(Boolean).join(" ");
    if (PATTERN.test(offerCopy) && PATTERN.test(readable(offerCopy))) return true;
  }

  // The restaurant's own name is the largest text on the card, so it is copy like any other.
  // Leaving it out let "Quinn's Ale House" and "Fiesta & Tequila" sit in the 13+ catalog: the
  // deals under them are wings and a student discount, genuinely food, but the word on screen is
  // the drink. A proper noun is still a reference, and this module's whole premise is that what
  // decides is what a reader encounters, not how a row is tagged.
  //
  // Measured before it was added, across every restaurant carrying a live deal: a handful of names
  // match, and all of them are real - CRAFT Beer Market, Clocktower Brew Pub, Fin-Two Japanese
  // Ale-House, Stolen Goods Cocktail Bar, The Wine Bar at Beckta, and the two above. No false
  // positive, because the narrow food exceptions below already cover the one name that would
  // have been one: `Little Caesars` is stripped with the rest of FOOD_PHRASES.
  const printed = [deal.restaurant, deal.title, deal.price, deal.description, deal.terms, deal.restrictions, deal.schedule]
    .filter(Boolean)
    .join(" ");
  // Most copy names no drink word at all, and then there is nothing to set aside: readable() only
  // ever removes a drink word that isn't one. Skipping it there keeps the exceptions off the cost
  // of the deals they cannot change, which is most of them.
  const named = PATTERN.test(printed);
  const copy = named ? readable(printed) : printed;

  // What the deal itself says still decides first, and still rounds toward hiding.
  if (named && PATTERN.test(copy)) return true;

  // Then the venue. A drinking venue used to be sufficient on its own, which is the rule that hid
  // 76 wing nights: it was answering "is this a bar" when the question is "is this about drink".
  //
  // It is not simply dropped, because the case it was written for is real — a wine bar's "house
  // special" needs no keyword to be a drink, and nothing in the copy would say otherwise. So the
  // venue still flags, and a deal escapes it only by naming food outright. That keeps the vague
  // deal at a wine bar hidden while letting "85¢ wing Wednesday" through, and it means the
  // asymmetry this module is built on is unchanged: silence at a bar is still read as a drink.
  if (isDrinkingVenue(String(deal.cuisine || ""))) {
    // Food is looked for in the copy as printed. The phrases set aside above name food outright -
    // a Scotch egg, a chicken caesar, a shrimp cocktail, all pub menu staples - and reading the
    // copy without them would leave nothing to escape the venue rule with.
    if (!FOOD_PATTERN.test(printed)) return true;
    // It names food, and at a bar a drink word alongside it still decides — but only when the
    // drink is part of the offer rather than a condition on it. "15% off food & drinks" at a
    // taproom is a discount on beer; "half-price wings with beverage purchase" is a wing night
    // whose till requires you to buy something to drink, which may well be a Coke. Stripping the
    // condition phrase is what tells those two apart. See DRINK_CONDITION.
    if (VENUE_DRINK_PATTERN.test(copy.replace(DRINK_CONDITION, " "))) return true;
  }

  return false;
}
