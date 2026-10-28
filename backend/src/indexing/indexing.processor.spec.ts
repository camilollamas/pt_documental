import { Job } from 'bullmq';
import { IndexingJob } from './indexing-queue.module.js';
import { IndexingProcessor } from './indexing.processor.js';
import { IndexingService } from './indexing.service.js';

const job = (attemptsMade: number) =>
  ({ attemptsMade, opts: { attempts: 3 }, data: { documentId: 'doc-1' } }) as unknown as Job<IndexingJob>;

describe('IndexingProcessor.onFailed', () => {
  it('marca ERROR al agotar los reintentos', async () => {
    const markError = vi.fn().mockResolvedValue(undefined);
    await new IndexingProcessor({ markError } as unknown as IndexingService).onFailed(job(3));
    expect(markError).toHaveBeenCalledWith('doc-1', expect.stringMatching(/reintentos/));
  });

  it('no marca ERROR mientras quedan reintentos', async () => {
    const markError = vi.fn();
    await new IndexingProcessor({ markError } as unknown as IndexingService).onFailed(job(1));
    expect(markError).not.toHaveBeenCalled();
  });

  it('no lanza si marcar ERROR falla (BD caída): un rechazo sin capturar tumbaría el worker', async () => {
    const markError = vi.fn().mockRejectedValue(new Error('connection refused'));
    await expect(
      new IndexingProcessor({ markError } as unknown as IndexingService).onFailed(job(3)),
    ).resolves.toBeUndefined();
  });
});
