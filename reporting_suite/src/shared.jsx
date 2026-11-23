import { Columns3 } from "lucide-react";
import { useView, useOption } from "./view-state";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
export function Filter({ label, value, onChange, options }) {
  if (useView().output)
    return (
      <span
        data-filter={label}
        data-value={options.find(([id]) => id === value)?.[1] || value}
      />
    );
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <NativeSelect
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-card text-foreground"
      >
        {options.map(([id, name]) => (
          <NativeSelectOption key={id} value={id}>
            {name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
}
export function Panel({ title, caption, children, className = "" }) {
  if (useView().output)
    return (
      <section>
        <h2>{title}</h2>
        {children}
      </section>
    );
  return (
    <Card className={"min-w-0 gap-4 py-5 " + className}>
      <CardHeader className="gap-1 px-5">
        <CardTitle>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        </CardTitle>
        <CardDescription className="text-xs">{caption}</CardDescription>
      </CardHeader>
      <CardContent className="px-5">{children}</CardContent>
    </Card>
  );
}
export function Metrics({ items }) {
  if (useView().output)
    return (
      <section>
        <h2>Summary</h2>
        <GridTable
          fixed
          heads={["Metric", "Value", "Definition"]}
          rows={items}
        />
      </section>
    );
  return (
    <div className="metric-grid">
      {items.map(([name, value, hint]) => (
        <Card key={name} className="gap-2 px-4 py-4">
          <CardDescription className="text-sm font-medium">
            {name}
          </CardDescription>
          <div className="text-3xl font-semibold tracking-tight tabular-nums">
            {value}
          </div>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </Card>
      ))}
    </div>
  );
}
export function GridTable({
  heads,
  rows,
  fixed = false,
  columnKey = heads.join("|"),
  initiallyHidden = [],
  empty = "No matching records.",
}) {
  const { output } = useView();
  const [hidden, setHidden] = useOption(
    "columns:" + columnKey,
    initiallyHidden,
  );
  const visible = heads
    .map((_, i) => i)
    .filter(
      (i) => fixed || output === "recipients" || !hidden.includes(heads[i]),
    );
  return (
    <>
      {!output && !fixed && (
        <details className="columns-menu">
          <summary aria-label={"Choose columns for " + heads.join(", ")}>
            <Columns3 size={13} /> Columns
          </summary>
          <div>
            {heads.map((head, i) => (
              <label key={head}>
                <input
                  type="checkbox"
                  checked={visible.includes(i)}
                  disabled={visible.length === 1 && visible[0] === i}
                  onChange={() =>
                    setHidden(
                      hidden.includes(head)
                        ? hidden.filter((h) => h !== head)
                        : [...hidden, head],
                    )
                  }
                />
                {head}
              </label>
            ))}
          </div>
        </details>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {visible.map((i) => (
              <TableHead key={heads[i]}>{heads[i]}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row, i) => (
              <TableRow key={i}>
                {visible.map((j) => (
                  <TableCell key={j}>{row[j]}</TableCell>
                ))}
              </TableRow>
            ))
          ) : output ? null : (
            <TableRow>
              <TableCell
                colSpan={visible.length}
                className="py-6 text-muted-foreground"
              >
                {empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </>
  );
}
