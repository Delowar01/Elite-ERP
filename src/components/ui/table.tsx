import * as React from "react";
import { cn } from "@/lib/utils";

// Navy Command data table (DEV-UI-01.5). Native table semantics; presentation lives on
// `table.data-table` in mockup-parity.css. The API is deliberately small — no column engine, no
// sorting, paging or selection:
//   <Table density>            "comfortable" (default, operational lists) | "compact" (dense
//                              ledger / report / settings tables). Row and header heights come from
//                              the --table-* tokens in globals.css; there is no third density.
//   <Table list>               a list table: headers and cells stay on one line (no 55–123px row
//                              inflation); a cell that must wrap opts out with <TableCell wrap>.
//   <TableHead|TableCell numeric>  numbers, amounts, quantities: tabular figures, aligned to the
//                              logical inline END in both directions.
//   <TableHead|TableCell action>   the row-actions column: sticky at inset-inline-end so the row
//                              actions stay reachable while the table scrolls inside its own
//                              container (390px). The header's children are its accessible name
//                              and are rendered visually hidden.
//   <TableEmptyRow colSpan>    the "nothing matches" row a list shows when its records exist but
//                              the current search / filters match none.
// The wrapper is the card (border + radius) and the horizontal scroll container, so a wide table
// scrolls inside it and never pushes the page wider than the viewport.
type Density = "comfortable" | "compact";

function Table({
  className,
  density = "comfortable",
  list = false,
  ...props
}: React.ComponentProps<"table"> & { density?: Density; list?: boolean }) {
  return (
    <div className="data-table-wrap" data-density={density}>
      <table className={cn("data-table", className)} data-density={density} data-list={list || undefined} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={className} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={className} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={className} {...props} />;
}

type CellFlags = { numeric?: boolean; action?: boolean };

function TableHead({ className, numeric, action, children, ...props }: React.ComponentProps<"th"> & CellFlags) {
  return (
    <th scope="col" className={className} data-cell={action ? "action" : numeric ? "numeric" : undefined} {...props}>
      {action ? <span className="sr-only">{children}</span> : children}
    </th>
  );
}

function TableCell({ className, numeric, action, wrap, ...props }: React.ComponentProps<"td"> & CellFlags & { wrap?: boolean }) {
  return <td className={className} data-cell={action ? "action" : numeric ? "numeric" : undefined} data-wrap={wrap || undefined} {...props} />;
}

/** One full-width row for "records exist, but the current search / filters match none". */
function TableEmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr data-empty-row="">
      <td colSpan={colSpan} data-wrap="">
        {children}
      </td>
    </tr>
  );
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmptyRow };
