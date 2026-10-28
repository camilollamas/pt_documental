import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { pageWindow } from '../features/search/page-window';
import { StatusBadge } from './Badges';
import { Highlight } from './Highlight';

describe('Highlight', () => {
  it('pinta las coincidencias como <mark> y el HTML del documento como texto', () => {
    // Fragmento real de ts_headline: puede traer HTML sin escapar, incluso cortado.
    const { container } = render(
      <p>
        <Highlight
          segments={[
            { text: 'el clúster de ', match: false },
            { text: 'kafka', match: true },
            { text: ' <img src=x onerror=alert(1)> usa TLS', match: false },
          ]}
        />
      </p>,
    );
    expect(container.querySelectorAll('mark')).toHaveLength(1);
    expect(container.querySelector('mark')).toHaveTextContent('kafka');
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
  });
});

describe('StatusBadge', () => {
  it.each([
    ['PROCESANDO', true, 'Procesando'],
    ['INDEXADO', true, 'Indexado'],
    ['INDEXADO', false, 'Sin contenido'],
    ['ERROR', false, 'Error'],
  ] as const)('%s (contenido %s) se muestra con la palabra «%s»', (status, contentIndexed, label) => {
    render(<StatusBadge status={status} contentIndexed={contentIndexed} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('pageWindow', () => {
  it('muestra todas las páginas si son 7 o menos', () => {
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('resume con … al principio, al final o en ambos extremos', () => {
    expect(pageWindow(1, 10)).toEqual([1, 2, 3, 4, 5, '…', 10]);
    expect(pageWindow(5, 10)).toEqual([1, '…', 4, 5, 6, '…', 10]);
    expect(pageWindow(10, 10)).toEqual([1, '…', 6, 7, 8, 9, 10]);
  });
});
