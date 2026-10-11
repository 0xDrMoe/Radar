// Canonical cuisine list for the deal editor's cuisine dropdown and for normalizing
// free-text data entered before this list existed. "Other" is always the last option
// and pairs with a follow-up freeform field in the editor.
export const CUISINES = [
  "American",
  "Bar & Pub",
  "BBQ",
  "Bakery",
  "Breakfast & Brunch",
  "Burgers",
  "Cafe & Coffee",
  "Canadian",
  "Caribbean",
  "Chinese",
  "Deli",
  "Dessert",
  "Diner",
  "Fast Food",
  "French",
  "Greek",
  "Indian",
  "Italian",
  "Japanese",
  "Korean",
  "Latin American",
  "Mediterranean",
  "Mexican",
  "Middle Eastern",
  "Pizza",
  "Ramen",
  "Seafood",
  "Spanish",
  "Steakhouse",
  "Sushi",
  "Thai",
  "Vegan & Vegetarian",
  "Vietnamese",
  "Wine Bar",
  "Other",
] as const;

export type Cuisine = (typeof CUISINES)[number];

export function isKnownCuisine(value: string): value is Cuisine {
  return (CUISINES as readonly string[]).includes(value);
}
