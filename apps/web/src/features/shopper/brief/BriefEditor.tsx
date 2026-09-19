import {
  type IntentBrief,
  IntentBriefSchema,
  type IntentSlot,
  type ItemConstraint,
  newId,
} from '@sei/contracts';
import { useMemo, useState } from 'react';

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

export function BriefEditor({ brief, hints, onSave, onConfirm }: BriefEditorProps) {
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
          visualAttributes: [],
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
      <p id="brief-photo-limit">
        A photo cannot establish fit or dimensions. Confirm those details yourself.
      </p>
      {hintList.map((hint) => (
        <aside key={hint.label} aria-label={`${hint.label} guidance`}>
          <strong>{hint.label}</strong>: {hint.confirmationHint} Examples:{' '}
          {hint.exampleCategories.join(', ')}.
        </aside>
      ))}
      {edited.slots.map((slot, slotIndex) => {
        const dimension = slot.constraints.find((constraint) => constraint.kind === 'dimension');
        const mounting = slot.constraints.find((constraint) => constraint.kind === 'mounting');
        return (
          <fieldset key={slot.id}>
            <legend>Item {slotIndex + 1}</legend>
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
              Visual attributes (comma-separated)
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
            <label>
              <input
                aria-label={`Item ${slotIndex + 1} required`}
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
              Required
            </label>
            <fieldset>
              <legend>Constraints</legend>
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
                                    { kind: 'dimension', axis: dimension?.axis ?? 'width', maxCm },
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
              disabled={edited.slots.length <= 1}
              onClick={() =>
                update({ ...edited, slots: edited.slots.filter((_, index) => index !== slotIndex) })
              }
              type="button"
            >
              Remove item
            </button>
          </fieldset>
        );
      })}
      <button disabled={edited.slots.length >= 6} onClick={addSlot} type="button">
        Add missed item
      </button>
      <div aria-live="polite" role="status">
        {errors.map((error) => (
          <p key={`${error.path.join('.')}-${error.message}`}>{error.message}</p>
        ))}
      </div>
      <button type="submit">Save edits</button>
      <button
        disabled={!result.success}
        onClick={() => {
          if (result.success) onConfirm({ ...result.data, status: 'confirmed' });
        }}
        type="button"
      >
        Confirm brief
      </button>
    </form>
  );
}
