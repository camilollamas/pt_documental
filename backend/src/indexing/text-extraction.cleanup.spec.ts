// Archivo aparte: vi.mock('unpdf') sustituye el módulo para todo el archivo.
const destroy = vi.fn().mockResolvedValue(undefined);
const extractText = vi.fn();
// Misma forma que pdf.js: el documento se libera con loadingTask.destroy() (como hace unpdf).
vi.mock('unpdf', () => ({
  getDocumentProxy: vi.fn().mockResolvedValue({ loadingTask: { destroy } }),
  extractText: (...args: unknown[]) => extractText(...args),
}));

const { extractDocumentText } = await import('./text-extraction.js');
const pdf = Buffer.from('%PDF-1.4');

describe('extractDocumentText libera el documento de pdf.js', () => {
  beforeEach(() => destroy.mockClear());

  it('cuando la extracción va bien', async () => {
    extractText.mockResolvedValueOnce({ text: 'contenido' });
    await expect(extractDocumentText(pdf, 'application/pdf')).resolves.toBe('contenido');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('cuando la extracción falla', async () => {
    extractText.mockRejectedValueOnce(new Error('página dañada'));
    await expect(extractDocumentText(pdf, 'application/pdf')).rejects.toThrow(/dañado/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
