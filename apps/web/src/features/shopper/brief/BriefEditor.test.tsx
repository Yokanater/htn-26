import { type IntentBrief, IntentBriefSchema } from '@sei/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import outfitFixture from '../../../../../../fixtures/seed/outfit/brief.json';
import setupFixture from '../../../../../../fixtures/seed/setup/brief.json';
import { BriefEditor, type DomainHint } from './BriefEditor';

const hints: DomainHint[] = [
  {
    label: 'Outfit',
    exampleCategories: ['top'],
    constraintKinds: ['size', 'exclude_material'],
    confirmationHint: 'Confirm your size.',
  },
  {
    label: 'Setup',
    exampleCategories: ['desk'],
    constraintKinds: ['dimension', 'mounting', 'exclude_material'],
    confirmationHint: 'Confirm room measurements.',
  },
];

const outfit = IntentBriefSchema.parse(outfitFixture);
const setup = IntentBriefSchema.parse(setupFixture);

afterEach(cleanup);

function renderEditor(brief: IntentBrief) {
  const onSave = vi.fn();
  const onConfirm = vi.fn();
  render(<BriefEditor brief={brief} hints={hints} onConfirm={onConfirm} onSave={onSave} />);
  return { onConfirm, onSave };
}

describe('BriefEditor', () => {
  it.each([outfit, setup])(
    'renders an editable %s.domain brief without confirmation on mount',
    (brief) => {
      const { onConfirm } = renderEditor(brief);
      expect(screen.getByLabelText('Edit intent brief')).toBeTruthy();
      expect(screen.getByText(/photo cannot establish fit or dimensions/i)).toBeTruthy();
      expect((screen.getByLabelText('Item 1 category') as HTMLInputElement).value).toBe(
        brief.slots[0]?.category ?? '',
      );
      expect(onConfirm).not.toHaveBeenCalled();
    },
  );

  it('renders an image-input brief through the same editor and never confirms an edit or save', () => {
    const imageBrief = IntentBriefSchema.parse({
      ...outfit,
      input: { kind: 'image', assetId: 'asset_test_image' },
      status: 'draft',
    });
    const { onConfirm, onSave } = renderEditor(imageBrief);
    fireEvent.change(screen.getByLabelText('Item 1 category'), { target: { value: 'shirt' } });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm brief' }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed', input: imageBrief.input }),
    );
  });

  it('enforces add/remove limits and does not mutate the input brief', () => {
    const source = structuredClone(outfit);
    renderEditor(source);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove item' })[0]!);
    expect(
      screen
        .getAllByRole('button', { name: 'Remove item' })
        .every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
    for (let index = 0; index < 5; index += 1)
      fireEvent.click(screen.getByRole('button', { name: 'Add missed item' }));
    expect(screen.getAllByRole('group', { name: /Item/ })).toHaveLength(6);
    expect(
      (screen.getByRole('button', { name: 'Add missed item' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(source).toEqual(outfit);
  });

  it('requires at least one required item and announces inline validation errors', () => {
    const { onConfirm } = renderEditor(outfit);
    for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
    expect(screen.getByRole('status').textContent).toContain('At least one slot must be required');
    expect(
      (screen.getByRole('button', { name: 'Confirm brief' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('offers only outfit constraints for outfits and setup constraints for setups', () => {
    renderEditor(outfit);
    expect(screen.getByLabelText('Item 1 size')).toBeTruthy();
    expect(screen.queryByLabelText('Item 1 dimension axis')).toBeNull();
    expect(screen.queryByLabelText('Item 1 mounting')).toBeNull();
    cleanup();
    renderEditor(setup);
    expect(screen.queryByLabelText('Item 1 size')).toBeNull();
    expect(screen.getByLabelText('Item 1 dimension axis')).toBeTruthy();
    expect(screen.getByLabelText('Item 1 mounting')).toBeTruthy();
  });

  it('uses native labeled controls that can receive keyboard focus', () => {
    renderEditor(setup);
    const category = screen.getByLabelText('Item 1 category');
    category.focus();
    expect(document.activeElement).toBe(category);
    expect(screen.getByRole('button', { name: 'Add missed item' }).tagName).toBe('BUTTON');
  });
});
