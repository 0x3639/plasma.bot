import { useQuery } from '@tanstack/react-query';
import { getDonations } from '../api/client';

export function useDonations() {
  return useQuery({
    queryKey: ['donations'],
    queryFn: getDonations,
    refetchInterval: 60000,
  });
}
