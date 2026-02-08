import { useQuery } from '@tanstack/react-query';
import { getFusions, getStats } from '../api/client';

export function useFusions(page = 1, limit = 20) {
  return useQuery({
    queryKey: ['fusions', page, limit],
    queryFn: () => getFusions(page, limit),
    refetchInterval: 30000,
  });
}

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: 30000,
  });
}
