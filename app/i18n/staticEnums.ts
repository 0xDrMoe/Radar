// Category and cuisine are small, fixed vocabularies (see app/cuisines.ts and the admin editor's
// category <select>), not free text — so they're hand-translated once here rather than run
// through the per-deal translation API on every save. `deals.category`/`deals.cuisine` stay the
// canonical English values everywhere internally (filtering, facets, URL query params); these
// dictionaries only produce a display label for a given locale.
import type { Cuisine } from "../cuisines";

export const CATEGORY_LABELS: Record<string, Record<"fr" | "es", string>> = {
  "Happy hour": { fr: "Heure de l'apéro", es: "Hora feliz" },
  "Food deal": { fr: "Offre repas", es: "Oferta de comida" },
  Tonight: { fr: "Ce soir", es: "Esta noche" },
};

export const CUISINE_LABELS: Record<Cuisine, Record<"fr" | "es", string>> = {
  American: { fr: "Américaine", es: "Estadounidense" },
  "Bar & Pub": { fr: "Bar et pub", es: "Bar y pub" },
  BBQ: { fr: "BBQ", es: "Barbacoa" },
  Bakery: { fr: "Boulangerie", es: "Panadería" },
  "Breakfast & Brunch": { fr: "Déjeuner et brunch", es: "Desayuno y brunch" },
  Burgers: { fr: "Burgers", es: "Hamburguesas" },
  "Cafe & Coffee": { fr: "Café", es: "Café" },
  Canadian: { fr: "Canadienne", es: "Canadiense" },
  Caribbean: { fr: "Caribéenne", es: "Caribeña" },
  Chinese: { fr: "Chinoise", es: "China" },
  Deli: { fr: "Charcuterie fine", es: "Delicatessen" },
  Dessert: { fr: "Dessert", es: "Postres" },
  Diner: { fr: "Restaurant familial", es: "Restaurante informal" },
  "Fast Food": { fr: "Restauration rapide", es: "Comida rápida" },
  French: { fr: "Française", es: "Francesa" },
  Greek: { fr: "Grecque", es: "Griega" },
  Indian: { fr: "Indienne", es: "India" },
  Italian: { fr: "Italienne", es: "Italiana" },
  Japanese: { fr: "Japonaise", es: "Japonesa" },
  Korean: { fr: "Coréenne", es: "Coreana" },
  "Latin American": { fr: "Latino-américaine", es: "Latinoamericana" },
  Mediterranean: { fr: "Méditerranéenne", es: "Mediterránea" },
  Mexican: { fr: "Mexicaine", es: "Mexicana" },
  "Middle Eastern": { fr: "Moyen-orientale", es: "Medio Oriente" },
  Pizza: { fr: "Pizza", es: "Pizza" },
  Ramen: { fr: "Ramen", es: "Ramen" },
  Seafood: { fr: "Fruits de mer", es: "Mariscos" },
  Spanish: { fr: "Espagnole", es: "Española" },
  Steakhouse: { fr: "Grilladerie", es: "Asador" },
  Sushi: { fr: "Sushi", es: "Sushi" },
  Thai: { fr: "Thaïlandaise", es: "Tailandesa" },
  "Vegan & Vegetarian": { fr: "Végane et végétarienne", es: "Vegana y vegetariana" },
  Vietnamese: { fr: "Vietnamienne", es: "Vietnamita" },
  "Wine Bar": { fr: "Bar à vin", es: "Bar de vinos" },
  Other: { fr: "Autre", es: "Otra" },
};

// Values outside CUISINES that rows still carry. The catalogue predates the dropdown, and the
// admin's "Other" takes free text, so deals.cuisine is not limited to the list above - and a value
// with no label here was shown in English on /fr and /es, on the card, the deal page and the
// cuisine filter. Moving a deal onto a canonical value instead is not a label change: a deal's
// cuisine decides whether app/alcohol.ts treats it as a drinking venue, and drizzle/0058 moved
// only the ones each restaurant's own site settled. So the rest are translated as they stand.
//
// The first five are every non-canonical value on a live deal in the production catalogue of
// 2026-10-01 (tests/cuisine-labels.test.mjs holds that list); the others are on drafts and
// archived rows, so publishing one does not bring an English label back.
//
// Each label stands alone, as the canonical ones do: it is a card pill and a dropdown entry, and it
// goes into the deal page's fallback sentence ("Oferta de {cuisine} en {city}", "Offre {cuisine} à
// {city}"), where a label opening on "Del" read "Oferta de Del sur de EE. UU.".
export const LEGACY_CUISINE_LABELS: Record<string, Record<"fr" | "es", string>> = {
  Contemporary: { fr: "Contemporaine", es: "Contemporánea" },
  Global: { fr: "Internationale", es: "Internacional" },
  "Southeast Asian": { fr: "Sud-Est asiatique", es: "Sudeste asiático" },
  Southern: { fr: "Sud des États-Unis", es: "Sureña (EE. UU.)" },
  "Tex-Mex": { fr: "Tex-mex", es: "Tex-mex" },
  Asian: { fr: "Asiatique", es: "Asiática" },
  "Asian Fusion": { fr: "Fusion asiatique", es: "Fusión asiática" },
  Belgian: { fr: "Belge", es: "Belga" },
  Brewpub: { fr: "Microbrasserie", es: "Cervecería artesanal" },
  German: { fr: "Allemande", es: "Alemana" },
  "Spanish & Latin": { fr: "Espagnole et latine", es: "Española y latina" },
  Vegetarian: { fr: "Végétarienne", es: "Vegetariana" },
  "Wine bar": CUISINE_LABELS["Wine Bar"],
};

export function categoryLabel(category: string, locale: string): string {
  if (locale !== "fr" && locale !== "es") return category;
  return CATEGORY_LABELS[category]?.[locale] || category;
}

export function cuisineLabel(cuisine: string, locale: string): string {
  if (locale !== "fr" && locale !== "es") return cuisine;
  return CUISINE_LABELS[cuisine as Cuisine]?.[locale] || LEGACY_CUISINE_LABELS[cuisine]?.[locale] || cuisine;
}
