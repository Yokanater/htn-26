import type { StoreProfile } from "../contracts.js";

/** "Now" for fixture runs, so freshness scoring is deterministic. */
export const FIXTURE_NOW = new Date("2026-09-19T12:00:00Z");

export const coffeeProfile: StoreProfile = {
  store_url: "https://alderashcoffee.example",
  domain: "alderashcoffee.example",
  brand_name: "Alder & Ash Coffee",
  shopify_confidence: 0.96,
  categories: ["specialty coffee", "whole bean coffee", "coffee subscription"],
  products: [
    { name: "Ethiopia Guji (340 g)", product_type: "single-origin whole bean", price_min: 21, price_max: 21, currency: "CAD" },
    { name: "House Espresso Blend (340 g)", product_type: "blend whole bean", price_min: 19, price_max: 19, currency: "CAD" },
    { name: "Swiss Water Decaf (340 g)", product_type: "decaf whole bean", price_min: 22, price_max: 22, currency: "CAD" },
    { name: "Cold Brew Concentrate (1 L)", product_type: "ready to drink", price_min: 16, price_max: 16, currency: "CAD" },
    { name: "Roaster's Choice Subscription", product_type: "subscription", price_min: 17, price_max: 21, currency: "CAD" },
  ],
  price_position: "premium",
  audiences: ["home brewers", "pour-over and espresso enthusiasts", "gift buyers"],
  geography: ["Canada", "United States"],
  positioning: "Small-batch, light-to-medium roasted, direct-trade specialty coffee sold mainly by subscription.",
  stated_values: ["direct trade", "roast-date transparency", "compostable packaging"],
  differentiators: ["six direct-trade farm relationships", "compostable bags", "flexible subscription"],
  complementary_needs: ["grinding", "brewing hardware", "drinkware", "food pairings", "gifting"],
};
