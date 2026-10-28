import { Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Button } from '../../components/Button';
import { formatBytes } from '../../lib/format';
import type { UploadLimits } from '../../services/api';

type Props = { limits: UploadLimits; disabled?: boolean; onFiles: (files: File[]) => void };

/** Arrastrar es opcional: el botón abre el selector y hace lo mismo con teclado. */
export function Dropzone({ limits, disabled, onFiles }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(0);

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(0);
    if (!disabled) onFiles([...event.dataTransfer.files]);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(e.dataTransfer.items?.length || 1);
      }}
      onDragLeave={() => setOver(0)}
      onDrop={onDrop}
      className={`grid justify-items-center gap-2 rounded-(--radius-lg) border-2 px-6 py-8 text-center transition-colors duration-(--duration-fast) ${
        over ? 'border-solid border-accent bg-accent-soft' : 'border-dashed border-rule-strong bg-sheet'
      }`}
    >
      <Upload className="size-7 stroke-[1.5] text-accent" aria-hidden="true" />
      <p className="m-0 font-display text-[17px] leading-6 font-semibold">
        {over ? `Suelte para añadir ${over === 1 ? 'el archivo' : `${over} archivos`}` : 'Arrastre los archivos aquí'}
      </p>
      <Button onClick={() => input.current?.click()} disabled={disabled}>
        Elegir archivos
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={limits.allowedExtensions.join(',')}
        data-testid="file-input"
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = ''; // permite volver a elegir el mismo archivo
        }}
      />
      <p className="m-0 font-mono text-[13px] leading-5 text-ink-muted tabular-nums">
        PDF, Markdown o TXT · hasta {formatBytes(limits.maxFileBytes)} por archivo · {limits.maxFiles} por lote
      </p>
    </div>
  );
}
