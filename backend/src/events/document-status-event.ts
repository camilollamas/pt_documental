import { DocumentStatus } from '../documents/document-status.js';

/** Lo que viaja por Redis y por SSE: solo id y estado, ningún dato sensible ni contenido. */
export type DocumentStatusEvent = {
  id: string;
  status: DocumentStatus;
  contentIndexed: boolean;
  errorMessage: string | null;
  /** El cliente conserva el evento más reciente: ordena snapshot y eventos en vivo que lleguen cruzados. */
  updatedAt: string;
};
