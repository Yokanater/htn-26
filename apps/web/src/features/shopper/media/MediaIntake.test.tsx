import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaIntake } from './MediaIntake';
import type { MediaNormalizeBrowser } from './normalize';
import { MEDIA_MAX_BYTES } from './validation';

afterEach(() => {
  cleanup();
});

function makeFile(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(Math.max(size, 1))], name, { type });
}

function getFileInput(): HTMLInputElement {
  return screen.getByLabelText('Inspiration image') as HTMLInputElement;
}

function selectFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: files,
  });
  fireEvent.change(input);
}

function mockBrowser(width: number, height: number): MediaNormalizeBrowser {
  const close = vi.fn();
  return {
    createImageBitmap: vi.fn(async () => ({ width, height, close })),
    createCanvas: (w, h) => {
      const canvas = {
        width: w,
        height: h,
        getContext: () => ({
          drawImage: vi.fn(),
        }),
        toBlob: (cb: (blob: Blob | null) => void, type?: string) => {
          cb(new Blob([new Uint8Array([1, 2, 3])], { type: type ?? 'image/jpeg' }));
        },
      };
      return canvas;
    },
  };
}

describe('MediaIntake validation (A1)', () => {
  it('exposes an accessible single-file input with a visible label', () => {
    render(<MediaIntake normalize={false} />);
    const input = getFileInput();
    expect(input.type).toBe('file');
    expect(input.multiple).toBe(false);
    expect(input.getAttribute('accept')).toContain('image/jpeg');
  });

  it.each([
    ['ok.jpg', 'image/jpeg'],
    ['ok.png', 'image/png'],
    ['ok.webp', 'image/webp'],
  ] as const)('accepts %s and clears prior SVG errors', async (name, type) => {
    const onSelection = vi.fn();
    render(<MediaIntake normalize={false} onSelectionChange={onSelection} />);
    const input = getFileInput();

    selectFiles(input, [makeFile('bad.svg', 'image/svg+xml')]);
    expect(screen.getByRole('alert').textContent).toMatch(/SVG/i);

    selectFiles(input, [makeFile(name, type)]);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(onSelection).toHaveBeenCalled();
  });

  it('rejects SVG, unsupported types, and oversized files', () => {
    render(<MediaIntake normalize={false} />);
    const input = getFileInput();

    selectFiles(input, [makeFile('x.svg', 'image/svg+xml')]);
    expect(screen.getByRole('alert').textContent).toMatch(/SVG/i);

    selectFiles(input, [makeFile('x.gif', 'image/gif')]);
    expect(screen.getByRole('alert').textContent).toMatch(/Unsupported/i);

    selectFiles(input, [makeFile('huge.jpg', 'image/jpeg', MEDIA_MAX_BYTES + 1)]);
    expect(screen.getByRole('alert').textContent).toMatch(/8 MiB/i);
  });

  it('clears selection on remove and resets the input for reselection', async () => {
    const onSelection = vi.fn();
    render(<MediaIntake normalize={false} onSelectionChange={onSelection} />);
    const input = getFileInput();
    const file = makeFile('again.jpg', 'image/jpeg');

    selectFiles(input, [file]);
    await waitFor(() => expect(screen.getByText(/Selected: again\.jpg/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByText(/Selected:/)).toBeNull();
    expect(input.value).toBe('');
    expect(onSelection).toHaveBeenLastCalledWith(null);
  });

  it('resets the input after rejection so the same file can be chosen again', () => {
    render(<MediaIntake normalize={false} />);
    const input = getFileInput();
    selectFiles(input, [makeFile('bad.gif', 'image/gif')]);
    expect(input.value).toBe('');
  });
});

describe('MediaIntake normalize + preview (A2)', () => {
  it('shows preview from normalized blob and revokes on remove', async () => {
    const createObjectURL = vi.fn(() => 'blob:preview-1');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    const browser = mockBrowser(800, 600);
    render(<MediaIntake browser={browser} />);
    selectFiles(getFileInput(), [makeFile('room.jpg', 'image/jpeg')]);

    await waitFor(() => expect(screen.getByAltText(/Preview of/)).toBeTruthy());
    expect(createObjectURL).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    vi.unstubAllGlobals();
  });

  it('shows a readable decode error without crashing', async () => {
    const browser: MediaNormalizeBrowser = {
      createImageBitmap: vi.fn(async () => {
        throw new Error('boom');
      }),
      createCanvas: mockBrowser(1, 1).createCanvas,
    };
    render(<MediaIntake browser={browser} />);
    selectFiles(getFileInput(), [makeFile('bad.jpg', 'image/jpeg')]);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Could not read/i));
  });

  it('ignores stale normalize results after a newer selection', async () => {
    let releaseDecode: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      releaseDecode = resolve;
    });
    const close = vi.fn();
    const createImageBitmap = vi
      .fn()
      .mockImplementationOnce(async () => {
        await blocked;
        return { width: 2000, height: 2000, close };
      })
      .mockImplementationOnce(async () => ({ width: 100, height: 100, close }));

    const createObjectURL = vi.fn((blob: Blob) => `blob:${blob.size}`);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    const browser: MediaNormalizeBrowser = {
      createImageBitmap,
      createCanvas: mockBrowser(100, 100).createCanvas,
    };
    const onSelection = vi.fn();
    render(<MediaIntake browser={browser} onSelectionChange={onSelection} />);
    const input = getFileInput();

    selectFiles(input, [makeFile('slow.jpg', 'image/jpeg')]);
    await waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(1));
    selectFiles(input, [makeFile('fast.jpg', 'image/jpeg')]);

    await waitFor(() => {
      const last = onSelection.mock.calls.findLast((call) => call[0]?.kind === 'image');
      expect(last?.[0]?.file.name).toMatch(/fast/i);
    });

    releaseDecode();
    await Promise.resolve();
    await Promise.resolve();
    const imageCalls = onSelection.mock.calls.filter((call) => call[0]?.kind === 'image');
    expect(imageCalls.every((call) => call[0]?.file.name.includes('fast'))).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('MediaIntake text alternative (A3)', () => {
  it('exposes an accessible text path bounded to 2000 characters', () => {
    const onSelection = vi.fn();
    render(<MediaIntake onSelectionChange={onSelection} />);
    fireEvent.click(screen.getByLabelText('Text description'));
    const textarea = screen.getByLabelText('Describe the collection') as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(2000);

    fireEvent.change(textarea, { target: { value: 'A linen setup with oak desk' } });
    expect(onSelection).toHaveBeenLastCalledWith({
      kind: 'text',
      text: 'A linen setup with oak desk',
    });
  });
});
