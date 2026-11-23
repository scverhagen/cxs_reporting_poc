import { useLayoutEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Filter } from "./shared";

const storageKey = "cxs-appearance";
const themes = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
];

function readTheme() {
  try {
    const stored = localStorage.getItem(storageKey);
    return themes.some(([value]) => value === stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function useAppearance(branding) {
  const [theme, setTheme] = useState(readTheme);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      root.dataset.theme =
        theme === "system" ? (system.matches ? "dark" : "light") : theme;
    };
    apply();
    system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, [theme]);

  useLayoutEffect(() => {
    const style = document.documentElement.style;
    for (const key of ["primary", "secondary"]) {
      if (branding) style.setProperty("--brand-" + key, branding[key]);
      else style.removeProperty("--brand-" + key);
    }
  }, [branding]);

  function changeTheme(value) {
    setTheme(value);
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      // The selection still applies for this session when storage is disabled.
    }
  }
  return { theme, changeTheme };
}

export function ThemePicker({ theme, changeTheme }) {
  return (
    <Filter
      label="Appearance"
      value={theme}
      onChange={changeTheme}
      options={themes}
    />
  );
}

export function BrandEditor({ customer, onSaved }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(customer.branding);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function toggle(next) {
    if (next) {
      setDraft(customer.branding);
      setError("");
    }
    setOpen(next);
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const query = new URLSearchParams({
        customer: customer.tenant_id,
        role: "admin",
      });
      const response = await fetch("/api/branding?" + query, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Could not save colors.");
      onSaved(result);
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={toggle}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="w-fit">
          <span aria-hidden="true" className="flex gap-0.5">
            {Object.entries(customer.branding).map(([key, color]) => (
              <i
                key={key}
                className="size-2.5 rounded-full border"
                style={{ background: color }}
              />
            ))}
          </span>
          Brand colors
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Brand colors</DialogTitle>
          <DialogDescription>
            Everyone at {customer.name} sees these colors in reporting.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={save}>
          {["primary", "secondary"].map((key) => (
            <label key={key} className="flex items-center gap-3 text-sm">
              <input
                type="color"
                className="size-9 cursor-pointer rounded border bg-card p-1"
                value={draft[key]}
                onChange={(event) =>
                  setDraft({ ...draft, [key]: event.target.value })
                }
              />
              <span className="capitalize">{key} color</span>
              <span
                aria-hidden="true"
                className="ml-auto font-mono text-xs text-muted-foreground"
              >
                {draft[key].toUpperCase()}
              </span>
            </label>
          ))}
          {error && (
            <p role="alert" className="text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save colors"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
