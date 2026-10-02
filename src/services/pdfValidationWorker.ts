import { parentPort, workerData } from 'node:worker_threads';
import { PDFDocument, PDFDict, PDFArray, PDFName } from 'pdf-lib';

const forbidden = new Set(['JavaScript', 'JS', 'OpenAction', 'AA', 'Launch', 'EmbeddedFiles', 'EF', 'RichMedia', 'XFA', 'AcroForm']);
function inspect(value: unknown, depth = 0): void {
  if (depth > 100) throw new Error('PDF nesting is too deep');
  if (value instanceof PDFDict) {
    for (const [key, child] of value.entries()) {
      if (forbidden.has(key.decodeText())) throw new Error('Active PDF content is not allowed');
      if (key.decodeText() === 'S' && child instanceof PDFName &&
          ['JavaScript', 'Launch', 'GoToR', 'SubmitForm', 'ImportData'].includes(child.decodeText())) throw new Error('Active PDF action');
      inspect(child, depth + 1);
    }
  } else if (value instanceof PDFArray) {
    for (let i = 0; i < value.size(); i++) inspect(value.get(i), depth + 1);
  }
}
async function validate() {
  const bytes = Buffer.from(workerData);
  if (!/^%PDF-(?:1\.[0-7]|2\.0)/.test(bytes.subarray(0, 8).toString('ascii')) ||
      !/%%EOF\s*$/.test(bytes.subarray(-1024).toString('ascii'))) throw new Error('Invalid PDF');
  const document = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
  if (document.isEncrypted || document.getPageCount() < 1 || document.getPageCount() > 10000) throw new Error('Unsupported PDF');
  for (const [, value] of document.context.enumerateIndirectObjects()) inspect(value);
  parentPort!.postMessage(true);
}
void validate().catch(() => parentPort!.postMessage(false));
