import { getDocument, GlobalWorkerOptions, AnnotationMode } from './pdfjs/pdf.mjs';
import { PDFViewer, PDFLinkService, EventBus } from './pdfjs/pdf_viewer.mjs';

GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.mjs', import.meta.url).href;
let stylesheet;
function stylesReady() {
  return stylesheet ||= new Promise((resolve, reject) => {
    const link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = new URL('./pdfjs/pdf_viewer.css', import.meta.url).href;
    link.onload = resolve; link.onerror = () => { stylesheet = null; link.remove(); reject(new Error('The PDF viewer styles could not load. Please try again.')); };
    document.head.append(link);
  });
}

/** Mount in any sized container, including a future template editor split pane.
 * Updates keep the old document visible until the replacement page is rendered.
 * Each load has a generation, so late responses cannot replace newer previews. */
export class PdfPreviewPanel {
  constructor(root) {
    this.root = root; this.generation = 0;
    root.classList.add('pdf-preview-panel');
    root.innerHTML = `<div class="pdf-preview-toolbar">
      <div class="pdf-preview-navigation"><button type="button" data-previous aria-label="Previous page">←</button><label>Page <input data-page type="number" min="1" value="1" aria-label="Page number"></label><span data-count>of —</span><button type="button" data-next aria-label="Next page">→</button></div>
      <label class="pdf-preview-zoom">Zoom <select data-zoom aria-label="PDF zoom"><option value="page-width">Fit width</option><option value="page-fit">Fit page</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select></label>
      <a data-download class="btn btn-sm btn-outline" hidden>Download PDF</a>
    </div><p data-message class="pdf-preview-message" role="status">Preparing preview…</p><div class="pdf-preview-body"></div>`;
    this.body = root.querySelector('.pdf-preview-body'); this.message = root.querySelector('[data-message]');
    this.pageInput = root.querySelector('[data-page]'); this.zoom = root.querySelector('[data-zoom]');
    root.querySelector('[data-previous]').onclick = () => this.move(-1);
    root.querySelector('[data-next]').onclick = () => this.move(1);
    this.pageInput.onchange = () => { if (this.current) { this.current.viewer.currentPageNumber = Math.max(1,Math.min(this.current.viewer.pagesCount, Number(this.pageInput.value) || 1)); this.sync(); } };
    this.zoom.onchange = () => { if(this.current) this.current.viewer.currentScaleValue = this.zoom.value; };
    this.sync();
  }
  move(step) { if (this.current) { this.current.viewer.currentPageNumber += step; this.sync(); } }
  sync() {
    const viewer = this.current?.viewer;
    this.pageInput.disabled = this.zoom.disabled = !viewer;
    this.pageInput.value = viewer?.currentPageNumber || 1;
    this.pageInput.max = viewer?.pagesCount || 1;
    this.root.querySelector('[data-count]').textContent = `of ${viewer?.pagesCount || '—'}`;
    this.root.querySelector('[data-previous]').disabled = !viewer || viewer.currentPageNumber <= 1;
    this.root.querySelector('[data-next]').disabled = !viewer || viewer.currentPageNumber >= viewer.pagesCount;
  }
  async load(url, { label = 'PDF preview' } = {}) {
    const generation = ++this.generation;
    this.message.textContent = this.current ? 'Updating preview…' : 'Loading PDF…';
    this.message.dataset.error = '';
    this.pending?.dispose();
    let candidate;
    try {
      const resolved = new URL(url, location.href);
      if (resolved.origin !== location.origin) throw new Error('Preview must come from this app.');
      await stylesReady();
      if (generation !== this.generation) return;
      const container = document.createElement('div'); container.className = 'pdf-preview-scroll pdf-preview-pending';
      const pages = document.createElement('div'); pages.className = 'pdfViewer'; container.append(pages); this.body.append(container);
      const eventBus = new EventBus(); const linkService = new PDFLinkService({eventBus, externalLinkTarget:2});
      const viewer = new PDFViewer({container, viewer:pages, eventBus, linkService, annotationMode:AnnotationMode.ENABLE, imageResourcesPath:new URL('./pdfjs/images/',import.meta.url).href});
      linkService.setViewer(viewer);
      const task = getDocument({url:resolved.href, cMapUrl:new URL('./pdfjs/cmaps/',import.meta.url).href, cMapPacked:true, standardFontDataUrl:new URL('./pdfjs/standard_fonts/',import.meta.url).href, wasmUrl:new URL('./pdfjs/wasm/',import.meta.url).href, iccUrl:new URL('./pdfjs/iccs/',import.meta.url).href, isEvalSupported:false});
      let rejectReady;
      candidate = { viewer, container, dispose() { rejectReady?.(new Error('Preview replaced.')); viewer.setDocument(null); container.remove(); void task.destroy().catch(()=>{}); } };
      this.pending = candidate;
      const pdf = await task.promise;
      if (generation !== this.generation) { candidate.dispose(); return; }
      const previousPage = this.current?.viewer.currentPageNumber || 1;
      const previousOffset = this.current ? this.current.container.scrollTop - (this.current.viewer.getPageView(previousPage-1)?.div.offsetTop || 0) : 0;
      const rendered = new Promise((resolve, reject) => {
        rejectReady = reject;
        eventBus.on('pagesinit', () => { viewer.currentScaleValue = this.zoom.value; viewer.currentPageNumber = Math.min(previousPage, pdf.numPages); });
        eventBus.on('pagerendered', event => { if(event.pageNumber === viewer.currentPageNumber) event.error ? reject(event.error) : resolve(); });
      });
      viewer.setDocument(pdf); linkService.setDocument(pdf);
      await rendered; rejectReady = null;
      if (generation !== this.generation) { candidate.dispose(); return; }
      const previous = this.current; this.current = candidate; this.pending = null;
      container.classList.remove('pdf-preview-pending');
      if (previous) container.scrollTop = (viewer.getPageView(viewer.currentPageNumber-1)?.div.offsetTop || 0) + previousOffset;
      previous?.dispose();
      eventBus.on('pagechanging', () => { if(this.current === candidate) this.sync(); });
      const download = this.root.querySelector('[data-download]'); download.href = resolved.href; download.hidden = false;
      this.message.textContent = label; this.sync();
      this.root.dispatchEvent(new CustomEvent('pdf-preview-ready', {detail:{url:resolved.href,pages:pdf.numPages}}));
    } catch (error) {
      candidate?.dispose();
      if (generation !== this.generation) return;
      this.pending = null;
      this.message.dataset.error = 'true';
      this.message.textContent = `${error.status === 410 ? 'This preview expired. Close it and generate a new preview.' : 'Could not display this PDF. Close it and try again.'}${this.current ? ' The previous preview is still shown.' : ''}`;
    }
  }
  destroy() { this.generation++; this.pending?.dispose(); this.current?.dispose(); this.pending = this.current = null; this.root.replaceChildren(); }
}

let overlay;
export async function openPdfPreview(url, options) {
  if (overlay) { return overlay.panel.load(url, options); }
  const opener = document.activeElement;
  const dialog = document.createElement('dialog'); dialog.className = 'pdf-preview-dialog'; dialog.setAttribute('aria-labelledby','pdf-preview-title');
  dialog.innerHTML = '<header class="pdf-preview-heading"><div><h2 id="pdf-preview-title">PDF preview</h2><p>View the document before downloading</p></div><button type="button" class="btn btn-ghost btn-sm" data-close aria-label="Close PDF preview">Close ✕</button></header><div data-panel></div>';
  document.body.append(dialog);
  const panel = new PdfPreviewPanel(dialog.querySelector('[data-panel]')); panel.zoom.value = 'page-fit'; overlay = {dialog,panel};
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { panel.destroy(); dialog.remove(); overlay = null; if(opener?.isConnected) opener.focus(); }, {once:true});
  dialog.showModal();
  await panel.load(url, options);
}
