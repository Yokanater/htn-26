/** Equal launch-domain configuration. Owner: L3. Domain-specific UI copy, one shared pipeline. */
import type { ItemConstraint, ShoppingDomain } from '@sei/contracts';

export interface ShoppingDomainConfig {
  label: string;
  exampleCategories: readonly string[];
  constraintKinds: readonly ItemConstraint['kind'][];
  confirmationHint: string;
}

export const SHOPPING_DOMAINS = {
  outfit: {
    label: 'Outfits',
    exampleCategories: ['top', 'bottom', 'footwear', 'bag'],
    constraintKinds: ['size', 'exclude_material'],
    confirmationHint: 'Confirm the items you want and enter sizes; a photo cannot establish fit.',
  },
  setup: {
    label: 'Any products',
    exampleCategories: ['headphones', 'camera', 'sports gear', 'kitchenware', 'furniture'],
    constraintKinds: ['dimension', 'mounting', 'exclude_material'],
    confirmationHint: 'Confirm the items you want and enter dimensions or mounting restrictions.',
  },
} as const satisfies Record<ShoppingDomain, ShoppingDomainConfig>;
