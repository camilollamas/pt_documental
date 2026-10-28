import type { StatusEvent } from '../../services/api';

export type StatusMap = Readonly<Record<string, StatusEvent>>;

/**
 * Conserva por documento el evento más reciente. El snapshot del SSE y los eventos en vivo
 * pueden llegar cruzados (y el worker publica en cualquier orden): manda `updatedAt`, no el orden de llegada.
 */
export function applyStatus(map: StatusMap, event: StatusEvent): StatusMap {
  const current = map[event.id];
  if (current && Date.parse(current.updatedAt) > Date.parse(event.updatedAt)) return map;
  return { ...map, [event.id]: event };
}
