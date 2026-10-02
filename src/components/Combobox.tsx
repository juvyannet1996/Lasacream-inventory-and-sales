"use client";

import { useEffect, useId, useRef, useState } from "react";

export type ComboOption = {
  id: string;
  label: string;
  icon?: string;
  hint?: string;
};

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Search",
  ariaLabel,
  onCreate,
  createLabel,
}: {
  options: ComboOption[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
  ariaLabel: string;
  onCreate?: (query: string) => void;
  createLabel?: string;
}) {
  const selected = options.find((option) => option.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const trimmed = query.trim().toLowerCase();
  const filtered = options.filter((option) => option.label.toLowerCase().includes(trimmed));
  const createIndex = onCreate ? filtered.length : -1;
  const optionCount = filtered.length + (onCreate ? 1 : 0);

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(id: string) {
    onChange(id);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((current) => Math.min(current + 1, Math.max(optionCount - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (highlight === createIndex && onCreate) {
        onCreate(query.trim());
        setOpen(false);
        setQuery("");
      } else if (filtered[highlight]) {
        choose(filtered[highlight].id);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="combobox" ref={rootRef}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoComplete="off"
        value={open ? query : (selected?.label ?? "")}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setHighlight(0);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul className="combo-list" id={listId} role="listbox">
          {filtered.length === 0 ? <li className="combo-empty">No matches</li> : null}
          {filtered.map((option, index) => (
            <li key={option.id} role="option" aria-selected={option.id === value}>
              <button
                type="button"
                className={index === highlight ? "is-active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option.id)}
              >
                <span>
                  {option.icon ? <span className="combo-icon">{option.icon}</span> : null}
                  {option.label}
                </span>
                {option.hint ? <small>{option.hint}</small> : null}
              </button>
            </li>
          ))}
          {onCreate ? (
            <li>
              <button
                type="button"
                className={`combo-create ${highlight === createIndex ? "is-active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onCreate(query.trim());
                  setOpen(false);
                  setQuery("");
                }}
              >
                {createLabel ?? "+ Add"}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
