// Formatos del sistema Cajetín: coma decimal, unidades separadas, fechas cortas en español.

const LOCALE = 'es-CO';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value < 10 ? 1 : 0;
  return `${value.toLocaleString(LOCALE, { maximumFractionDigits: digits })} ${units[unit]}`;
}

const dateParts = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "28 oct 2026, 10:30" (por partes: es-CO intercala "de" y puntos que el estándar no usa). */
export function formatDate(iso: string): string {
  const part = Object.fromEntries(dateParts.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${part.day} ${part.month.replace('.', '')} ${part.year}, ${part.hour}:${part.minute}`;
}

const FORMAT_BY_MIME: Record<string, string> = {
  'application/pdf': 'PDF',
  'text/markdown': 'MD',
  'text/plain': 'TXT',
};

export const formatLabel = (mimeType: string) => FORMAT_BY_MIME[mimeType] ?? mimeType;

export const formatVersion = (version: string) => (/^\d/.test(version) ? `v${version}` : version);
