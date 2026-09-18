import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFusions, useStats } from '../hooks/useFusions';
import { useDonations } from '../hooks/useDonations';
import { useFuseRequest } from '../hooks/useFuseRequest';
import type { StatsResponse } from '../api/client';

vi.mock('../hooks/useFusions', () => ({ useStats: vi.fn(), useFusions: vi.fn() }));
vi.mock('../hooks/useDonations', () => ({ useDonations: vi.fn() }));
vi.mock('../hooks/useFuseRequest', () => ({ useFuseRequest: vi.fn() }));

const STATS: StatsResponse = {
  walletAddress: 'z1qp972aed9levp34gwn32xw24j2evsmcmu6knx0',
  qsrAvailable: 940,
  qsrFused: 2360,
  qsrBalance: 940,
  activeFusionCount: 34,
  availableTiers: ['low', 'medium', 'high'],
  nextUnfuseAt: null,
  currentHeight: 14216178,
};

const ADDRESS = 'z1qzal6cq2m4v4ydpdvefkhwzhkd0gxa4kfkwsts';

function mockStats(result: { data?: StatsResponse; isLoading?: boolean; isError?: boolean }) {
  vi.mocked(useStats).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    ...result,
  } as unknown as ReturnType<typeof useStats>);
}

async function loadHome() {
  vi.resetModules();
  const mod = await import('../pages/Home');
  return mod.Home;
}

describe('Home', () => {
  beforeEach(() => {
    vi.mocked(useFusions).mockReturnValue({
      data: { fusions: [], count: 0, total: 0, page: 1, totalPages: 1 },
      isLoading: false,
    } as unknown as ReturnType<typeof useFusions>);
    vi.mocked(useDonations).mockReturnValue({
      data: { donations: [], donorCount: 0 },
      isLoading: false,
    } as unknown as ReturnType<typeof useDonations>);
    vi.mocked(useFuseRequest).mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    } as unknown as ReturnType<typeof useFuseRequest>);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows CONNECTING until the first stats response', async () => {
    mockStats({ isLoading: true });
    const Home = await loadHome();
    render(<Home />);
    expect(screen.getByText('CONNECTING')).toBeInTheDocument();
  });

  it('shows ONLINE once stats arrive, with the fusion count in the header', async () => {
    mockStats({ data: STATS });
    const Home = await loadHome();
    render(<Home />);
    expect(screen.getByText('ONLINE')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '[ ACTIVE_FUSIONS :: 34 ]' })).toBeInTheDocument();
  });

  it('shows OFFLINE when the stats query fails', async () => {
    mockStats({ isError: true });
    const Home = await loadHome();
    render(<Home />);
    expect(screen.getByText('OFFLINE')).toBeInTheDocument();
  });

  it('renders the scanline overlay by default', async () => {
    mockStats({ data: STATS });
    const Home = await loadHome();
    const { container } = render(<Home />);
    expect(container.querySelector('.scanlines')).not.toBeNull();
  });

  it('omits the scanline overlay when VITE_SCANLINES=false', async () => {
    vi.stubEnv('VITE_SCANLINES', 'false');
    mockStats({ data: STATS });
    const Home = await loadHome();
    const { container } = render(<Home />);
    expect(container.querySelector('.scanlines')).toBeNull();
  });

  async function renderForm(mutateAsync = vi.fn()) {
    vi.mocked(useFuseRequest).mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useFuseRequest>);
    mockStats({ data: STATS });
    const Home = await loadHome();
    render(<Home />);
    return {
      input: screen.getByLabelText('ZENON_ADDRESS:') as HTMLInputElement,
      submit: () => screen.getByRole('button', { name: /EXECUTE FUSE/ }) as HTMLButtonElement,
      tier: (name: RegExp) => screen.getByRole('button', { name }),
    };
  }

  it('keeps submit disabled until a valid address and tier are chosen', async () => {
    const { input, submit, tier } = await renderForm();
    expect(submit()).toBeDisabled();

    fireEvent.change(input, { target: { value: 'Z1NOTVALID' } });
    expect(input.value).toBe('z1notvalid');
    expect(screen.getByText(/ERR: invalid address/)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: ADDRESS } });
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(submit()).toBeDisabled();

    fireEvent.click(tier(/\[ \] MED/));
    expect(tier(/\[x\] MED/)).toHaveAttribute('aria-pressed', 'true');
    expect(submit()).toBeEnabled();
    expect(submit()).toHaveTextContent('>> EXECUTE FUSE (80 QSR)');
  });

  it('submits the address and tier, shows the TX link, and resets the form', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true, amount: 80, txHash: 'abc123' });
    const { input, submit, tier } = await renderForm(mutateAsync);

    fireEvent.change(input, { target: { value: ADDRESS } });
    fireEvent.click(tier(/\[ \] MED/));
    await act(async () => {
      fireEvent.click(submit());
    });

    expect(mutateAsync).toHaveBeenCalledWith({ address: ADDRESS, tier: 'medium' });
    expect(screen.getByRole('alert')).toHaveTextContent('OK: fused 80 QSR to z1qzal6c...');
    expect(screen.getByRole('link', { name: 'abc123' })).toHaveAttribute(
      'href',
      'https://zenonhub.io/explorer/transaction/abc123',
    );
    expect(input.value).toBe('');
    expect(submit()).toBeDisabled();
    expect(submit()).toHaveTextContent('>> EXECUTE FUSE');
  });

  it('shows an ERR alert when the API reports failure', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: false, error: 'address already has an active fusion' });
    const { input, submit, tier } = await renderForm(mutateAsync);

    fireEvent.change(input, { target: { value: ADDRESS } });
    fireEvent.click(tier(/\[ \] LOW/));
    await act(async () => {
      fireEvent.click(submit());
    });

    expect(screen.getByRole('alert')).toHaveTextContent('ERR: address already has an active fusion');
    expect(input.value).toBe(ADDRESS);
  });

  it('shows an ERR alert when the request throws', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('Request failed (503)'));
    const { input, submit, tier } = await renderForm(mutateAsync);

    fireEvent.change(input, { target: { value: ADDRESS } });
    fireEvent.click(tier(/\[ \] HIGH/));
    await act(async () => {
      fireEvent.click(submit());
    });

    expect(screen.getByRole('alert')).toHaveTextContent('ERR: Request failed (503)');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('drops a selected tier that becomes unavailable after a stats refresh', async () => {
    mockStats({ data: STATS });
    const Home = await loadHome();
    const { rerender } = render(<Home />);
    const input = screen.getByLabelText('ZENON_ADDRESS:');
    fireEvent.change(input, { target: { value: ADDRESS } });
    fireEvent.click(screen.getByRole('button', { name: /\[ \] HIGH/ }));
    expect(screen.getByRole('button', { name: /EXECUTE FUSE/ })).toBeEnabled();

    mockStats({ data: { ...STATS, availableTiers: ['low', 'medium'] } });
    rerender(<Home />);

    const high = screen.getByRole('button', { name: /\[ \] HIGH/ });
    expect(high).toBeDisabled();
    expect(high).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /EXECUTE FUSE/ })).toBeDisabled();

    // Restoring the tier must not silently reselect it.
    mockStats({ data: STATS });
    rerender(<Home />);
    const restored = screen.getByRole('button', { name: /\[ \] HIGH/ });
    expect(restored).toBeEnabled();
    expect(restored).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /EXECUTE FUSE/ })).toBeDisabled();

    fireEvent.click(restored);
    expect(screen.getByRole('button', { name: /\[x\] HIGH/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /EXECUTE FUSE/ })).toBeEnabled();
  });

  it('keeps cached fusions and donations visible when a background refetch fails', async () => {
    vi.mocked(useFusions).mockReturnValue({
      data: {
        fusions: [{ beneficiary: ADDRESS, tier: 'high', qsrAmount: 120, fusedAt: new Date().toISOString(), status: 'active', expirationHeight: 1 }],
        count: 1, total: 1, page: 1, totalPages: 1,
      },
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useFusions>);
    vi.mocked(useDonations).mockReturnValue({
      data: { donations: [{ address: ADDRESS, totalQsr: 50 }], donorCount: 1 },
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useDonations>);
    mockStats({ data: STATS, isError: true });
    const Home = await loadHome();
    render(<Home />);

    expect(screen.getByText('OFFLINE')).toBeInTheDocument();
    expect(screen.queryByText('ERR: could not load fusions')).toBeNull();
    expect(screen.getByRole('link', { name: 'z1qzal6c...kwsts' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '[+] SHOW_DONATIONS (1)' }));
    expect(screen.queryByText('ERR: could not load donations')).toBeNull();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('renders ERR notices when the fusion or donation queries fail', async () => {
    vi.mocked(useFusions).mockReturnValue({ data: undefined, isLoading: false, isError: true } as unknown as ReturnType<typeof useFusions>);
    vi.mocked(useDonations).mockReturnValue({ data: undefined, isLoading: false, isError: true } as unknown as ReturnType<typeof useDonations>);
    mockStats({ data: STATS });
    const Home = await loadHome();
    render(<Home />);

    expect(screen.getByText('ERR: could not load fusions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '[+] SHOW_DONATIONS' }));
    expect(screen.getByText('ERR: could not load donations')).toBeInTheDocument();
  });

  it('reports when the bot is out of QSR instead of rendering the form', async () => {
    mockStats({ data: { ...STATS, availableTiers: [], nextUnfuseAt: new Date(Date.now() + 2 * 3600_000 + 14 * 60_000).toISOString() } });
    const Home = await loadHome();
    render(<Home />);
    expect(screen.getByText(/ERR: bot out of QSR — reclaim in ~2h 1[34]m/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /EXECUTE FUSE/ })).toBeNull();
  });
});
