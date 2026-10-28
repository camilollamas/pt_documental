import { X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';

type Props = { id: string; label: string; value: string[]; onChange: (tags: string[]) => void; max?: number; maxLength?: number };

/**
 * Etiquetas: Enter o coma añade, Retroceso con el campo vacío quita la última.
 * Normaliza igual que el backend: sin espacios sobrantes ni duplicados.
 */
export function TagInput({ id, label, value, onChange, max = 20, maxLength = 40 }: Props) {
  const [text, setText] = useState('');

  function add(raw: string) {
    const tag = raw.trim();
    if (tag && !value.includes(tag) && value.length < max) onChange([...value, tag]);
    setText('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(text);
    } else if (event.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id} className="text-[14px] leading-5 font-semibold">
        {label} <small className="text-[13px] font-normal text-ink-muted">(opcional)</small>
      </label>
      <div className="flex min-h-(--control-height) flex-wrap items-center gap-1 rounded-(--radius-md) border border-rule-strong bg-sheet px-2 py-1">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-(--radius-sm) bg-sunken py-0 pr-1 pl-2 text-[13px] leading-6">
            {tag}
            <button
              type="button"
              aria-label={`Quitar ${tag}`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="grid size-5 place-items-center rounded-(--radius-sm) text-ink-muted hover:text-ink"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          maxLength={maxLength}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(text)}
          placeholder={value.length < max ? 'Añadir y pulsar Enter' : `Máximo ${max} etiquetas`}
          disabled={value.length >= max}
          className="h-7 min-w-0 flex-[1_1_120px] border-0 bg-transparent px-1 text-[15px] text-ink outline-none placeholder:text-ink-muted"
        />
      </div>
    </div>
  );
}
