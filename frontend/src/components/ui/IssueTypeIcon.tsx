import { CheckSquare, Bug, BookOpen, Zap, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON_MAP: Record<string, LucideIcon> = {
  TASK: CheckSquare,
  BUG: Bug,
  STORY: BookOpen,
  EPIC: Zap,
};

export function IssueTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = ICON_MAP[type] ?? CheckSquare;
  return <Icon className={cn('h-4 w-4', className)} />;
}
