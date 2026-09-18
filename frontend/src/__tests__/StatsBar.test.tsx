import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatsBar } from '../components/StatsBar';
import { useStats } from '../hooks/useFusions';

vi.mock('../hooks/useFusions', () => ({
  useStats: vi.fn(),
  useFusions: vi.fn(),
}));

type StatsResult = ReturnType<typeof useStats>;

function mockStats(result: Partial<StatsResult>) {
  vi.mocked(useStats).mockReturnValue({ data: undefined, isLoading: false, isError: false, ...result } as StatsResult);
}

describe('StatsBar', () => {
  it('renders placeholders while loading', () => {
    mockStats({ isLoading: true });
    render(<StatsBar />);
    expect(screen.getAllByText('...')).toHaveLength(4); // wallet row + 3 stat cells
  });

  it('renders ERR in every stat cell when the query fails', () => {
    mockStats({ isError: true });
    render(<StatsBar />);
    expect(screen.getAllByText('ERR')).toHaveLength(3);
  });

  it('renders unformatted numbers with at most two decimals', () => {
    mockStats({
      data: {
        walletAddress: 'z1qp972aed9levp34gwn32xw24j2evsmcmu6knx0',
        qsrAvailable: 4215.5,
        qsrFused: 12840,
        qsrBalance: 4215.5,
        activeFusionCount: 42,
        availableTiers: ['low', 'medium', 'high'],
        nextUnfuseAt: null,
        currentHeight: 9482113,
      },
    });
    render(<StatsBar />);
    expect(screen.getByText('4215.5')).toBeInTheDocument();
    expect(screen.getByText('12840')).toBeInTheDocument();
    expect(screen.getByText('9482113')).toBeInTheDocument();
    expect(screen.queryByText('9,482,113')).not.toBeInTheDocument();
  });
});
