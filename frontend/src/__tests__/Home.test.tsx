import { render, screen } from '@testing-library/react';
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

  it('reports when the bot is out of QSR instead of rendering the form', async () => {
    mockStats({ data: { ...STATS, availableTiers: [], nextUnfuseAt: new Date(Date.now() + 2 * 3600_000 + 14 * 60_000).toISOString() } });
    const Home = await loadHome();
    render(<Home />);
    expect(screen.getByText(/ERR: bot out of QSR — reclaim in ~2h 1[34]m/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /EXECUTE FUSE/ })).toBeNull();
  });
});
