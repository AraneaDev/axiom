import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';

import { wikiApi } from '@/api/wiki.api';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface StarButtonProps {
  pageId: string;
  className?: string;
}

/**
 * Toggle-star button for wiki pages.
 * Shows filled star when starred, outline when not.
 * @param root0
 * @param root0.pageId
 * @param root0.className
 */
export function StarButton({ pageId, className }: StarButtonProps) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['pageStarred', pageId],
    queryFn: () => wikiApi.isStarred(pageId),
    enabled: !!pageId,
  });

  const starred = data?.starred ?? false;

  const toggleMutation = useMutation({
    mutationFn: () => wikiApi.toggleStar(pageId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['pageStarred', pageId] });
      const previous = queryClient.getQueryData<{ starred: boolean }>(['pageStarred', pageId]);
      queryClient.setQueryData(['pageStarred', pageId], { starred: !starred });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['pageStarred', pageId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['pageStarred', pageId] });
      queryClient.invalidateQueries({ queryKey: ['starredPages'] });
    },
  });

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => toggleMutation.mutate()}
      disabled={toggleMutation.isPending}
      title={starred ? 'Unstar page' : 'Star page'}
      className={cn(className)}
    >
      <Star
        className={cn('h-4 w-4', starred ? 'fill-warning text-warning' : 'text-text-secondary')}
      />
      {starred ? 'Starred' : 'Star'}
    </Button>
  );
}
