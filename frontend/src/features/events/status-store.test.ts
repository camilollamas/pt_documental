import { describe, expect, it } from 'vitest';
import type { StatusEvent } from '../../services/api';
import { applyStatus } from './status-store';

const event = (status: StatusEvent['status'], updatedAt: string): StatusEvent => ({
  id: 'doc-1',
  status,
  contentIndexed: status === 'INDEXADO',
  errorMessage: null,
  updatedAt,
});

describe('applyStatus', () => {
  it('guarda el primer evento de cada documento', () => {
    expect(applyStatus({}, event('PROCESANDO', '2026-10-28T10:00:00Z'))['doc-1'].status).toBe('PROCESANDO');
  });

  it('un evento más reciente reemplaza al anterior', () => {
    const map = applyStatus({}, event('PROCESANDO', '2026-10-28T10:00:00Z'));
    expect(applyStatus(map, event('INDEXADO', '2026-10-28T10:00:01Z'))['doc-1'].status).toBe('INDEXADO');
  });

  it('un snapshot viejo que llega tarde no pisa un estado final', () => {
    const map = applyStatus({}, event('INDEXADO', '2026-10-28T10:00:01Z'));
    expect(applyStatus(map, event('PROCESANDO', '2026-10-28T10:00:00Z'))).toBe(map);
  });
});
