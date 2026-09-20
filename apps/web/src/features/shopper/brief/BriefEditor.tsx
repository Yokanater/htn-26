import {
  type IntentBrief,
  IntentBriefSchema,
  type IntentSlot,
  type ItemConstraint,
  newId,
} from '@sei/contracts';
import { ArrowRight, ChevronDown, Plus, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SlotSymbol } from '../../../StudioArtwork';

export type DomainHint = {
  label: string;
  exampleCategories: string[];
  constraintKinds: string[];
  confirmationHint: string;
};

type BriefEditorProps = {
  brief: IntentBrief;
  hints: DomainHint | DomainHint[];
  onSave: (edited: IntentBrief) => void;
  onConfirm: (edited: IntentBrief) => void;
  disabled?: boolean;
};

function updateSlot(brief: IntentBrief, index: number, update: (slot: IntentSlot) => IntentSlot) {
  return {
    ...brief,
    slots: brief.slots.map((slot, slotIndex) => (slotIndex === index ? update(slot) : slot)),
  };
}

function getTextConstraint(slot: IntentSlot, kind: 'size' | 'exclude_material') {
  const constraint = slot.constraints.find(
    (value): value is Extract<ItemConstraint, { kind: typeof kind }> => value.kind === kind,
  );
  const value = constraint?.value ?? '';
  if (kind !== 'size') return value;
  const labels: Record<string, string> = {
    XS: 'Extra small',
    S: 'Small',
    M: 'Medium',
    L: 'Large',
    XL: 'Extra large',
    XXL: 'Double extra large',
    XXXL: 'Triple extra large',
  };
  return labels[value.toUpperCase()] ?? value;
}

function setTextConstraint(
  slot: IntentSlot,
  kind: 'size' | 'exclude_material',
  value: string,
): IntentSlot {
  const rest = slot.constraints.filter((constraint) => constraint.kind !== kind);
  return { ...slot, constraints: value.trim() ? [...rest, { kind, value }] : rest };
}

export function BriefEditor({
  brief,
  hints,
  onSave,
  onConfirm,
  disabled = false,
}: BriefEditorProps) {
  const [edited, setEdited] = useState<IntentBrief>(() => structuredClone(brief));
  const result = useMemo(() => IntentBriefSchema.safeParse(edited), [edited]);
  const errors = result.success ? [] : result.error.issues;
  const hintList = Array.isArray(hints) ? hints : [hints];
  const allowedKinds =
    edited.domain === 'outfit'
      ? ['size', 'exclude_material']
      : ['dimension', 'mounting', 'exclude_material'];
  const update = (next: IntentBrief) => setEdited(next);

  function addSlot() {
    if (edited.slots.length >= 6) return;
    update({
      ...edited,
      slots: [
        ...edited.slots,
        {
          id: newId('slot_'),
          category: '',
          description: '',
          required: false,
          visualAttributes:
            edited.slots[0]?.visualAttributes.filter((value) =>
              value.startsWith('Shopping department: '),
            ) ?? [],
          constraints: [],
        },
      ],
    });
  }

  return (
    <form
      aria-label="Edit intent brief"
      onSubmit={(event) => {
        event.preventDefault();
        if (result.success) onSave(result.data);
      }}
    >
      <datalist id="readable-clothing-sizes">
        {['Extra small', 'Small', 'Medium', 'Large', 'Extra large', '2XL', '3XL', 'One size'].map(
          (size) => (
            <option key={size} value={size} />
          ),
        )}
      </datalist>
      {edited.domain === 'outfit' && (
        <label>
          Shop for
          <select
            aria-label="Shopping department"
            disabled={disabled}
            value={
              edited.slots[0]?.visualAttributes
                .find((value) => value.startsWith('Shopping department: '))
                ?.slice('Shopping department: '.length) ?? ''
            }
            onChange={(event) =>
              update({
                ...edited,
                slots: edited.slots.map((slot) => ({
                  ...slot,
                  visualAttributes: [
                    ...slot.visualAttributes.filter(
                      (value) => !value.startsWith('Shopping department: '),
                    ),
                    ...(event.target.value ? [`Shopping department: ${event.target.value}`] : []),
                  ],
                })),
              })
            }
          >
            <option value="">Use item descriptions / no preference</option>
            <option value="men">Menswear</option>
            <option value="women">Womenswear</option>
            <option value="unisex">Unisex</option>
            <option value="kids">Kids</option>
          </select>
          <small>
            Choose the product department; we do not infer it from the person in a photo.
          </small>
        </label>
      )}
      <div className="review-list-heading">
        <span>{edited.slots.length} pieces to find</span>
        <span>Curated from your idea</span>
      </div>
      {edited.slots.map((slot, slotIndex) => {
        const dimension = slot.constraints.find((constraint) => constraint.kind === 'dimension');
        const mounting = slot.constraints.find((constraint) => constraint.kind === 'mounting');
        return (
          <fieldset className="editor-item" key={slot.id} disabled={disabled}>
            <legend className="sr-only">Item {slotIndex + 1}</legend>
            <details className="piece-details">
              <summary className="piece-summary">
                <span className={`piece-symbol ${edited.domain}`} aria-hidden="true">
                  <SlotSymbol category={slot.category} domain={edited.domain} />
                </span>
                <span className="piece-copy">
                  <span className="piece-category">{slot.category || 'New item'}</span>
                  <strong>{slot.description || 'What would you like to find?'}</strong>
                  <span className="piece-attributes">
                    {[...new Set(slot.visualAttributes)].join(' · ')}
                  </span>
                </span>
                <span className="piece-edit">
                  Edit details <ChevronDown aria-hidden="true" />
                </span>
              </summary>
              <div className="piece-fields">
                <label>
                  Category
                  <input
                    aria-label={`Item ${slotIndex + 1} category`}
                    value={slot.category}
                    onChange={(event) =>
                      update(
                        updateSlot(edited, slotIndex, (current) => ({
                          ...current,
                          category: event.target.value,
                        })),
                      )
                    }
                  />
                </label>
                <label>
                  Description
                  <textarea
                    aria-label={`Item ${slotIndex + 1} description`}
                    value={slot.description}
                    onChange={(event) =>
                      update(
                        updateSlot(edited, slotIndex, (current) => ({
                          ...current,
                          description: event.target.value,
                        })),
                      )
                    }
                  />
                </label>
                <label>
                  Colors, materials & style
                  <input
                    aria-label={`Item ${slotIndex + 1} visual attributes`}
                    value={slot.visualAttributes.join(', ')}
                    onChange={(event) =>
                      update(
                        updateSlot(edited, slotIndex, (current) => ({
                          ...current,
                          visualAttributes: event.target.value
                            .split(',')
                            .map((value) => value.trim())
                            .filter(Boolean),
                        })),
                      )
                    }
                  />
                </label>
                <label className="required-control">
                  <input
                    aria-label={`Item ${slotIndex + 1} must be included`}
                    checked={slot.required}
                    type="checkbox"
                    onChange={(event) =>
                      update(
                        updateSlot(edited, slotIndex, (current) => ({
                          ...current,
                          required: event.target.checked,
                        })),
                      )
                    }
                  />
                  <span>
                    Must be in my collection
                    <small>A collection counts as complete only when this item has a match.</small>
                  </span>
                </label>
                <fieldset>
                  <legend>
                    {edited.domain === 'outfit' ? 'Fit & preferences' : 'Space & preferences'}
                  </legend>
                  {allowedKinds.includes('size') && (
                    <label>
                      Size
                      <input
                        list="readable-clothing-sizes"
                        placeholder="Medium, Large, Extra large, or a numeric size"
                        aria-label={`Item ${slotIndex + 1} size`}
                        value={getTextConstraint(slot, 'size')}
                        onChange={(event) =>
                          update(
                            updateSlot(edited, slotIndex, (current) =>
                              setTextConstraint(current, 'size', event.target.value),
                            ),
                          )
                        }
                      />
                    </label>
                  )}
                  {allowedKinds.includes('dimension') && (
                    <>
                      <label>
                        Maximum dimension axis
                        <select
                          aria-label={`Item ${slotIndex + 1} dimension axis`}
                          value={dimension?.axis ?? ''}
                          onChange={(event) =>
                            update(
                              updateSlot(edited, slotIndex, (current) => {
                                const rest = current.constraints.filter(
                                  (constraint) => constraint.kind !== 'dimension',
                                );
                                return event.target.value
                                  ? {
                                      ...current,
                                      constraints: [
                                        ...rest,
                                        {
                                          kind: 'dimension',
                                          axis: event.target.value as 'width' | 'depth' | 'height',
                                          maxCm: dimension?.maxCm ?? 1,
                                        },
                                      ],
                                    }
                                  : { ...current, constraints: rest };
                              }),
                            )
                          }
                        >
                          <option value="">No dimension constraint</option>
                          <option value="width">Width</option>
                          <option value="depth">Depth</option>
                          <option value="height">Height</option>
                        </select>
                      </label>
                      <label>
                        Maximum centimetres
                        <input
                          aria-label={`Item ${slotIndex + 1} maximum centimetres`}
                          min="0"
                          type="number"
                          value={dimension?.maxCm ?? ''}
                          onChange={(event) =>
                            update(
                              updateSlot(edited, slotIndex, (current) => {
                                const maxCm = Number(event.target.value);
                                const rest = current.constraints.filter(
                                  (constraint) => constraint.kind !== 'dimension',
                                );
                                return Number.isFinite(maxCm) && maxCm > 0
                                  ? {
                                      ...current,
                                      constraints: [
                                        ...rest,
                                        {
                                          kind: 'dimension',
                                          axis: dimension?.axis ?? 'width',
                                          maxCm,
                                        },
                                      ],
                                    }
                                  : { ...current, constraints: rest };
                              }),
                            )
                          }
                        />
                      </label>
                    </>
                  )}
                  {allowedKinds.includes('mounting') && (
                    <label>
                      Mounting
                      <select
                        aria-label={`Item ${slotIndex + 1} mounting`}
                        value={mounting?.value ?? ''}
                        onChange={(event) =>
                          update(
                            updateSlot(edited, slotIndex, (current) => {
                              const rest = current.constraints.filter(
                                (constraint) => constraint.kind !== 'mounting',
                              );
                              return event.target.value
                                ? {
                                    ...current,
                                    constraints: [
                                      ...rest,
                                      {
                                        kind: 'mounting',
                                        value: event.target.value as 'no_drilling' | 'freestanding',
                                      },
                                    ],
                                  }
                                : { ...current, constraints: rest };
                            }),
                          )
                        }
                      >
                        <option value="">No mounting constraint</option>
                        <option value="no_drilling">No drilling</option>
                        <option value="freestanding">Freestanding</option>
                      </select>
                    </label>
                  )}
                  {allowedKinds.includes('exclude_material') && (
                    <label>
                      Exclude material
                      <input
                        aria-label={`Item ${slotIndex + 1} excluded material`}
                        value={getTextConstraint(slot, 'exclude_material')}
                        onChange={(event) =>
                          update(
                            updateSlot(edited, slotIndex, (current) =>
                              setTextConstraint(current, 'exclude_material', event.target.value),
                            ),
                          )
                        }
                      />
                    </label>
                  )}
                </fieldset>
                <button
                  className="remove-item"
                  disabled={edited.slots.length <= 1}
                  onClick={() =>
                    update({
                      ...edited,
                      slots: edited.slots.filter((_, index) => index !== slotIndex),
                    })
                  }
                  type="button"
                >
                  Remove item
                </button>
              </div>
            </details>
          </fieldset>
        );
      })}
      <button
        className="add-piece"
        disabled={disabled || edited.slots.length >= 6}
        onClick={addSlot}
        type="button"
      >
        <Plus aria-hidden="true" /> Add an item
      </button>
      <div className="sizing-guidance">
        <SlidersHorizontal aria-hidden="true" />
        <div>
          <strong>
            {edited.domain === 'outfit' ? 'Make sure it fits.' : 'Make sure it fits your space.'}
          </strong>
          {hintList.map((hint) => (
            <p key={hint.label}>{hint.confirmationHint} Open an item to adjust its details.</p>
          ))}
          <p id="brief-photo-limit">
            A photo cannot establish fit or dimensions. Confirm those details yourself.
          </p>
        </div>
      </div>
      <div aria-live="polite" role="status">
        {errors.map((error) => (
          <p key={`${error.path.join('.')}-${error.message}`}>
            {error.message === 'At least one slot must be required'
              ? 'Choose at least one item that must be in your collection. Open Edit details to make your choice.'
              : error.message}
          </p>
        ))}
      </div>
      <div className="editor-actions">
        <button disabled={disabled} type="submit">
          Save edits
        </button>
        <button
          disabled={disabled || !result.success}
          onClick={() => {
            if (result.success) onConfirm({ ...result.data, status: 'confirmed' });
          }}
          type="button"
        >
          {disabled ? 'Saving…' : 'Find my collection'} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
