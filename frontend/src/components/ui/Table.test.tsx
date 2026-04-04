import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Table, Thead, Tbody, Tr, Th, Td, TrHead, TableContainer } from './Table';

describe('Table', () => {
  it('renders rows and cell content', () => {
    render(
      <Table>
        <Tbody>
          <Tr>
            <Td>Cell A</Td>
            <Td>Cell B</Td>
          </Tr>
        </Tbody>
      </Table>,
    );
    expect(screen.getByText('Cell A')).toBeInTheDocument();
    expect(screen.getByText('Cell B')).toBeInTheDocument();
  });

  it('renders header columns', () => {
    render(
      <Table>
        <Thead>
          <TrHead>
            <Th>Name</Th>
            <Th>Status</Th>
          </TrHead>
        </Thead>
        <Tbody />
      </Table>,
    );
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('applies additional className to TableContainer', () => {
    const { container } = render(
      <TableContainer className="my-custom-class">content</TableContainer>,
    );
    expect(container.firstChild).toHaveClass('my-custom-class');
  });
});
