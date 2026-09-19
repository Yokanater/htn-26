/** Accessible alternative offer picker. Owner: L1 (S2-L1-2 C2). */
import type { ProductOffer } from '@sei/contracts';
import { ProductTile } from './ProductTile';

export type AlternativePickerProps = {
  offers: readonly ProductOffer[];
  selectedOfferId: string | null;
  onSelect: (offerId: string) => void;
  onOpenEvidence?: (offerId: string) => void;
  now?: Date;
  evidenceTtlMs?: number;
  label?: string;
};

export function AlternativePicker({
  offers,
  selectedOfferId,
  onSelect,
  onOpenEvidence,
  now,
  evidenceTtlMs,
  label = 'Product alternatives',
}: AlternativePickerProps) {
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Each alternative is a specific merchant variant. Selecting one does not create a unified
        cart across stores.
      </p>
      <ul className="flex list-none flex-col gap-3 p-0">
        {offers.map((offer) => (
          <li key={offer.id}>
            <ProductTile
              offer={offer}
              selected={offer.id === selectedOfferId}
              onSelect={onSelect}
              onOpenEvidence={onOpenEvidence}
              now={now}
              evidenceTtlMs={evidenceTtlMs}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
