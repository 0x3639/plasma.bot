import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddressRow } from '../components/AddressRow';

const ADDRESS = 'z1qp972aed9levp34gwn32xw24j2evsmcmu6knx0';

const flush = () => act(async () => {});

describe('AddressRow', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    writeText.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('links the address to the explorer', () => {
    render(<AddressRow address={ADDRESS} />);
    expect(screen.getByRole('link', { name: ADDRESS })).toHaveAttribute(
      'href',
      `https://zenonhub.io/explorer/account/${ADDRESS}`,
    );
  });

  it('shows COPIED and announces success, then resets after 2s', async () => {
    writeText.mockResolvedValue(undefined);
    render(<AddressRow address={ADDRESS} />);
    const button = screen.getByRole('button', { name: 'Copy address' });

    fireEvent.click(button);
    await flush();

    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(button).toHaveTextContent('COPIED');
    expect(screen.getByRole('status')).toHaveTextContent('Address copied');

    act(() => vi.advanceTimersByTime(2000));
    expect(button).toHaveTextContent('COPY');
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('shows ERR and announces failure when the clipboard write rejects', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<AddressRow address={ADDRESS} />);
    const button = screen.getByRole('button', { name: 'Copy address' });

    fireEvent.click(button);
    await flush();

    expect(button).toHaveTextContent('ERR');
    expect(screen.getByRole('status')).toHaveTextContent('Copy failed');

    act(() => vi.advanceTimersByTime(2000));
    expect(button).toHaveTextContent('COPY');
  });

  it('restarts the reset timer on repeated clicks', async () => {
    writeText.mockResolvedValue(undefined);
    render(<AddressRow address={ADDRESS} />);
    const button = screen.getByRole('button', { name: 'Copy address' });

    fireEvent.click(button);
    await flush();
    act(() => vi.advanceTimersByTime(1500));

    fireEvent.click(button);
    await flush();
    act(() => vi.advanceTimersByTime(1500));
    expect(button).toHaveTextContent('COPIED');

    act(() => vi.advanceTimersByTime(500));
    expect(button).toHaveTextContent('COPY');
  });

  it('does nothing without an address', async () => {
    render(<AddressRow />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    await flush();
    expect(writeText).not.toHaveBeenCalled();
  });
});
