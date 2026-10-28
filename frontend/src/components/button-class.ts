type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

const base =
  'inline-flex items-center justify-center gap-2 rounded-(--radius-md) border font-semibold ' +
  'transition-colors duration-(--duration-fast) cursor-pointer ' +
  'disabled:cursor-not-allowed disabled:border-rule disabled:bg-sunken disabled:text-ink-muted';

const variants: Record<Variant, string> = {
  primary: 'border-accent bg-accent text-on-accent hover:border-accent-hover hover:bg-accent-hover',
  secondary: 'border-rule-strong bg-sheet text-ink hover:bg-sunken',
  ghost: 'border-transparent bg-transparent text-accent hover:bg-accent-soft',
  danger: 'border-error bg-sheet text-error hover:bg-error-soft',
};

const sizes: Record<Size, string> = {
  md: 'h-(--control-height) px-4 text-[14px] leading-5',
  sm: 'h-(--control-height-sm) px-3 text-[13px] leading-5',
};

export type ButtonVariant = Variant;
export type ButtonSize = Size;

/** Clases de botón del sistema Cajetín, también para enlaces (<Link className={buttonClass(...)}>). */
export const buttonClass = (variant: Variant = 'secondary', size: Size = 'md') =>
  `${base} ${variants[variant]} ${sizes[size]}`;
