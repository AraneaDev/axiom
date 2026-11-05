import { Link } from 'react-router';

import type { GroupsResult, ItemsResult } from '@/api/dashboards.api';
import { Table, TableContainer, Tbody, Td, Th, Thead, Tr, TrHead } from '@/components/ui/Table';

import { groupLabel, isGroups } from './widget-data';
import { NothingMatches, TruncatedNote } from './WidgetNotes';

function ItemsTable({ result }: { result: ItemsResult }) {
  return (
    <>
      <TableContainer className="overflow-x-auto">
        <Table>
          <Thead>
            <TrHead>
              <Th>Key</Th>
              <Th>Title</Th>
              <Th>Status</Th>
              <Th>Assignee</Th>
            </TrHead>
          </Thead>
          <Tbody>
            {result.items.map((item) => (
              <Tr key={item.id}>
                <Td className="font-mono text-xs whitespace-nowrap">
                  {item.url ? (
                    <Link to={item.url} className="text-primary hover:underline">
                      {item.key}
                    </Link>
                  ) : (
                    item.key
                  )}
                </Td>
                <Td>{item.title}</Td>
                <Td className="whitespace-nowrap">{item.status}</Td>
                <Td className="whitespace-nowrap">{item.assignee?.displayName}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </TableContainer>
      {result.nextCursor && <TruncatedNote />}
    </>
  );
}

function GroupsTable({ result }: { result: GroupsResult }) {
  const hasSum = result.groups.some((group) => group.sum !== undefined);
  const hasAvg = result.groups.some((group) => group.avg !== undefined);
  return (
    <>
      <TableContainer>
        <Table>
          <Thead>
            <TrHead>
              <Th>Group</Th>
              <Th className="text-right">Count</Th>
              {hasSum && <Th className="text-right">Sum</Th>}
              {hasAvg && <Th className="text-right">Average</Th>}
            </TrHead>
          </Thead>
          <Tbody>
            {result.groups.map((group) => (
              <Tr key={JSON.stringify(group.key)}>
                <Td>{groupLabel(group)}</Td>
                <Td className="text-right tabular-nums">{group.count}</Td>
                {hasSum && <Td className="text-right tabular-nums">{group.sum}</Td>}
                {hasAvg && <Td className="text-right tabular-nums">{group.avg}</Td>}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </TableContainer>
      {result.truncated && <TruncatedNote />}
    </>
  );
}

/**
 * A query's result as a table, of items or of groups with their aggregates.
 * @param root0
 * @param root0.result
 */
export function TableWidget({ result }: { result: ItemsResult | GroupsResult }) {
  if (isGroups(result)) {
    return result.groups.length > 0 ? <GroupsTable result={result} /> : <NothingMatches />;
  }
  return result.items.length > 0 ? <ItemsTable result={result} /> : <NothingMatches />;
}
