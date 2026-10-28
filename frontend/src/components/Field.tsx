import { X } from 'lucide-react';
import { useId, type InputHTMLAttributes } from 'react';

export const inputClass =
  'h-(--control-height) min-w-0 rounded-(--radius-md) border border-rule-strong bg-sheet px-3 text-[15px] leading-6 text-ink ' +
  'placeholder:text-ink-muted disabled:bg-sunken disabled:text-ink-muted ' +
  'aria-invalid:border-error aria-invalid:shadow-[inset_0_0_0_1px_var(--error)]';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  help?: string;
  error?: string;
  optional?: boolean;
};

/** Rótulo + control + ayuda o error, enlazados por id (aria-describedby). */
export function Field({ label, help, error, optional, id, className = '', ...input }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={inputId} className="text-[14px] leading-5 font-semibold">
        {label} {optional && <small className="text-[13px] font-normal text-ink-muted">(opcional)</small>}
      </label>
      <input
        id={inputId}
        className={`${inputClass} ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || help ? hintId : undefined}
        {...input}
      />
      {error ? (
        <span id={hintId} role="alert" className="flex items-center gap-1 text-[13px] leading-5 font-semibold text-error">
          <X className="size-4" aria-hidden="true" />
          {error}
        </span>
      ) : (
        help && (
          <span id={hintId} className="text-[13px] leading-5 text-ink-muted">
            {help}
          </span>
        )
      )}
    </div>
  );
}
