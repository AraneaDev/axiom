import type {
  GroupsResult,
  ItemsResult,
  SprintsResult,
  WidgetResult,
  WidgetError,
} from '@/api/dashboards.api';

export type Group = GroupsResult['groups'][number];

export const isError = (result: WidgetResult): result is WidgetError => 'error' in result;
export const isItems = (result: WidgetResult): result is ItemsResult =>
  'kind' in result && result.kind === 'items';
export const isGroups = (result: WidgetResult): result is GroupsResult =>
  'kind' in result && result.kind === 'groups';
export const isSprints = (result: WidgetResult): result is SprintsResult => 'sprints' in result;

/** What an empty key reads as: an issue without an assignee, a sprint or the like. */
const NO_VALUE = 'None';

function keyText(value: unknown): string {
  if (value === null || value === undefined) return NO_VALUE;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    const named = value as { displayName?: string; name?: string; key?: string };
    return named.displayName ?? named.name ?? named.key ?? NO_VALUE;
  }
  return String(value);
}

/**
 * A group's key as text: the values of its fields in order, as a person or sprint is named.
 * A query without GROUP BY has one group with an empty key.
 * @param group - The group
 */
export function groupLabel(group: Group): string {
  const values = Object.values(group.key);
  return values.length > 0 ? values.map(keyText).join(' / ') : 'All';
}

/**
 * What a group's bar or number shows: the aggregate the query asked for, else its count.
 * @param group - The group
 */
export function groupValue(group: Group): number {
  return group.sum ?? group.avg ?? group.count;
}
