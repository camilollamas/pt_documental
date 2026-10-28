import type { FileUpload } from 'graphql-upload/processRequest.mjs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { FileStorage } from '../common/file-storage.js';
import { DocumentsService } from './documents.service.js';

const upload = (filename: string, text: string): Promise<FileUpload> =>
  Promise.resolve({
    filename,
    mimetype: 'text/plain',
    encoding: '7bit',
    fieldName: '0',
    createReadStream: () => Readable.from(Buffer.from(text)),
  } as unknown as FileUpload);

const meta = (title: string) => ({ title, author: 'QA', category: 'Manual', tags: [], version: '1.0' });

describe('DocumentsService.upload', () => {
  let storageDir: string;

  beforeEach(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'docs-unit-'));
    process.env.STORAGE_DIR = storageDir;
  });
  afterEach(() => rm(storageDir, { recursive: true, force: true }));

  it('si falla el INSERT de un archivo, responde error SOLO para ese archivo y no deja huérfanos', async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('connection terminated'))
      .mockResolvedValueOnce(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const service = new DocumentsService({ insert } as never, { add } as never, new FileStorage());

    const results = await service.upload(
      [upload('uno.txt', 'a'), upload('dos.txt', 'b'), upload('tres.txt', 'c')],
      [meta('Uno'), meta('Dos'), meta('Tres')],
    );

    expect(results.map((r) => r.status ?? r.error)).toEqual([
      'PROCESANDO',
      'No se pudo registrar el documento. Vuelva a subir solo este archivo.',
      'PROCESANDO',
    ]);
    // Solo se encolan los registrados, y en disco quedan solo sus archivos.
    expect(add).toHaveBeenCalledTimes(2);
    expect((await readdir(storageDir)).sort()).toEqual([results[0].id, results[2].id].sort());
  });

  it('si falla la lectura de lo recibido, rechaza solo ese archivo y lo borra', async () => {
    const storage = new FileStorage();
    vi.spyOn(storage, 'read').mockRejectedValueOnce(new Error('EMFILE'));
    const add = vi.fn().mockResolvedValue(undefined);
    const service = new DocumentsService({ insert: vi.fn() } as never, { add } as never, storage);

    const results = await service.upload([upload('uno.txt', 'a'), upload('dos.txt', 'b')], [meta('Uno'), meta('Dos')]);

    expect(results.map((r) => r.status ?? r.error)).toEqual(['No se pudo recibir el archivo', 'PROCESANDO']);
    expect(await readdir(storageDir)).toEqual([results[1].id]);
  });
});
