import { useEffect, useState } from 'react';
import type { StatusEvent } from '../../services/api';
import { applyStatus, type StatusMap } from './status-store';

/**
 * Estado en vivo de los documentos `ids`, sin polling (HU-04).
 * EventSource reconecta solo; en cada (re)conexión la API envía primero el estado actual
 * (snapshot) y después los cambios, así que un corte no pierde estados.
 */
export function useDocumentStatuses(ids: string[]): StatusMap {
  const [statuses, setStatuses] = useState<StatusMap>({});
  const key = [...ids].sort().join(',');

  useEffect(() => {
    if (!key) return;
    const source = new EventSource(`/api/events?ids=${key}`);
    source.addEventListener('status', (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as StatusEvent;
      setStatuses((current) => applyStatus(current, event));
    });
    return () => source.close();
  }, [key]);

  return statuses;
}
