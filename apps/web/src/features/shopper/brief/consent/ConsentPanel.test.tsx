import { type ConsentRecord, IntentBriefSchema } from '@sei/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import outfitFixture from '../../../../../../../fixtures/seed/outfit/brief.json';
import setupFixture from '../../../../../../../fixtures/seed/setup/brief.json';
import { BriefEditor } from '../BriefEditor';
import { ConsentPanel } from './ConsentPanel';

const outfit = IntentBriefSchema.parse(outfitFixture);
const setup = IntentBriefSchema.parse(setupFixture);
const granted: ConsentRecord = {
  sessionId: 'sess_consent_test',
  version: 1,
  state: 'granted',
  updatedAt: '2026-09-19T12:00:00.000Z',
};

afterEach(cleanup);

function callbacks(overrides = {}) {
  return {
    onGrant: vi.fn().mockResolvedValue({ ok: true }),
    onWithdraw: vi.fn().mockResolvedValue({ ok: true }),
    onDeleteSession: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function renderPanel(consent: ConsentRecord | null, overrides = {}) {
  const actions = callbacks(overrides);
  render(<ConsentPanel consent={consent} {...actions} />);
  return actions;
}

describe('ConsentPanel', () => {
  it.each([outfit, setup])('starts unselected for the %s.domain domain', (_brief) => {
    renderPanel(null);
    const optIn = screen.getByRole('checkbox', { name: /i agree to share/i }) as HTMLInputElement;
    expect(optIn.checked).toBe(false);
    // State line renders with a nested <strong>; assert presence more flexibly
    const region = screen.getByRole('region', { name: 'Sharing preferences' });
    expect(region.textContent?.toLowerCase()).toContain('current state:');
    expect(region.textContent?.toLowerCase()).toContain('not granted');
    expect(screen.getByText(/matching/i)).toBeTruthy();
  });

  it('grants, withdraws, and displays the new re-consent version', async () => {
    const actions = renderPanel(null);
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree to share/i }));
    fireEvent.click(screen.getByRole('button', { name: /opt in to aggregate insights/i }));
    await vi.waitFor(() => expect(actions.onGrant).toHaveBeenCalledOnce());

    cleanup();
    const withdraw = renderPanel(granted);
    fireEvent.click(screen.getByRole('button', { name: /withdraw consent/i }));
    await vi.waitFor(() => expect(withdraw.onWithdraw).toHaveBeenCalledOnce());

    cleanup();
    renderPanel({ ...granted, version: 2, state: 'granted' });
    expect(screen.getByText(/consent version 2/i)).toBeTruthy();
  });

  it('requires confirmation before deleting session data', async () => {
    const actions = renderPanel(granted);
    fireEvent.click(screen.getByRole('button', { name: 'Delete my data' }));
    expect(actions.onDeleteSession).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Confirm data deletion' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /confirm delete my data/i }));
    await vi.waitFor(() => expect(actions.onDeleteSession).toHaveBeenCalledOnce());
  });

  it.each([outfit, setup])('does not block the %s.domain brief editor when opting out', (brief) => {
    render(
      <>
        <BriefEditor hints={[]} brief={brief} onConfirm={vi.fn()} onSave={vi.fn()} />
        <ConsentPanel consent={null} {...callbacks()} />
      </>,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree to share/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree to share/i }));
    const category = screen.getByLabelText('Item 1 category');
    fireEvent.change(category, { target: { value: 'updated category' } });
    expect((category as HTMLInputElement).value).toBe('updated category');
  });

  it('shows callback failures inline without disabling the brief editor', async () => {
    const failed = callbacks({ onGrant: vi.fn().mockRejectedValue(new Error('offline')) });
    render(
      <>
        <BriefEditor hints={[]} brief={outfit} onConfirm={vi.fn()} onSave={vi.fn()} />
        <ConsentPanel consent={null} {...failed} />
      </>,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /i agree to share/i }));
    fireEvent.click(screen.getByRole('button', { name: /opt in to aggregate insights/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent || '').toMatch(/could not update/i);
    const category = screen.getByLabelText('Item 1 category') as HTMLInputElement;
    expect(category.disabled).toBe(false);
  });

  it('keeps sharing preferences available without capability configuration', () => {
    render(<ConsentPanel consent={null} {...callbacks()} />);
    expect(screen.queryByRole('region', { name: 'Sharing preferences' })).toBeTruthy();
    expect(screen.queryByText(/sharing is off by default/i)).toBeTruthy();
  });

  it('uses accessible labels and buttons', () => {
    renderPanel(granted);
    expect(screen.getByRole('region', { name: 'Sharing preferences' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /withdraw consent/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete my data' })).toBeTruthy();
  });
});
