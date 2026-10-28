import type { ButtonHTMLAttributes } from 'react';
import { buttonClass, type ButtonSize, type ButtonVariant } from './button-class';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** En espera: deshabilita, muestra el indicador y anuncia aria-busy. */
  busy?: boolean;
};

export function Button({ variant, size, busy = false, disabled, children, className = '', type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={`${buttonClass(variant, size)} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = 'size-3.5' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`${className} inline-block flex-none animate-spin rounded-full border-2 border-current border-r-transparent`}
    />
  );
}
