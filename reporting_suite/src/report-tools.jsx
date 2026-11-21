import { useView } from "./view-state";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GridTable } from "./shared";

export const sum = (rows, fn) =>
  rows.reduce((total, row) => total + fn(row), 0);
export const fmt = (n) =>
  (n === 0 ? 0 : Number(n)).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
export const rate = (n, d) => (d ? fmt((100 * n) / d) + "%" : "—");
export const label = (s) =>
  s ? s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()) : "—";
export const money = (data, n) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: data.currency,
      }).format(n / 100);
export const within = (at, start, end) =>
  !!at && at.slice(0, 10) >= start && at.slice(0, 10) <= end;
export const timestamp = (at) =>
  at ? at.replace("T", " ").replace(/:00Z$/, " UTC") : "—";
export function groups(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const k = key(row);
    if (!result.has(k)) result.set(k, []);
    result.get(k).push(row);
  }
  return [...result];
}
export function Detail({ trigger, title, caption, children }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="link" className="h-auto p-0 text-left">
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-4xl">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{caption}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function Section({ title, children }) {
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}
export function DateField({ name, value, onChange, max }) {
  if (useView().output) return <span data-filter={name} data-value={value} />;
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      {name}
      <Input
        type="date"
        value={value}
        min="2026-01-01"
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="w-auto bg-white text-foreground"
      />
    </label>
  );
}
export function Search({ value, onChange, placeholder }) {
  if (useView().output) return <span data-filter="Search" data-value={value} />;
  return (
    <Input
      type="search"
      aria-label={placeholder}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-sm bg-white"
    />
  );
}
export function Paged({ heads, rows, empty, columnKey }) {
  const { output } = useView();
  const [page, setPage] = useState(0);
  const size = 12,
    last = Math.max(0, Math.ceil(rows.length / size) - 1),
    current = Math.min(page, last);
  return (
    <>
      <GridTable
        heads={heads}
        columnKey={columnKey}
        rows={output ? rows : rows.slice(current * size, (current + 1) * size)}
        empty={empty}
      />
      {rows.length > size && (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="mr-auto">
            {current * size + 1}–{Math.min(rows.length, (current + 1) * size)}{" "}
            of {rows.length}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={!current}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={current === last}
            onClick={() => setPage(current + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </>
  );
}
