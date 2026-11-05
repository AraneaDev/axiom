import type { LucideIcon } from 'lucide-react';
import { BarChart3, CalendarRange, Hash, List, Table2 } from 'lucide-react';

import type { WidgetType } from '@/api/dashboards.api';

/** The icon of each kind of widget, on the dashboard and in the editor */
export const WIDGET_ICONS: Record<WidgetType, LucideIcon> = {
  COUNT: Hash,
  TABLE: Table2,
  LIST: List,
  BAR: BarChart3,
  SPRINT_OVERVIEW: CalendarRange,
};
