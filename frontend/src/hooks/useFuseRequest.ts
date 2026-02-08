import { useMutation, useQueryClient } from '@tanstack/react-query';
import { requestFuse, type FuseResponse } from '../api/client';

export function useFuseRequest() {
  const queryClient = useQueryClient();

  return useMutation<FuseResponse, Error, { address: string; tier: 'low' | 'medium' | 'high' }>({
    mutationFn: requestFuse,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fusions'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}
