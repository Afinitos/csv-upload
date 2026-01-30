import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type PaginationState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type TanstackEditableTableColumn<TData extends object> = {
  id: string;
  header: string;
  required?: boolean;
  /**
   * Render a cell. You receive rowIndex in the *original* data array.
   */
  renderCell: (args: { rowIndex: number; value: any; row: TData }) => ReactNode;
  accessor: (row: TData) => unknown;
};

export type TanstackEditableTableProps<TData extends object> = {
  data: TData[];
  columns: TanstackEditableTableColumn<TData>[];
  /** Optional extra trailing column (e.g. errors list) */
  trailingHeader?: string;
  renderTrailingCell?: (args: { rowIndex: number; row: TData }) => ReactNode;
  initialPageSize?: number;
  pageSizeOptions?: number[];
  /**
   * When provided, we only show these row indexes (indexes into `data`).
   * Useful to keep existing “filter invalid rows” logic intact.
   */
  visibleRowIndexes?: number[];
  /**
   * Optional key that triggers pagination reset to page 1.
   * Useful when the caller changes filtering mode but wants to avoid resets on every keystroke.
   */
  resetPageKey?: string | number;
  rowNumberHeader?: string;
};

export function TanstackEditableTable<TData extends object>({
  data,
  columns,
  trailingHeader,
  renderTrailingCell,
  initialPageSize = 200,
  pageSizeOptions = [50, 100, 200, 500, 1000],
  visibleRowIndexes,
  resetPageKey,
  rowNumberHeader = "#",
}: TanstackEditableTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize,
  });

  // Keep latest render callbacks without forcing TanStack Table to rebuild columns on every render.
  const columnsRef = useRef(columns);
  const trailingRef = useRef(renderTrailingCell);
  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);
  useEffect(() => {
    trailingRef.current = renderTrailingCell;
  }, [renderTrailingCell]);

  const filteredData = useMemo(() => {
    if (!visibleRowIndexes) return data;
    return visibleRowIndexes.map((i) => data[i]).filter(Boolean);
  }, [data, visibleRowIndexes]);

  const columnsKey = columns.map((c) => `${c.id}::${c.header}::${c.required ? 1 : 0}`).join("||");

  const tableColumns = useMemo<ColumnDef<TData>[]>(() => {
    const defs: ColumnDef<TData>[] = [];

    const toOriginalIndex = (rowId: string) => {
      const idx = Number(rowId);
      const safe = Number.isFinite(idx) ? idx : 0;
      return visibleRowIndexes ? (visibleRowIndexes[safe] ?? safe) : safe;
    };

    // Row number column
    defs.push({
      id: "__rowNumber__",
      header: rowNumberHeader,
      enableSorting: false,
      cell: (ctx) => {
        // Show original row number (index into original data array + 1), even when sorted/paginated.
        return toOriginalIndex(ctx.row.id) + 1;
      },
    });

    for (const c of columns) {
      defs.push({
        id: c.id,
        header: () => (
          <>
            {c.header} {c.required ? <span style={{ color: "var(--primary)" }}>*</span> : null}
          </>
        ),
        accessorFn: (row) => {
          const latest = columnsRef.current.find((x) => x.id === c.id);
          return latest?.accessor(row) ?? "";
        },
        cell: (ctx) => {
          const originalIndex = toOriginalIndex(ctx.row.id);
          const latest = columnsRef.current.find((x) => x.id === c.id);
          return (latest ?? c).renderCell({
            rowIndex: originalIndex,
            value: ctx.getValue(),
            row: ctx.row.original,
          });
        },
      });
    }

    if (renderTrailingCell) {
      defs.push({
        id: "__trailing__",
        header: trailingHeader ?? "",
        enableSorting: false,
        cell: (ctx) => {
          const originalIndex = toOriginalIndex(ctx.row.id);
          const latest = trailingRef.current;
          return latest ? latest({ rowIndex: originalIndex, row: ctx.row.original }) : null;
        },
      });
    }

    return defs;
  }, [columnsKey, renderTrailingCell, rowNumberHeader, trailingHeader, visibleRowIndexes]);

  const table = useReactTable({
    data: filteredData,
    columns: tableColumns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // Keep current page in bounds when page size or data size changes.
  const pageCount = table.getPageCount();
  useEffect(() => {
    if (pagination.pageIndex > pageCount - 1) {
      table.setPageIndex(Math.max(0, pageCount - 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount]);

  // Reset to first page when caller requests it (e.g. switching all/valid/invalid).
  useEffect(() => {
    if (resetPageKey == null) return;
    table.setPageIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetPageKey]);

  return (
    <>
      <div className="cx-topbar" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="cx-muted">
            Showing {table.getRowModel().rows.length} of {filteredData.length} row(s)
          </span>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <span className="cx-muted">Page size</span>
            <select
              className="cx-select"
              value={pagination.pageSize}
              onChange={(e) => {
                const next = Number(e.target.value);
                setPagination((p) => ({
                  pageIndex: 0,
                  pageSize: Number.isFinite(next) ? next : initialPageSize,
                }));
              }}
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className="cx-btn"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Prev
          </button>
          <span className="cx-muted">
            Page {table.getState().pagination.pageIndex + 1} / {Math.max(1, pageCount)}
          </span>
          <button
            className="cx-btn"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </button>
        </div>
      </div>

      <div className="cx-sheet">
        <table className="cx-table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sort = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className="cx-th"
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      style={canSort ? { cursor: "pointer", userSelect: "none" } : undefined}
                      title={canSort ? "Sort" : undefined}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {sort === "asc" ? " ▲" : sort === "desc" ? " ▼" : null}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="cx-td">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {filteredData.length === 0 && (
              <tr>
                <td className="cx-td" colSpan={table.getAllLeafColumns().length}>
                  No rows to display.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default TanstackEditableTable;
