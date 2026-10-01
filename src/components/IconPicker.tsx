"use client";

const ICONS = ["🌾", "🍬", "🧈", "🥚", "🍫", "🍪", "🥛", "🍌", "🍓", "🧂", "📦", "🪵", "🎂", "🧁", "🍞", "🥧", "🥐", "🍩"];

export function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  return (
    <div className="icon-picker">
      {ICONS.map((icon) => (
        <button
          key={icon}
          type="button"
          className={value === icon ? "is-selected" : ""}
          onClick={() => onChange(icon)}
          aria-label={`Icon ${icon}`}
          aria-pressed={value === icon}
        >
          {icon}
        </button>
      ))}
      <input
        className="icon-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Custom icon"
        maxLength={8}
      />
    </div>
  );
}
