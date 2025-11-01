import * as React from 'react';
import { TableContainer, Table, THead, TBody, Tr, Th } from '../system';

export function AdminTable(props: { headers: Array<React.ReactNode>; maxHeight?: number | string; children: React.ReactNode; style?: React.CSSProperties }) {
  const { headers, maxHeight = '60vh', children, style } = props;
  return (
    <TableContainer maxHeight={maxHeight} style={style}>
      <Table>
        <THead sticky>
          <Tr>
            {headers.map((h, i) => (
              <Th key={i}>{h}</Th>
            ))}
          </Tr>
        </THead>
        <TBody>
          {children}
        </TBody>
      </Table>
    </TableContainer>
  );
}


