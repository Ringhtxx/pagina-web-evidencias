/**
 * Editor de PDF en navegador (100% client-side, offline).
 * Usa pdf.js para renderizar páginas del PDF original con nitidez y pdf-lib
 * para exportar conservando la calidad vectorial original + cuadros de texto,
 * marcas (X / ✓), firmas a mano alzada, borrador blanco, imágenes y anexos fotográficos.
 */
(function (global) {
  'use strict';

  const EDITOR_DB_NAME = 'pdf_editor_evidencias_db';
  const EDITOR_DB_VERSION = 1;
  const EDITOR_STORE = 'workspace';
  const EDITOR_KEY = 'current_pdf';

  const COLORS = [
    { hex: '#111827', label: 'Negro' },
    { hex: '#1a73e8', label: 'Azul Google' },
    { hex: '#d93025', label: 'Rojo' },
    { hex: '#1e8e3e', label: 'Verde' },
    { hex: '#5f6368', label: 'Gris' }
  ];

  // Configurar worker de pdf.js compatible tanto con http(s):// como con file://
  function ensurePdfJsWorker() {
    if (!global.pdfjsLib) return;
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }
  }

  function hexToRgbNorm(hex) {
    const clean = String(hex || '#111827').replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    const num = parseInt(full, 16);
    if (Number.isNaN(num)) return { r: 0.07, g: 0.09, b: 0.15 };
    return {
      r: ((num >> 16) & 255) / 255,
      g: ((num >> 8) & 255) / 255,
      b: (num & 255) / 255
    };
  }

  // Sanitiza texto para WinAnsi (compatible con StandardFonts.Helvetica en pdf-lib)
  function sanitizeForWinAnsi(str) {
    const allowedExtra = new Set([
      0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030,
      0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022,
      0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178
    ]);
    const text = String(str || '').normalize('NFC');
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 0x0A || code === 0x0D) {
        out += '\n';
      } else if (code === 0x09) {
        out += ' ';
      } else if ((code >= 0x20 && code <= 0x7E) || (code >= 0xA0 && code <= 0xFF) || allowedExtra.has(code)) {
        out += text[i];
      } else if (code >= 0xD800 && code <= 0xDBFF) {
        i++;
      } else {
        out += '?';
      }
    }
    return out;
  }

  function wrapLinesPdfLib(text, font, fontSize, maxWidth) {
    const clean = sanitizeForWinAnsi(text).replace(/\r\n/g, '\n');
    const paragraphs = clean.split('\n');
    const lines = [];
    const safeMax = Math.max(24, maxWidth);

    for (const para of paragraphs) {
      if (!para) {
        lines.push('');
        continue;
      }
      const words = para.split(/(\s+)/);
      let current = '';
      for (const token of words) {
        const candidate = current + token;
        if (font.widthOfTextAtSize(candidate, fontSize) <= safeMax) {
          current = candidate;
        } else if (current.trim()) {
          lines.push(current.trimEnd());
          current = token.trimStart();
        } else {
          // Dividir palabra larga
          let chunk = '';
          for (const ch of token) {
            if (font.widthOfTextAtSize(chunk + ch, fontSize) > safeMax && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          current = chunk;
        }
      }
      if (current || para === '') lines.push(current.trimEnd());
    }
    return lines.length ? lines : [''];
  }

  function uid(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function cloneAnnotations(arr) {
    return JSON.parse(JSON.stringify(arr || []));
  }

  /* -------------------- Persistencia IndexedDB del Editor -------------------- */

  function openEditorDb() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new Error('IndexedDB no disponible'));
        return;
      }
      const req = indexedDB.open(EDITOR_DB_NAME, EDITOR_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(EDITOR_STORE)) {
          db.createObjectStore(EDITOR_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveEditorDraft(fileName, rawPdfBytes, annotations) {
    if (!rawPdfBytes) return;
    try {
      const db = await openEditorDb();
      const record = {
        fileName: fileName || 'documento.pdf',
        pdfBytes: rawPdfBytes.buffer ? rawPdfBytes.slice() : new Uint8Array(rawPdfBytes),
        annotations: cloneAnnotations(annotations),
        updatedAt: Date.now()
      };
      await new Promise((resolve, reject) => {
        const tx = db.transaction(EDITOR_STORE, 'readwrite');
        tx.objectStore(EDITOR_STORE).put(record, EDITOR_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (e) {}
  }

  async function loadEditorDraft() {
    try {
      const db = await openEditorDb();
      const saved = await new Promise((resolve, reject) => {
        const tx = db.transaction(EDITOR_STORE, 'readonly');
        const req = tx.objectStore(EDITOR_STORE).get(EDITOR_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return saved;
    } catch (e) {
      return null;
    }
  }

  async function clearEditorDb() {
    try {
      const db = await openEditorDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(EDITOR_STORE, 'readwrite');
        tx.objectStore(EDITOR_STORE).delete(EDITOR_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (e) {}
  }

  /* -------------------- Plantilla integrada (2 páginas) -------------------- */

  async function buildIntegratedTemplateBytes() {
    const { PDFDocument, StandardFonts, rgb } = global.PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    // Página 1: Reporte de Asistencia (estructura en blanco lista para diligenciar)
    const p1 = doc.addPage([612, 792]);
    const W = 612;
    const H = 792;
    const mx = 34;
    const cw = W - mx * 2;
    const blueBar = rgb(0.24, 0.42, 0.67);
    const borderCol = rgb(0.25, 0.27, 0.30);
    const ink = rgb(0.12, 0.13, 0.15);
    const white = rgb(1, 1, 1);

    function box(x, yTop, w, h, fill) {
      p1.drawRectangle({
        x,
        y: H - yTop - h,
        width: w,
        height: h,
        color: fill || white,
        borderColor: borderCol,
        borderWidth: 0.7
      });
    }

    function headerBar(x, yTop, w, h, title) {
      box(x, yTop, w, h, blueBar);
      p1.drawText(sanitizeForWinAnsi(title), {
        x: x + 5,
        y: H - yTop - h + 3.5,
        size: 7.5,
        font: fontBold,
        color: white
      });
    }

    function txt(str, x, yTop, size, bold) {
      p1.drawText(sanitizeForWinAnsi(str), {
        x,
        y: H - yTop - size * 0.85,
        size,
        font: bold ? fontBold : font,
        color: ink
      });
    }

    txt('Reporte de Asistencia', W / 2 - 64, 24, 13, true);

    let y = 50;
    const half = cw / 2;
    headerBar(mx, y, half, 13, 'Datos de la delegación que presta el servicio:');
    headerBar(mx + half, y, half, 13, 'Referencia asistencia (N° caso):');
    box(mx, y + 13, half, 54, white);
    box(mx + half, y + 13, half, 14, white);
    headerBar(mx + half, y + 27, half, 13, 'N° de serie del equipo:');
    box(mx + half, y + 40, half, 13, white);
    headerBar(mx + half, y + 53, half, 13, 'Marca y Modelo:');
    box(mx + half, y + 66, half, 14, white);
    box(mx, y + 67, half, 13, white);

    txt('FRACTALIA COLOMBIA S.A.S', mx + 5, y + 17, 7.3, false);
    txt('Avda. Carrera 45 # 97 - 50/70 · Edificio Porto 100, Piso 2, Bogotá D.C.', mx + 5, y + 28, 7.0, false);
    txt('N.I.T.: 900.352.035-2   ·   Tel: (57-1) 520 03 26', mx + 5, y + 39, 7.0, false);

    y += 86;
    headerBar(mx, y, half, 13, 'I. Información del cliente:');
    headerBar(mx + half, y, half, 13, 'II. Tiempos del servicio:');
    const cliLabels = ['Empresa:', 'Persona contacto:', 'Dirección y Ciudad:', 'NIT:'];
    const timeLabels = ['Fecha:  ____ / ____ / ______', 'Hora de llegada:  ____ : ____ horas', 'Hora de salida:  ____ : ____ horas', 'Tiempo de intervención:  ______ horas'];
    for (let i = 0; i < 4; i++) {
      const ry = y + 13 + i * 14;
      box(mx, ry, half, 14, white);
      box(mx + half, ry, half, 14, white);
      txt(cliLabels[i], mx + 5, ry + 3, 7.4, false);
      txt(timeLabels[i], mx + half + 5, ry + 3, 7.4, false);
    }

    y += 69;
    headerBar(mx, y, half, 13, 'III. Nombre Técnico:');
    headerBar(mx + half, y, half, 13, 'IV. Compañía/entidad:');
    box(mx, y + 13, half, 14, white);
    box(mx + half, y + 13, half, 14, white);
    txt('Fractalia', mx + half + 5, y + 16, 7.5, false);

    y += 32;
    headerBar(mx, y, cw, 13, 'V. Motivo de la asistencia:');
    box(mx, y + 13, cw, 22, white);

    y += 40;
    headerBar(mx, y, cw, 13, 'VI. Diagnóstico:');
    box(mx, y + 13, cw, 34, white);

    y += 52;
    headerBar(mx, y, half, 13, 'VII. Aceptación asistencia en sitio (Sist. Operativo):');
    headerBar(mx + half, y, half, 13, 'VIII. El usuario asegura disponer PREVIO a la visita:');
    box(mx, y + 13, half, 66, white);
    box(mx + half, y + 13, half, 66, white);
    txt('1. Actuaciones sobre el S.O pueden provocar pérdida de datos.', mx + 5, y + 18, 6.8, false);
    txt('2. Sin medios/licencias originales se cancelará el servicio.', mx + 5, y + 32, 6.8, false);
    txt('1. Del Sistema operativo (clave original):   [ SI ]  [ NO ]', mx + half + 5, y + 17, 6.8, false);
    txt('2. Medios de instalación compatibles:   [ SI ]  [ NO ]', mx + half + 5, y + 31, 6.8, false);
    txt('3. Aplicaciones a reinstalar (licencias):   [ SI ]  [ NO ]', mx + half + 5, y + 45, 6.8, false);
    txt('4. Copia de seguridad de la información:   [ SI ]  [ NO ]', mx + half + 5, y + 59, 6.8, false);

    y += 79;
    box(mx, y, cw, 22, white);
    txt('¿El usuario confirma tener backup antes de la visita técnica?   [ SI ]  [ NO ]     Firma cliente: _________________   C.C. ____________', mx + 5, y + 6, 6.8, true);

    y += 27;
    headerBar(mx, y, cw, 13, 'IX. Trabajos realizados:');
    box(mx, y + 13, cw, 64, white);

    y += 82;
    headerBar(mx, y, cw, 13, 'X. Observaciones:');
    box(mx, y + 13, cw, 48, white);

    y += 66;
    headerBar(mx, y, cw, 13, 'XI. Condiciones generales y conformidad:');
    box(mx, y + 13, cw, 40, white);
    txt('¿El usuario requiere equipo de continuidad operativa (préstamo)?   [ SI ]  [ NO ]     Firma: __________________  C.C. __________', mx + 5, y + 18, 6.9, false);
    txt('¿El usuario confirma funcionalidad del equipo posterior al proceso?   [ SI ]  [ NO ]', mx + 5, y + 34, 6.9, false);

    y += 58;
    box(mx, y, cw, 54, white);
    txt('¡SU OPINIÓN ES MUY IMPORTANTE PARA NOSOTROS! (1 a 5)', mx + cw / 2 - 110, y + 4, 7.2, true);
    txt('1. Satisfacción global:   1  2  3  4  5          2. Atención del técnico:   1  2  3  4  5', mx + 8, y + 20, 7.0, false);
    txt('3. Problema solucionado: 1  2  3  4  5          4. Tiempo de respuesta:   1  2  3  4  5', mx + 8, y + 35, 7.0, false);

    y += 58;
    box(mx, y, half, 66, white);
    box(mx + half, y, half, 66, white);
    txt('Aceptación del cliente', mx + 5, y + 4, 7.6, true);
    txt('Firma: ______________________________________', mx + 5, y + 24, 7.3, false);
    txt('Nombre: ____________________________________', mx + 5, y + 39, 7.3, false);
    txt('Cédula: _____________________________________', mx + 5, y + 53, 7.3, false);
    txt('Aceptación Fractalia', mx + half + 5, y + 4, 7.6, true);
    txt('Firma: ______________________________________', mx + half + 5, y + 24, 7.3, false);
    txt('Nombre: ____________________________________', mx + half + 5, y + 39, 7.3, false);
    txt('Cédula: _____________________________________', mx + half + 5, y + 53, 7.3, false);

    // Página 2: Formato de Inventario en blanco generado con el motor existente
    if (global.PdfEvidenceGenerator && global.AppEvidencesApi) {
      const blankState = global.AppEvidencesApi.createBlankInventoryState();
      const invBlob = await global.PdfEvidenceGenerator.generateEvidencePdf(blankState);
      const invDoc = await PDFDocument.load(await invBlob.arrayBuffer());
      const [invPage] = await doc.copyPages(invDoc, [0]);
      doc.addPage(invPage);
    }

    return new Uint8Array(await doc.save());
  }

  /* -------------------- Estado del Editor -------------------- */

  const editor = {
    fileName: '',
    rawPdfBytes: null,
    pdfDocProxy: null,
    pagesMeta: [],
    annotations: [],
    selectedId: null,
    editingTextId: null,
    tool: 'select', // select | text | mark | draw | rect
    style: {
      fontSize: 10,
      bold: false,
      color: '#111827',
      bgFill: 'transparent',
      markSymbol: 'X', // 'X' | 'check'
      strokeWidth: 2
    },
    zoom: 1.15,
    attachEvidences: false,
    undoStack: [],
    redoStack: [],
    saveTimer: null,
    lastExportBlobUrl: null,
    initialized: false
  };

  let dom = {};

  function toast(msg) {
    if (global.AppEvidencesApi && global.AppEvidencesApi.showToast) {
      global.AppEvidencesApi.showToast(msg);
    }
  }

  function invalidateExportCache() {
    if (editor.lastExportBlobUrl) {
      URL.revokeObjectURL(editor.lastExportBlobUrl);
      editor.lastExportBlobUrl = null;
    }
  }

  function pushHistory() {
    editor.undoStack.push(cloneAnnotations(editor.annotations));
    if (editor.undoStack.length > 50) editor.undoStack.shift();
    editor.redoStack = [];
    updateHistoryButtons();
  }

  function scheduleEditorSave() {
    invalidateExportCache();
    clearTimeout(editor.saveTimer);
    editor.saveTimer = setTimeout(() => {
      saveEditorDraft(editor.fileName, editor.rawPdfBytes, editor.annotations);
    }, 260);
  }

  function updateHistoryButtons() {
    if (dom.btnUndo) dom.btnUndo.disabled = editor.undoStack.length === 0;
    if (dom.btnRedo) dom.btnRedo.disabled = editor.redoStack.length === 0;
  }

  function getSelectedAnnotation() {
    return editor.annotations.find((a) => a.id === editor.selectedId) || null;
  }

  function updateStatusBar() {
    const hasDoc = Boolean(editor.rawPdfBytes && editor.pagesMeta.length > 0);
    if (dom.emptyState) dom.emptyState.hidden = hasDoc;
    if (dom.workspaceWrap) dom.workspaceWrap.hidden = !hasDoc;
    if (dom.editorFooter) dom.editorFooter.hidden = !hasDoc;

    if (dom.editorFileMeta) {
      const pCount = editor.pagesMeta.length;
      const aCount = editor.annotations.length;
      dom.editorFileMeta.textContent = `${editor.fileName || 'documento.pdf'} · ${pCount} ${pCount === 1 ? 'página' : 'páginas'} · ${aCount} ${aCount === 1 ? 'elemento' : 'elementos'}`;
    }

    if (dom.btnExportPdf) dom.btnExportPdf.disabled = !hasDoc;
    if (dom.btnPreviewEditorPdf) dom.btnPreviewEditorPdf.disabled = !hasDoc;

    syncEvidenceAttachControl();
  }

  function syncEvidenceAttachControl() {
    if (!dom.chkAttachEvidences || !dom.attachEvidencesLabel) return;
    const stats = global.AppEvidencesApi ? global.AppEvidencesApi.getStats() : { totalPhotos: 0 };
    const n = stats.totalPhotos || 0;
    dom.chkAttachEvidences.disabled = n === 0;
    if (n === 0) {
      editor.attachEvidences = false;
      dom.chkAttachEvidences.checked = false;
      dom.attachEvidencesLabel.textContent = 'Anexar evidencias fotográficas (sin fotos cargadas)';
    } else {
      dom.attachEvidencesLabel.textContent = `Anexar evidencias fotográficas (${n} ${n === 1 ? 'foto' : 'fotos'})`;
    }
  }

  function setTool(nextTool) {
    editor.tool = nextTool;
    editor.editingTextId = null;
    if (nextTool !== 'select') {
      editor.selectedId = null;
    }
    dom.toolButtons.forEach((btn) => {
      const active = btn.getAttribute('data-ed-tool') === nextTool;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    if (dom.pagesContainer) {
      dom.pagesContainer.setAttribute('data-active-tool', nextTool);
    }
    updateContextualToolbar();
    renderAllOverlays();
  }

  function updateContextualToolbar() {
    const sel = getSelectedAnnotation();
    const activeType = sel ? sel.type : editor.tool;

    const showFontControls = activeType === 'text' || activeType === 'mark';
    const showBgToggle = activeType === 'text';
    const showMarkChoice = activeType === 'mark';
    const showStrokeWidth = activeType === 'draw';
    const showColors = activeType === 'text' || activeType === 'mark' || activeType === 'draw';

    if (dom.grpFont) dom.grpFont.hidden = !showFontControls;
    if (dom.grpBg) dom.grpBg.hidden = !showBgToggle;
    if (dom.grpMark) dom.grpMark.hidden = !showMarkChoice;
    if (dom.grpStroke) dom.grpStroke.hidden = !showStrokeWidth;
    if (dom.grpColors) dom.grpColors.hidden = !showColors;
    if (dom.grpSelection) dom.grpSelection.hidden = !sel;

    const currentSize = sel && sel.type === 'text'
      ? sel.fontSize
      : sel && sel.type === 'mark'
        ? sel.size
        : editor.style.fontSize;
    if (dom.fontSizeDisplay) dom.fontSizeDisplay.textContent = `${Math.round(currentSize)} pt`;

    const currentBold = sel && sel.type === 'text' ? sel.bold : editor.style.bold;
    if (dom.btnBold) {
      dom.btnBold.classList.toggle('is-active', Boolean(currentBold));
      dom.btnBold.setAttribute('aria-pressed', String(Boolean(currentBold)));
    }

    const currentBgWhite = (sel && sel.type === 'text' ? sel.bgFill : editor.style.bgFill) === '#ffffff';
    if (dom.btnBgWhite) {
      dom.btnBgWhite.classList.toggle('is-active', currentBgWhite);
      dom.btnBgWhite.setAttribute('aria-pressed', String(currentBgWhite));
    }

    const currentColor = (sel && sel.color) || editor.style.color;
    dom.colorButtons.forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-ed-color') === currentColor);
    });

    const currentMark = (sel && sel.type === 'mark' ? sel.symbol : editor.style.markSymbol);
    dom.markButtons.forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-ed-mark') === currentMark);
    });

    const currentStroke = (sel && sel.type === 'draw' ? sel.strokeWidth : editor.style.strokeWidth);
    dom.strokeButtons.forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.getAttribute('data-ed-stroke')) === Number(currentStroke));
    });

    if (dom.zoomDisplay) {
      dom.zoomDisplay.textContent = `${Math.round(editor.zoom * 100)}%`;
    }
  }

  /* -------------------- Carga y Renderizado de PDF con pdf.js -------------------- */

  async function loadPdfFromBytes(bytes, fileName, restoredAnnotations) {
    if (!global.pdfjsLib) {
      toast('No se pudo cargar el motor de lectura de PDF.');
      return;
    }
    ensurePdfJsWorker();

    const copyForStorage = new Uint8Array(bytes);
    const copyForPdfJs = new Uint8Array(bytes);

    try {
      const loadingTask = global.pdfjsLib.getDocument({ data: copyForPdfJs });
      const pdfProxy = await loadingTask.promise;

      editor.fileName = fileName || 'documento.pdf';
      editor.rawPdfBytes = copyForStorage;
      editor.pdfDocProxy = pdfProxy;
      editor.pagesMeta = [];
      editor.annotations = Array.isArray(restoredAnnotations) ? cloneAnnotations(restoredAnnotations) : [];
      editor.selectedId = null;
      editor.editingTextId = null;
      editor.undoStack = [];
      editor.redoStack = [];
      invalidateExportCache();

      for (let i = 1; i <= pdfProxy.numPages; i++) {
        const page = await pdfProxy.getPage(i);
        const vp1 = page.getViewport({ scale: 1 });
        editor.pagesMeta.push({
          pageIndex: i - 1,
          widthPt: vp1.width,
          heightPt: vp1.height,
          rotation: page.rotate || 0
        });
      }

      updateStatusBar();
      updateHistoryButtons();
      updateContextualToolbar();
      await renderAllPages();
      scheduleEditorSave();
    } catch (err) {
      console.error(err);
      toast('No se pudo abrir el PDF. Verifica que el archivo no esté dañado.');
    }
  }

  async function renderAllPages() {
    if (!editor.pdfDocProxy || !dom.pagesContainer) return;
    dom.pagesContainer.innerHTML = '';

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    for (let i = 0; i < editor.pagesMeta.length; i++) {
      const meta = editor.pagesMeta[i];
      const page = await editor.pdfDocProxy.getPage(i + 1);
      const vp = page.getViewport({ scale: editor.zoom });

      const sheet = document.createElement('div');
      sheet.className = 'pdf-page-sheet';

      const pageBadge = document.createElement('div');
      pageBadge.className = 'pdf-page-badge';
      pageBadge.textContent = `Página ${i + 1} de ${editor.pagesMeta.length}`;
      sheet.appendChild(pageBadge);

      const stage = document.createElement('div');
      stage.className = 'pdf-page-stage';
      stage.dataset.pageIndex = String(i);
      stage.style.width = `${vp.width}px`;
      stage.style.height = `${vp.height}px`;

      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      canvas.width = Math.round(vp.width * dpr);
      canvas.height = Math.round(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;

      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const overlay = document.createElement('div');
      overlay.className = 'pdf-page-overlay';
      overlay.dataset.pageIndex = String(i);

      // Canvas temporal para trazo libre (lápiz/firma)
      const drawCanvas = document.createElement('canvas');
      drawCanvas.className = 'pdf-draw-layer';
      drawCanvas.width = Math.round(vp.width * dpr);
      drawCanvas.height = Math.round(vp.height * dpr);
      drawCanvas.style.width = `${vp.width}px`;
      drawCanvas.style.height = `${vp.height}px`;

      attachPageInteraction(overlay, drawCanvas, i, dpr);

      stage.appendChild(canvas);
      stage.appendChild(overlay);
      stage.appendChild(drawCanvas);
      sheet.appendChild(stage);
      dom.pagesContainer.appendChild(sheet);
    }

    renderAllOverlays();
  }

  /* -------------------- Interacción sobre cada Página -------------------- */

  function attachPageInteraction(overlay, drawCanvas, pageIndex, dpr) {
    let drawPoints = null;
    let rectDraft = null;
    let rectPreviewEl = null;

    function ptCoords(e) {
      const rect = overlay.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(editor.pagesMeta[pageIndex].widthPt, (e.clientX - rect.left) / editor.zoom)),
        y: Math.max(0, Math.min(editor.pagesMeta[pageIndex].heightPt, (e.clientY - rect.top) / editor.zoom))
      };
    }

    overlay.addEventListener('pointerdown', (e) => {
      // Ignorar clics que ya fueron manejados sobre una anotación en modo seleccionar
      if (e.target !== overlay) return;

      const pt = ptCoords(e);

      if (editor.tool === 'select') {
        if (editor.selectedId || editor.editingTextId) {
          commitEmptyTextCleanup();
          editor.selectedId = null;
          editor.editingTextId = null;
          updateContextualToolbar();
          renderAllOverlays();
        }
        return;
      }

      if (editor.tool === 'text') {
        e.preventDefault();
        commitEmptyTextCleanup();
        pushHistory();
        const pageW = editor.pagesMeta[pageIndex].widthPt;
        const boxW = Math.min(180, Math.max(80, pageW - pt.x - 16));
        const newId = uid('txt');
        editor.annotations.push({
          id: newId,
          pageIndex,
          type: 'text',
          x: Math.max(6, Math.min(pt.x, pageW - 60)),
          y: Math.max(4, pt.y - editor.style.fontSize * 0.6),
          w: boxW,
          h: Math.max(20, editor.style.fontSize * 1.6),
          text: '',
          fontSize: editor.style.fontSize,
          bold: editor.style.bold,
          color: editor.style.color,
          bgFill: editor.style.bgFill
        });
        editor.selectedId = newId;
        editor.editingTextId = newId;
        updateStatusBar();
        updateContextualToolbar();
        renderPageOverlay(pageIndex);
        scheduleEditorSave();
        focusEditingTextarea(newId);
        return;
      }

      if (editor.tool === 'mark') {
        e.preventDefault();
        pushHistory();
        const size = Math.max(10, Math.min(24, editor.style.fontSize + 2));
        const newId = uid('mrk');
        editor.annotations.push({
          id: newId,
          pageIndex,
          type: 'mark',
          x: Math.max(2, pt.x - size / 2),
          y: Math.max(2, pt.y - size / 2),
          size,
          symbol: editor.style.markSymbol,
          color: editor.style.color
        });
        editor.selectedId = newId;
        updateStatusBar();
        updateContextualToolbar();
        renderPageOverlay(pageIndex);
        scheduleEditorSave();
        return;
      }

      if (editor.tool === 'rect') {
        e.preventDefault();
        overlay.setPointerCapture(e.pointerId);
        rectDraft = { startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y };
        rectPreviewEl = document.createElement('div');
        rectPreviewEl.className = 'pdf-rect-draft';
        overlay.appendChild(rectPreviewEl);
        updateDraftRectVisual();
        return;
      }

      if (editor.tool === 'draw') {
        e.preventDefault();
        overlay.setPointerCapture(e.pointerId);
        drawPoints = [pt];
        drawLiveStroke(drawCanvas, drawPoints, dpr);
      }
    });

    function updateDraftRectVisual() {
      if (!rectDraft || !rectPreviewEl) return;
      const x = Math.min(rectDraft.startX, rectDraft.curX);
      const y = Math.min(rectDraft.startY, rectDraft.curY);
      const w = Math.abs(rectDraft.curX - rectDraft.startX);
      const h = Math.abs(rectDraft.curY - rectDraft.startY);
      rectPreviewEl.style.left = `${x * editor.zoom}px`;
      rectPreviewEl.style.top = `${y * editor.zoom}px`;
      rectPreviewEl.style.width = `${w * editor.zoom}px`;
      rectPreviewEl.style.height = `${h * editor.zoom}px`;
    }

    overlay.addEventListener('pointermove', (e) => {
      if (rectDraft) {
        const pt = ptCoords(e);
        rectDraft.curX = pt.x;
        rectDraft.curY = pt.y;
        updateDraftRectVisual();
        return;
      }
      if (drawPoints) {
        drawPoints.push(ptCoords(e));
        drawLiveStroke(drawCanvas, drawPoints, dpr);
      }
    });

    function finishDragTool() {
      if (rectDraft) {
        const x = Math.min(rectDraft.startX, rectDraft.curX);
        const y = Math.min(rectDraft.startY, rectDraft.curY);
        let w = Math.abs(rectDraft.curX - rectDraft.startX);
        let h = Math.abs(rectDraft.curY - rectDraft.startY);
        if (w < 8 && h < 8) {
          w = 96;
          h = 18;
        }
        if (rectPreviewEl) rectPreviewEl.remove();
        rectPreviewEl = null;
        rectDraft = null;

        pushHistory();
        const newId = uid('rct');
        editor.annotations.push({
          id: newId,
          pageIndex,
          type: 'rect',
          x,
          y,
          w: Math.max(12, w),
          h: Math.max(10, h),
          bgFill: '#ffffff'
        });
        editor.selectedId = newId;
        updateStatusBar();
        updateContextualToolbar();
        renderPageOverlay(pageIndex);
        scheduleEditorSave();
        return;
      }

      if (drawPoints) {
        const pts = drawPoints;
        drawPoints = null;
        const ctx = drawCanvas.getContext('2d');
        ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

        if (pts.length >= 2) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of pts) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
          const pad = 4;
          minX = Math.max(0, minX - pad);
          minY = Math.max(0, minY - pad);
          const w = Math.max(12, maxX - minX + pad);
          const h = Math.max(12, maxY - minY + pad);
          const normalized = pts.map((p) => ({
            x: (p.x - minX) / w,
            y: (p.y - minY) / h
          }));

          pushHistory();
          const newId = uid('drw');
          editor.annotations.push({
            id: newId,
            pageIndex,
            type: 'draw',
            x: minX,
            y: minY,
            w,
            h,
            color: editor.style.color,
            strokeWidth: editor.style.strokeWidth,
            points: [normalized]
          });
          editor.selectedId = newId;
          updateStatusBar();
          updateContextualToolbar();
          renderPageOverlay(pageIndex);
          scheduleEditorSave();
        }
      }
    }

    overlay.addEventListener('pointerup', finishDragTool);
    overlay.addEventListener('pointercancel', finishDragTool);
  }

  function drawLiveStroke(canvas, pts, dpr) {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!pts || pts.length < 2) return;
    ctx.strokeStyle = editor.style.color;
    ctx.lineWidth = editor.style.strokeWidth * editor.zoom;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x * editor.zoom, pts[0].y * editor.zoom);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x * editor.zoom, pts[i].y * editor.zoom);
    }
    ctx.stroke();
  }

  function commitEmptyTextCleanup() {
    if (!editor.editingTextId) return;
    const target = editor.annotations.find((a) => a.id === editor.editingTextId);
    if (target && target.type === 'text' && !target.text.trim()) {
      editor.annotations = editor.annotations.filter((a) => a.id !== target.id);
      if (editor.selectedId === target.id) editor.selectedId = null;
      updateStatusBar();
      scheduleEditorSave();
    }
  }

  function focusEditingTextarea(annotId) {
    requestAnimationFrame(() => {
      const ta = dom.pagesContainer && dom.pagesContainer.querySelector(`textarea[data-edit-id="${annotId}"]`);
      if (ta) {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = ta.value.length;
        autoResizeTextarea(ta, annotId);
      }
    });
  }

  function autoResizeTextarea(ta, annotId) {
    ta.style.height = 'auto';
    const nextH = Math.max(ta.scrollHeight, 20);
    ta.style.height = `${nextH}px`;
    const ann = editor.annotations.find((a) => a.id === annotId);
    if (ann) {
      ann.h = nextH / editor.zoom;
    }
  }

  /* -------------------- Renderizado de Anotaciones DOM -------------------- */

  function renderAllOverlays() {
    for (let i = 0; i < editor.pagesMeta.length; i++) {
      renderPageOverlay(i);
    }
  }

  function renderPageOverlay(pageIndex) {
    if (!dom.pagesContainer) return;
    const overlay = dom.pagesContainer.querySelector(`.pdf-page-overlay[data-page-index="${pageIndex}"]`);
    if (!overlay) return;
    overlay.innerHTML = '';

    const pageAnnots = editor.annotations.filter((a) => a.pageIndex === pageIndex);
    for (const ann of pageAnnots) {
      const el = buildAnnotationElement(ann);
      overlay.appendChild(el);
    }
  }

  function buildAnnotationElement(ann) {
    const z = editor.zoom;
    const isSelected = ann.id === editor.selectedId;
    const isEditing = ann.id === editor.editingTextId;

    const wrap = document.createElement('div');
    wrap.className = `pdf-annot pdf-annot-${ann.type}${isSelected ? ' is-selected' : ''}${isEditing ? ' is-editing' : ''}`;
    wrap.dataset.annotId = ann.id;
    wrap.style.left = `${ann.x * z}px`;
    wrap.style.top = `${ann.y * z}px`;

    if (ann.type === 'text') {
      wrap.style.width = `${ann.w * z}px`;
      wrap.style.minHeight = `${Math.max(18, ann.fontSize * 1.4) * z}px`;
      wrap.style.background = ann.bgFill === '#ffffff' ? '#ffffff' : 'transparent';

      if (isEditing) {
        const ta = document.createElement('textarea');
        ta.className = 'pdf-text-editor';
        ta.dataset.editId = ann.id;
        ta.value = ann.text;
        ta.placeholder = 'Escribe aquí...';
        ta.style.fontSize = `${ann.fontSize * z}px`;
        ta.style.fontWeight = ann.bold ? '700' : '400';
        ta.style.color = ann.color;
        ta.rows = 1;
        ta.addEventListener('pointerdown', (e) => e.stopPropagation());
        ta.addEventListener('input', (e) => {
          ann.text = e.target.value;
          autoResizeTextarea(ta, ann.id);
          scheduleEditorSave();
        });
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            commitEmptyTextCleanup();
            editor.editingTextId = null;
            renderPageOverlay(ann.pageIndex);
            updateContextualToolbar();
          }
        });
        wrap.appendChild(ta);
        requestAnimationFrame(() => autoResizeTextarea(ta, ann.id));
      } else {
        const display = document.createElement('div');
        display.className = 'pdf-text-display';
        display.textContent = ann.text || 'Texto vacío';
        display.style.fontSize = `${ann.fontSize * z}px`;
        display.style.fontWeight = ann.bold ? '700' : '400';
        display.style.color = ann.color;
        if (!ann.text) display.style.opacity = '0.45';
        wrap.appendChild(display);
      }

      wrap.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        editor.selectedId = ann.id;
        editor.editingTextId = ann.id;
        setToolForEditOnly();
        renderPageOverlay(ann.pageIndex);
        updateContextualToolbar();
        focusEditingTextarea(ann.id);
      });
    } else if (ann.type === 'mark') {
      wrap.style.width = `${ann.size * z}px`;
      wrap.style.height = `${ann.size * z}px`;
      wrap.style.color = ann.color;
      if (ann.symbol === 'check') {
        wrap.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%">' +
          '<polyline points="20 6 9 17 4 12"></polyline></svg>';
      } else {
        const sp = document.createElement('span');
        sp.className = 'pdf-mark-x';
        sp.textContent = 'X';
        sp.style.fontSize = `${ann.size * z * 0.92}px`;
        wrap.appendChild(sp);
      }
    } else if (ann.type === 'rect') {
      wrap.style.width = `${ann.w * z}px`;
      wrap.style.height = `${ann.h * z}px`;
      wrap.style.background = ann.bgFill || '#ffffff';
    } else if (ann.type === 'draw') {
      wrap.style.width = `${ann.w * z}px`;
      wrap.style.height = `${ann.h * z}px`;
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${ann.w} ${ann.h}`);
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.style.overflow = 'visible';

      for (const stroke of ann.points || []) {
        if (!stroke || stroke.length < 2) continue;
        const poly = document.createElementNS(svgNS, 'polyline');
        const ptsAttr = stroke.map((p) => `${(p.x * ann.w).toFixed(2)},${(p.y * ann.h).toFixed(2)}`).join(' ');
        poly.setAttribute('points', ptsAttr);
        poly.setAttribute('fill', 'none');
        poly.setAttribute('stroke', ann.color || '#111827');
        poly.setAttribute('stroke-width', String(ann.strokeWidth || 2));
        poly.setAttribute('stroke-linecap', 'round');
        poly.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(poly);
      }
      wrap.appendChild(svg);
    } else if (ann.type === 'image') {
      wrap.style.width = `${ann.w * z}px`;
      wrap.style.height = `${ann.h * z}px`;
      const img = document.createElement('img');
      img.src = ann.dataUrl;
      img.alt = 'Imagen insertada';
      img.draggable = false;
      wrap.appendChild(img);
    }

    // Selección y arrastre de anotaciones
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('annot-handle') || e.target.classList.contains('annot-del-btn')) return;
      if (isEditing && e.target.tagName === 'TEXTAREA') return;

      e.stopPropagation();
      if (editor.editingTextId && editor.editingTextId !== ann.id) {
        commitEmptyTextCleanup();
        editor.editingTextId = null;
      }

      editor.selectedId = ann.id;
      if (editor.tool !== 'select') {
        setToolForEditOnly();
      }
      updateContextualToolbar();
      renderAllOverlays();

      // Iniciar arrastre
      const freshWrap = dom.pagesContainer.querySelector(`.pdf-annot[data-annot-id="${ann.id}"]`);
      if (!freshWrap) return;
      startDragAnnotation(e, ann, freshWrap);
    });

    // Controles de selección (botón eliminar y manijas de redimensión)
    if (isSelected) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'annot-del-btn';
      delBtn.title = 'Eliminar (Supr)';
      delBtn.textContent = '×';
      delBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSelectedAnnotation();
      });
      wrap.appendChild(delBtn);

      if (ann.type === 'text') {
        const handleE = document.createElement('div');
        handleE.className = 'annot-handle handle-e';
        handleE.title = 'Cambiar ancho';
        handleE.addEventListener('pointerdown', (e) => startResizeAnnotation(e, ann, wrap, 'e'));
        wrap.appendChild(handleE);
      } else if (ann.type === 'rect' || ann.type === 'image' || ann.type === 'draw') {
        const handleSE = document.createElement('div');
        handleSE.className = 'annot-handle handle-se';
        handleSE.title = 'Redimensionar';
        handleSE.addEventListener('pointerdown', (e) => startResizeAnnotation(e, ann, wrap, 'se'));
        wrap.appendChild(handleSE);
      }
    }

    return wrap;
  }

  function setToolForEditOnly() {
    editor.tool = 'select';
    dom.toolButtons.forEach((btn) => {
      const active = btn.getAttribute('data-ed-tool') === 'select';
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    if (dom.pagesContainer) {
      dom.pagesContainer.setAttribute('data-active-tool', 'select');
    }
  }

  function startDragAnnotation(startEvent, ann, el) {
    const startClientX = startEvent.clientX;
    const startClientY = startEvent.clientY;
    const origX = ann.x;
    const origY = ann.y;
    const meta = editor.pagesMeta[ann.pageIndex];
    let moved = false;
    let pushed = false;

    function onMove(e) {
      const dx = (e.clientX - startClientX) / editor.zoom;
      const dy = (e.clientY - startClientY) / editor.zoom;
      if (!moved && Math.hypot(dx, dy) < 2) return;
      if (!pushed) {
        pushHistory();
        pushed = true;
      }
      moved = true;
      const boxW = ann.w || ann.size || 20;
      const boxH = ann.h || ann.size || 20;
      ann.x = Math.max(0, Math.min(meta.widthPt - Math.min(boxW, 20), origX + dx));
      ann.y = Math.max(0, Math.min(meta.heightPt - Math.min(boxH, 20), origY + dy));
      el.style.left = `${ann.x * editor.zoom}px`;
      el.style.top = `${ann.y * editor.zoom}px`;
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) scheduleEditorSave();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function startResizeAnnotation(startEvent, ann, el, dir) {
    startEvent.stopPropagation();
    startEvent.preventDefault();
    const startClientX = startEvent.clientX;
    const startClientY = startEvent.clientY;
    const origW = ann.w;
    const origH = ann.h;
    const meta = editor.pagesMeta[ann.pageIndex];
    pushHistory();

    function onMove(e) {
      const dx = (e.clientX - startClientX) / editor.zoom;
      const dy = (e.clientY - startClientY) / editor.zoom;
      if (dir === 'e') {
        ann.w = Math.max(36, Math.min(meta.widthPt - ann.x - 4, origW + dx));
        el.style.width = `${ann.w * editor.zoom}px`;
        const ta = el.querySelector('textarea');
        if (ta) autoResizeTextarea(ta, ann.id);
      } else if (dir === 'se') {
        if (ann.type === 'image' && ann.aspect) {
          const nextW = Math.max(24, Math.min(meta.widthPt - ann.x - 4, origW + dx));
          ann.w = nextW;
          ann.h = nextW / ann.aspect;
        } else {
          ann.w = Math.max(16, Math.min(meta.widthPt - ann.x - 4, origW + dx));
          ann.h = Math.max(12, Math.min(meta.heightPt - ann.y - 4, origH + dy));
        }
        el.style.width = `${ann.w * editor.zoom}px`;
        el.style.height = `${ann.h * editor.zoom}px`;
      }
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      renderPageOverlay(ann.pageIndex);
      scheduleEditorSave();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /* -------------------- Acciones de Edición -------------------- */

  function deleteSelectedAnnotation() {
    if (!editor.selectedId) return;
    const target = getSelectedAnnotation();
    if (!target) return;
    pushHistory();
    editor.annotations = editor.annotations.filter((a) => a.id !== target.id);
    editor.selectedId = null;
    editor.editingTextId = null;
    updateStatusBar();
    updateContextualToolbar();
    renderPageOverlay(target.pageIndex);
    scheduleEditorSave();
  }

  function duplicateSelectedAnnotation() {
    const src = getSelectedAnnotation();
    if (!src) return;
    pushHistory();
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid(src.type.slice(0, 3));
    const meta = editor.pagesMeta[src.pageIndex];
    copy.x = Math.min(meta.widthPt - 30, copy.x + 14);
    copy.y = Math.min(meta.heightPt - 20, copy.y + 14);
    editor.annotations.push(copy);
    editor.selectedId = copy.id;
    editor.editingTextId = null;
    updateStatusBar();
    updateContextualToolbar();
    renderPageOverlay(copy.pageIndex);
    scheduleEditorSave();
  }

  function applyStyleChange(mutator) {
    mutator(editor.style);
    const sel = getSelectedAnnotation();
    if (sel) {
      pushHistory();
      if (sel.type === 'text') {
        sel.fontSize = editor.style.fontSize;
        sel.bold = editor.style.bold;
        sel.color = editor.style.color;
        sel.bgFill = editor.style.bgFill;
      } else if (sel.type === 'mark') {
        sel.size = Math.max(10, Math.min(26, editor.style.fontSize + 2));
        sel.symbol = editor.style.markSymbol;
        sel.color = editor.style.color;
      } else if (sel.type === 'draw') {
        sel.color = editor.style.color;
        sel.strokeWidth = editor.style.strokeWidth;
      }
      renderPageOverlay(sel.pageIndex);
      scheduleEditorSave();
    }
    updateContextualToolbar();
  }

  function undo() {
    if (editor.undoStack.length === 0) return;
    editor.redoStack.push(cloneAnnotations(editor.annotations));
    editor.annotations = editor.undoStack.pop();
    editor.selectedId = null;
    editor.editingTextId = null;
    updateHistoryButtons();
    updateStatusBar();
    updateContextualToolbar();
    renderAllOverlays();
    scheduleEditorSave();
  }

  function redo() {
    if (editor.redoStack.length === 0) return;
    editor.undoStack.push(cloneAnnotations(editor.annotations));
    editor.annotations = editor.redoStack.pop();
    editor.selectedId = null;
    editor.editingTextId = null;
    updateHistoryButtons();
    updateStatusBar();
    updateContextualToolbar();
    renderAllOverlays();
    scheduleEditorSave();
  }

  function getMostVisiblePageIndex() {
    if (!dom.pagesContainer || editor.pagesMeta.length === 0) return 0;
    const stages = dom.pagesContainer.querySelectorAll('.pdf-page-stage');
    const midY = window.innerHeight / 2;
    let bestIdx = 0;
    let bestDist = Infinity;
    stages.forEach((st, idx) => {
      const r = st.getBoundingClientRect();
      const center = (r.top + r.bottom) / 2;
      const dist = Math.abs(center - midY);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    });
    return bestIdx;
  }

  async function insertImageFile(file) {
    if (!editor.rawPdfBytes || !file) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Error leyendo imagen'));
      reader.readAsDataURL(file);
    });

    const dims = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 200, h: img.naturalHeight || 150 });
      img.onerror = () => reject(new Error('Imagen no válida'));
      img.src = dataUrl;
    });

    const pageIndex = getMostVisiblePageIndex();
    const meta = editor.pagesMeta[pageIndex];
    const maxW = Math.min(200, meta.widthPt * 0.45);
    const ratio = dims.w / dims.h;
    const drawW = Math.min(maxW, dims.w);
    const drawH = drawW / ratio;

    pushHistory();
    const newId = uid('img');
    editor.annotations.push({
      id: newId,
      pageIndex,
      type: 'image',
      x: Math.max(20, (meta.widthPt - drawW) / 2),
      y: Math.max(30, meta.heightPt * 0.25),
      w: drawW,
      h: drawH,
      aspect: ratio,
      dataUrl
    });

    setTool('select');
    editor.selectedId = newId;
    updateStatusBar();
    updateContextualToolbar();
    renderPageOverlay(pageIndex);
    scheduleEditorSave();
    toast('Imagen insertada en el documento');
  }

  /* -------------------- Exportación Vectorial con pdf-lib -------------------- */

  async function rasterizeDataUrlToPngBytes(dataUrl) {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo cargar imagen insertada'));
      el.src = dataUrl;
    });
    const maxEdge = 1200;
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    const pngUrl = c.toDataURL('image/png');
    const bin = atob(pngUrl.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function exportEditedPdfBlob() {
    if (!editor.rawPdfBytes || !global.PDFLib) {
      throw new Error('No hay documento PDF cargado');
    }
    commitEmptyTextCleanup();

    const { PDFDocument, StandardFonts, rgb, LineCapStyle } = global.PDFLib;
    const outDoc = await PDFDocument.load(editor.rawPdfBytes, { ignoreEncryption: true });
    const fontRegular = await outDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await outDoc.embedFont(StandardFonts.HelveticaBold);
    const pdfPages = outDoc.getPages();

    for (const ann of editor.annotations) {
      const pdfPage = pdfPages[ann.pageIndex];
      if (!pdfPage) continue;

      const crop = pdfPage.getCropBox();
      const baseX = crop.x || 0;
      const baseY = crop.y || 0;
      const pageH = crop.height || pdfPage.getHeight();

      if (ann.type === 'rect') {
        const c = hexToRgbNorm(ann.bgFill || '#ffffff');
        pdfPage.drawRectangle({
          x: baseX + ann.x,
          y: baseY + pageH - ann.y - ann.h,
          width: ann.w,
          height: ann.h,
          color: rgb(c.r, c.g, c.b)
        });
      } else if (ann.type === 'text') {
        const textVal = (ann.text || '').trimEnd();
        const font = ann.bold ? fontBold : fontRegular;
        const size = ann.fontSize || 10;
        const lineH = size * 1.25;
        const padX = 4;
        const padY = 2;
        const lines = wrapLinesPdfLib(textVal, font, size, Math.max(20, ann.w - padX * 2));
        const boxH = Math.max(ann.h || 0, lines.length * lineH + padY * 2);

        if (ann.bgFill === '#ffffff') {
          pdfPage.drawRectangle({
            x: baseX + ann.x,
            y: baseY + pageH - ann.y - boxH,
            width: ann.w,
            height: boxH,
            color: rgb(1, 1, 1)
          });
        }

        const c = hexToRgbNorm(ann.color);
        lines.forEach((ln, idx) => {
          if (!ln) return;
          const baselineY = baseY + pageH - (ann.y + padY + size * 0.88 + idx * lineH);
          pdfPage.drawText(ln, {
            x: baseX + ann.x + padX,
            y: baselineY,
            size,
            font,
            color: rgb(c.r, c.g, c.b)
          });
        });
      } else if (ann.type === 'mark') {
        const c = hexToRgbNorm(ann.color);
        const sz = ann.size || 12;
        if (ann.symbol === 'check') {
          const x0 = baseX + ann.x;
          const yTop = baseY + pageH - ann.y;
          const p1 = { x: x0 + sz * 0.16, y: yTop - sz * 0.54 };
          const p2 = { x: x0 + sz * 0.42, y: yTop - sz * 0.80 };
          const p3 = { x: x0 + sz * 0.86, y: yTop - sz * 0.22 };
          const thick = Math.max(1.4, sz * 0.14);
          pdfPage.drawLine({ start: p1, end: p2, thickness: thick, color: rgb(c.r, c.g, c.b), lineCap: LineCapStyle.Round });
          pdfPage.drawLine({ start: p2, end: p3, thickness: thick, color: rgb(c.r, c.g, c.b), lineCap: LineCapStyle.Round });
        } else {
          const fontSize = sz * 0.92;
          const tw = fontBold.widthOfTextAtSize('X', fontSize);
          pdfPage.drawText('X', {
            x: baseX + ann.x + (sz - tw) / 2,
            y: baseY + pageH - (ann.y + sz * 0.82),
            size: fontSize,
            font: fontBold,
            color: rgb(c.r, c.g, c.b)
          });
        }
      } else if (ann.type === 'draw') {
        const c = hexToRgbNorm(ann.color);
        const thick = ann.strokeWidth || 2;
        for (const stroke of ann.points || []) {
          if (!stroke || stroke.length < 2) continue;
          for (let i = 1; i < stroke.length; i++) {
            const a = stroke[i - 1];
            const b = stroke[i];
            pdfPage.drawLine({
              start: { x: baseX + ann.x + a.x * ann.w, y: baseY + pageH - (ann.y + a.y * ann.h) },
              end: { x: baseX + ann.x + b.x * ann.w, y: baseY + pageH - (ann.y + b.y * ann.h) },
              thickness: thick,
              color: rgb(c.r, c.g, c.b),
              lineCap: LineCapStyle.Round
            });
          }
        }
      } else if (ann.type === 'image' && ann.dataUrl) {
        const pngBytes = await rasterizeDataUrlToPngBytes(ann.dataUrl);
        const embedded = await outDoc.embedPng(pngBytes);
        pdfPage.drawImage(embedded, {
          x: baseX + ann.x,
          y: baseY + pageH - ann.y - ann.h,
          width: ann.w,
          height: ann.h
        });
      }
    }

    // Anexar evidencias fotográficas si está activado y existen fotos cargadas
    if (editor.attachEvidences && global.AppEvidencesApi) {
      const stats = global.AppEvidencesApi.getStats();
      if (stats.totalPhotos > 0) {
        const evBlob = await global.AppEvidencesApi.generateEvidencesOnlyPdfBlob();
        const evDoc = await PDFDocument.load(await evBlob.arrayBuffer());
        const copiedPages = await outDoc.copyPages(evDoc, evDoc.getPageIndices());
        copiedPages.forEach((p) => outDoc.addPage(p));
      }
    }

    const outBytes = await outDoc.save();
    return new Blob([outBytes], { type: 'application/pdf' });
  }

  function buildExportFilename() {
    const base = (editor.fileName || 'documento.pdf').replace(/\.pdf$/i, '');
    const suffix = editor.attachEvidences ? '_editado_con_evidencias.pdf' : '_editado.pdf';
    return `${base}${suffix}`;
  }

  async function runExport(mode) {
    if (!editor.rawPdfBytes) return;
    const origExport = dom.btnExportPdf.innerHTML;
    const origPrev = dom.btnPreviewEditorPdf.textContent;
    dom.btnExportPdf.disabled = true;
    dom.btnPreviewEditorPdf.disabled = true;
    if (mode === 'download') dom.btnExportPdf.textContent = 'Exportando PDF...';
    else dom.btnPreviewEditorPdf.textContent = 'Preparando...';

    try {
      const blob = await exportEditedPdfBlob();
      invalidateExportCache();
      editor.lastExportBlobUrl = URL.createObjectURL(blob);
      const filename = buildExportFilename();

      if (mode === 'download') {
        const a = document.createElement('a');
        a.href = editor.lastExportBlobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast(`PDF exportado: ${filename}`);
      } else if (global.AppEvidencesApi && global.AppEvidencesApi.openPdfPreview) {
        global.AppEvidencesApi.openPdfPreview(editor.lastExportBlobUrl, filename);
      }
    } catch (err) {
      console.error(err);
      toast('Error al exportar el PDF editado. Intenta nuevamente.');
    } finally {
      dom.btnExportPdf.innerHTML = origExport;
      dom.btnPreviewEditorPdf.textContent = origPrev;
      updateStatusBar();
    }
  }

  /* -------------------- Enlace DOM e Inicialización -------------------- */

  async function handlePdfFileUpload(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      toast('Por favor selecciona un archivo PDF (.pdf)');
      return;
    }
    const buf = await file.arrayBuffer();
    await loadPdfFromBytes(new Uint8Array(buf), file.name, []);
    toast(`PDF cargado: ${file.name}`);
  }

  function bindEvents() {
    // Subida de PDF (clic y arrastrar/soltar)
    if (dom.pdfFileInput) {
      dom.pdfFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          handlePdfFileUpload(e.target.files[0]);
          dom.pdfFileInput.value = '';
        }
      });
    }

    if (dom.btnPickPdf) dom.btnPickPdf.addEventListener('click', () => dom.pdfFileInput.click());
    if (dom.btnChangePdf) dom.btnChangePdf.addEventListener('click', () => dom.pdfFileInput.click());

    if (dom.pdfDropzone) {
      dom.pdfDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.pdfDropzone.classList.add('is-dragover');
      });
      dom.pdfDropzone.addEventListener('dragleave', () => dom.pdfDropzone.classList.remove('is-dragover'));
      dom.pdfDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.pdfDropzone.classList.remove('is-dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          handlePdfFileUpload(e.dataTransfer.files[0]);
        }
      });
    }

    // Plantilla integrada (Reporte de Asistencia + Formato de Inventario)
    if (dom.btnLoadTemplate) {
      dom.btnLoadTemplate.addEventListener('click', async () => {
        dom.btnLoadTemplate.disabled = true;
        const orig = dom.btnLoadTemplate.textContent;
        dom.btnLoadTemplate.textContent = 'Generando plantilla...';
        try {
          const bytes = await buildIntegratedTemplateBytes();
          await loadPdfFromBytes(bytes, 'Reporte_Asistencia_e_Inventario.pdf', []);
          toast('Plantilla de 2 páginas cargada en el editor');
        } catch (err) {
          console.error(err);
          toast('No se pudo generar la plantilla integrada');
        } finally {
          dom.btnLoadTemplate.disabled = false;
          dom.btnLoadTemplate.textContent = orig;
        }
      });
    }

    // Herramientas
    dom.toolButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-ed-tool');
        if (t === 'image') {
          if (dom.imageInsertInput) dom.imageInsertInput.click();
          return;
        }
        setTool(t);
      });
    });

    if (dom.imageInsertInput) {
      dom.imageInsertInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          insertImageFile(e.target.files[0]);
          dom.imageInsertInput.value = '';
        }
      });
    }

    // Tamaño de fuente
    if (dom.btnFontMinus) {
      dom.btnFontMinus.addEventListener('click', () => {
        applyStyleChange((s) => {
          s.fontSize = Math.max(7, s.fontSize - 1);
        });
      });
    }
    if (dom.btnFontPlus) {
      dom.btnFontPlus.addEventListener('click', () => {
        applyStyleChange((s) => {
          s.fontSize = Math.min(28, s.fontSize + 1);
        });
      });
    }

    // Negrita y fondo blanco
    if (dom.btnBold) {
      dom.btnBold.addEventListener('click', () => {
        applyStyleChange((s) => {
          s.bold = !s.bold;
        });
      });
    }
    if (dom.btnBgWhite) {
      dom.btnBgWhite.addEventListener('click', () => {
        applyStyleChange((s) => {
          s.bgFill = s.bgFill === '#ffffff' ? 'transparent' : '#ffffff';
        });
      });
    }

    // Colores
    dom.colorButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const hex = btn.getAttribute('data-ed-color');
        applyStyleChange((s) => {
          s.color = hex;
        });
      });
    });

    // Marca X / ✓
    dom.markButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const sym = btn.getAttribute('data-ed-mark');
        applyStyleChange((s) => {
          s.markSymbol = sym;
        });
      });
    });

    // Grosor de lápiz
    dom.strokeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const sw = Number(btn.getAttribute('data-ed-stroke'));
        applyStyleChange((s) => {
          s.strokeWidth = sw;
        });
      });
    });

    // Selección: duplicar y eliminar
    if (dom.btnDuplicate) dom.btnDuplicate.addEventListener('click', duplicateSelectedAnnotation);
    if (dom.btnDeleteAnnot) dom.btnDeleteAnnot.addEventListener('click', deleteSelectedAnnotation);

    // Deshacer / Rehacer
    if (dom.btnUndo) dom.btnUndo.addEventListener('click', undo);
    if (dom.btnRedo) dom.btnRedo.addEventListener('click', redo);

    // Zoom
    if (dom.btnZoomOut) {
      dom.btnZoomOut.addEventListener('click', () => {
        editor.zoom = Math.max(0.6, +(editor.zoom - 0.15).toFixed(2));
        updateContextualToolbar();
        renderAllPages();
      });
    }
    if (dom.btnZoomIn) {
      dom.btnZoomIn.addEventListener('click', () => {
        editor.zoom = Math.min(2.2, +(editor.zoom + 0.15).toFixed(2));
        updateContextualToolbar();
        renderAllPages();
      });
    }

    // Limpiar solo anotaciones (conserva el PDF base)
    if (dom.btnClearAnnotations) {
      dom.btnClearAnnotations.addEventListener('click', () => {
        if (editor.annotations.length === 0) return;
        if (!window.confirm('¿Deseas borrar todos los cuadros de texto, marcas y firmas agregados? El PDF base se mantendrá cargado.')) {
          return;
        }
        pushHistory();
        editor.annotations = [];
        editor.selectedId = null;
        editor.editingTextId = null;
        updateStatusBar();
        updateContextualToolbar();
        renderAllOverlays();
        scheduleEditorSave();
        toast('Anotaciones eliminadas (PDF base conservado)');
      });
    }

    // Cerrar PDF actual
    if (dom.btnClosePdf) {
      dom.btnClosePdf.addEventListener('click', async () => {
        if (!window.confirm('¿Deseas cerrar este PDF y volver a la pantalla de carga?')) return;
        editor.rawPdfBytes = null;
        editor.pdfDocProxy = null;
        editor.fileName = '';
        editor.pagesMeta = [];
        editor.annotations = [];
        editor.selectedId = null;
        editor.editingTextId = null;
        editor.undoStack = [];
        editor.redoStack = [];
        invalidateExportCache();
        await clearEditorDb();
        if (dom.pagesContainer) dom.pagesContainer.innerHTML = '';
        updateStatusBar();
        updateHistoryButtons();
      });
    }

    // Checkbox anexar evidencias fotográficas
    if (dom.chkAttachEvidences) {
      dom.chkAttachEvidences.addEventListener('change', (e) => {
        editor.attachEvidences = Boolean(e.target.checked);
        invalidateExportCache();
      });
    }

    // Vista previa y Exportar
    if (dom.btnPreviewEditorPdf) dom.btnPreviewEditorPdf.addEventListener('click', () => runExport('preview'));
    if (dom.btnExportPdf) dom.btnExportPdf.addEventListener('click', () => runExport('download'));

    // Atajos de teclado cuando la pestaña Editor de PDF está activa
    document.addEventListener('keydown', (e) => {
      if (!document.body.classList.contains('mode-editor')) return;
      if (!editor.rawPdfBytes) return;

      const active = document.activeElement;
      const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (isTyping) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && editor.selectedId) {
        e.preventDefault();
        duplicateSelectedAnnotation();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editor.selectedId) {
          e.preventDefault();
          deleteSelectedAnnotation();
        }
        return;
      }

      // Ajuste fino con flechas
      if (editor.selectedId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const sel = getSelectedAnnotation();
        if (!sel) return;
        const step = e.shiftKey ? 8 : 1;
        const meta = editor.pagesMeta[sel.pageIndex];
        if (e.key === 'ArrowLeft') sel.x = Math.max(0, sel.x - step);
        if (e.key === 'ArrowRight') sel.x = Math.min(meta.widthPt - 10, sel.x + step);
        if (e.key === 'ArrowUp') sel.y = Math.max(0, sel.y - step);
        if (e.key === 'ArrowDown') sel.y = Math.min(meta.heightPt - 10, sel.y + step);
        renderPageOverlay(sel.pageIndex);
        scheduleEditorSave();
        return;
      }

      const key = e.key.toLowerCase();
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (key === 'v') setTool('select');
        else if (key === 't') setTool('text');
        else if (key === 'x') setTool('mark');
        else if (key === 'd') setTool('draw');
        else if (key === 'r') setTool('rect');
      }
    });
  }

  async function initEditor() {
    if (editor.initialized) {
      syncEvidenceAttachControl();
      return;
    }
    editor.initialized = true;

    dom = {
      emptyState: document.getElementById('pdfEditorEmpty'),
      workspaceWrap: document.getElementById('pdfEditorWorkspace'),
      editorFooter: document.getElementById('editorActionBar'),
      pdfDropzone: document.getElementById('pdfDropzone'),
      pdfFileInput: document.getElementById('pdfFileInput'),
      imageInsertInput: document.getElementById('editorImageInput'),
      btnPickPdf: document.getElementById('btnPickPdf'),
      btnChangePdf: document.getElementById('btnChangePdf'),
      btnLoadTemplate: document.getElementById('btnLoadTemplate'),
      btnClosePdf: document.getElementById('btnClosePdf'),
      btnClearAnnotations: document.getElementById('btnClearAnnotations'),
      pagesContainer: document.getElementById('pdfPagesContainer'),
      editorFileMeta: document.getElementById('editorFileMeta'),
      toolButtons: Array.from(document.querySelectorAll('[data-ed-tool]')),
      colorButtons: Array.from(document.querySelectorAll('[data-ed-color]')),
      markButtons: Array.from(document.querySelectorAll('[data-ed-mark]')),
      strokeButtons: Array.from(document.querySelectorAll('[data-ed-stroke]')),
      grpFont: document.getElementById('edGrpFont'),
      grpBg: document.getElementById('edGrpBg'),
      grpMark: document.getElementById('edGrpMark'),
      grpStroke: document.getElementById('edGrpStroke'),
      grpColors: document.getElementById('edGrpColors'),
      grpSelection: document.getElementById('edGrpSelection'),
      btnFontMinus: document.getElementById('btnEdFontMinus'),
      btnFontPlus: document.getElementById('btnEdFontPlus'),
      fontSizeDisplay: document.getElementById('edFontSizeVal'),
      btnBold: document.getElementById('btnEdBold'),
      btnBgWhite: document.getElementById('btnEdBgWhite'),
      btnDuplicate: document.getElementById('btnEdDuplicate'),
      btnDeleteAnnot: document.getElementById('btnEdDelete'),
      btnUndo: document.getElementById('btnEdUndo'),
      btnRedo: document.getElementById('btnEdRedo'),
      btnZoomOut: document.getElementById('btnEdZoomOut'),
      btnZoomIn: document.getElementById('btnEdZoomIn'),
      zoomDisplay: document.getElementById('edZoomVal'),
      chkAttachEvidences: document.getElementById('chkAttachEvidences'),
      attachEvidencesLabel: document.getElementById('attachEvidencesLabel'),
      btnPreviewEditorPdf: document.getElementById('btnPreviewEditorPdf'),
      btnExportPdf: document.getElementById('btnExportEditorPdf')
    };

    bindEvents();
    updateStatusBar();
    updateContextualToolbar();

    // Restaurar PDF y anotaciones previas si existían en IndexedDB
    const saved = await loadEditorDraft();
    if (saved && saved.pdfBytes && saved.pdfBytes.length > 0) {
      await loadPdfFromBytes(saved.pdfBytes, saved.fileName, saved.annotations || []);
    }
  }

  global.PdfEditorApi = {
    init: initEditor,
    syncEvidenceCount: syncEvidenceAttachControl,
    loadPdfFromBytes,
    buildIntegratedTemplateBytes,
    exportEditedPdfBlob,
    getEditorState: () => editor
  };
})(window);
