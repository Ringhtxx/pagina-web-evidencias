(function () {
  'use strict';

  const THEME_STORAGE_KEY = 'evidencias_theme';
  const DB_NAME = 'evidencias_mantenimiento_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'draft';
  const DRAFT_KEY = 'current';

  const ANTIVIRUS_TEMPLATE = [
    { id: 'av_corp', label: 'Corporativo', hasDetail: false },
    { id: 'av_otro', label: 'Otro', hasDetail: true },
    { id: 'av_limpieza', label: 'Limpieza de Virus', hasDetail: false }
  ];

  const EVIDENCE_TEMPLATE = [
    { id: 'ev_pre_1', title: 'Foto del antes de intervenir el equipo', inChecklist: false },
    { id: 'ev_pre_2', title: 'Prueba Rápida de componentes (UEFI) con herramienta del fabricante', inChecklist: true },
    { id: 'ev_1', title: 'Limpieza interna y externa', inChecklist: true },
    { id: 'ev_2', title: 'Aplicación de Parches S.O y Revisión S.O', inChecklist: true },
    { id: 'ev_3', title: 'Desfragmentación del Disco Duro', inChecklist: true },
    { id: 'ev_4', title: 'Prueba Rápida de Componentes (UEFI)', inChecklist: true },
    { id: 'ev_5', title: 'Actualización y revisión Drivers', inChecklist: true },
    { id: 'ev_6', title: 'Eliminación de archivos temporales', inChecklist: true },
    { id: 'ev_7', title: 'Limpieza ventiladores', inChecklist: true },
    { id: 'ev_8', title: 'Diagnósticos/o asesoría en problemas de PC y accesorios', inChecklist: true },
    {
      id: 'ev_9',
      title:
        'Revisión de aplicaciones y programas que se ejecuten durante el arranque del sistema operativo para optimizar el tiempo de inicialización del mismo',
      inChecklist: true
    },
    {
      id: 'ev_post_1',
      title: 'Prueba Rápida de componentes (UEFI) con herramienta del fabricante (Después del mantenimiento)',
      inChecklist: false
    }
  ];

  // Mapeo uniforme de campos de texto/fecha del Formato de Inventario (Página 2)
  const META_INPUT_MAP = [
    { elId: 'inputEmpresa', key: 'empresa', event: 'input' },
    { elId: 'inputTicket', key: 'ticket', event: 'input' },
    { elId: 'inputUsuario', key: 'usuario', event: 'input' },
    { elId: 'inputFecha', key: 'fecha', event: 'change' },
    { elId: 'inputSn', key: 'sn', event: 'input' },
    { elId: 'inputMarca', key: 'marca', event: 'input' },
    { elId: 'inputModelo', key: 'modelo', event: 'input' },
    { elId: 'inputProcesador', key: 'procesador', event: 'input' },
    { elId: 'inputRam', key: 'ram', event: 'input' },
    { elId: 'inputDisco', key: 'disco', event: 'input' },
    { elId: 'inputUnidadOptica', key: 'unidadOptica', event: 'input' },
    { elId: 'inputSo', key: 'so', event: 'input' },
    { elId: 'inputMonitor', key: 'monitor', event: 'input' },
    { elId: 'inputMonitorSerial', key: 'monitorSerial', event: 'input' },
    { elId: 'inputTeclado', key: 'teclado', event: 'input' },
    { elId: 'inputTecladoSerial', key: 'tecladoSerial', event: 'input' },
    { elId: 'inputObservaciones', key: 'observaciones', event: 'input' },
    { elId: 'inputFirmaClienteNombre', key: 'firmaClienteNombre', event: 'input' },
    { elId: 'inputFirmaTecnicoNombre', key: 'firmaTecnicoNombre', event: 'input' }
  ];

  function todayIso() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function createInitialState() {
    return {
      includeInventario: true,
      meta: {
        empresa: '',
        ticket: '',
        usuario: '',
        fecha: todayIso(),
        tipoEquipo: 'PC', // 'Portátil' | 'PC'
        sn: '',
        marca: '',
        modelo: '',
        procesador: '',
        ram: '',
        disco: '',
        unidadOptica: '',
        so: '',
        monitor: '',
        monitorSerial: '',
        teclado: '',
        tecladoSerial: '',
        estadoEquipo: 'Operable', // 'Operable' | 'No Operable'
        observaciones: '',
        firmaClienteNombre: '',
        firmaTecnicoNombre: '',
        firmaClienteStrokes: [],
        firmaTecnicoStrokes: []
      },
      antivirus: ANTIVIRUS_TEMPLATE.map((a) => ({
        ...a,
        status: null,
        detail: ''
      })),
      items: EVIDENCE_TEMPLATE.map((e) => ({
        ...e,
        requiresPhoto: true,
        checkStatus: null,
        photos: [] // { id, blob, previewUrl, name, caption }
      }))
    };
  }

  let state = createInitialState();
  let activeCardId = null;
  let hoveredCardId = null;
  let lastPdfBlobUrl = null;
  let lastPdfFilename = null;
  let saveTimer = null;

  const els = {
    themeToggle: document.getElementById('themeToggle'),
    themeLabel: document.getElementById('themeLabel'),
    inventoryToggle: document.getElementById('inventoryToggle'),
    headerSubtitle: document.getElementById('headerSubtitle'),
    subsectionTitle: document.getElementById('subsectionTitle'),
    progressPill: document.getElementById('progressPill'),
    progressText: document.getElementById('progressText'),
    progressBarFill: document.getElementById('progressBarFill'),
    antivirusList: document.getElementById('antivirusList'),
    evidenceList: document.getElementById('evidenceList'),
    btnNextPending: document.getElementById('btnNextPending'),
    footerStatusTitle: document.getElementById('footerStatusTitle'),
    footerStatusHint: document.getElementById('footerStatusHint'),
    btnReset: document.getElementById('btnReset'),
    btnPreviewPdf: document.getElementById('btnPreviewPdf'),
    btnGeneratePdf: document.getElementById('btnGeneratePdf'),
    pdfModal: document.getElementById('pdfModal'),
    pdfPreviewFrame: document.getElementById('pdfPreviewFrame'),
    modalSubtitle: document.getElementById('modalSubtitle'),
    btnModalDownload: document.getElementById('btnModalDownload'),
    imageModal: document.getElementById('imageModal'),
    lightboxImage: document.getElementById('lightboxImage'),
    lightboxCaption: document.getElementById('lightboxCaption'),
    toastContainer: document.getElementById('toastContainer'),
    sigCanvasCliente: document.getElementById('sigCanvasCliente'),
    sigHintCliente: document.getElementById('sigHintCliente'),
    sigCanvasTecnico: document.getElementById('sigCanvasTecnico'),
    sigHintTecnico: document.getElementById('sigHintTecnico')
  };

  /* -------------------- Tema Claro / Oscuro -------------------- */

  function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const isDark = theme === 'dark';
    els.themeLabel.textContent = isDark ? 'Claro' : 'Oscuro';
    els.themeToggle.setAttribute('aria-pressed', String(isDark));
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (e) {}
    redrawAllSignatures();
  }

  els.themeToggle.addEventListener('click', () => {
    applyTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
  });

  function applyInventoryVisibility() {
    const enabled = state.includeInventario !== false;
    document.body.classList.toggle('inventory-off', !enabled);
    if (els.inventoryToggle) {
      els.inventoryToggle.classList.toggle('is-active', enabled);
      els.inventoryToggle.setAttribute('aria-checked', String(enabled));
    }
    if (els.headerSubtitle) {
      els.headerSubtitle.textContent = enabled
        ? 'Mantenimiento Preventivo · Versión 3 · Generador de PDF'
        : 'Solo Evidencias Fotográficas · Generador de PDF';
    }
    if (els.subsectionTitle) {
      els.subsectionTitle.textContent = enabled
        ? 'Ítems con Evidencia Fotográfica (FOTOS: SI / NO)'
        : 'Evidencias Fotográficas Requeridas';
    }
  }

  if (els.inventoryToggle) {
    els.inventoryToggle.addEventListener('click', () => {
      state.includeInventario = state.includeInventario === false;
      invalidateLastPdf();
      applyInventoryVisibility();
      scheduleSave();
      showToast(
        state.includeInventario
          ? 'Formato de Inventario activado'
          : 'Formato de Inventario desactivado (solo evidencias)'
      );
    });
  }

  /* -------------------- Persistencia IndexedDB -------------------- */

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB no disponible'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveDraftToDb() {
    try {
      const db = await openDb();
      const serializable = {
        includeInventario: state.includeInventario !== false,
        meta: state.meta,
        antivirus: state.antivirus.map((a) => ({
          id: a.id,
          status: a.status,
          detail: a.detail
        })),
        items: state.items.map((it) => ({
          id: it.id,
          requiresPhoto: it.requiresPhoto,
          checkStatus: it.checkStatus,
          photos: it.photos.map((p) => ({
            id: p.id,
            blob: p.blob,
            name: p.name,
            caption: p.caption
          }))
        }))
      };

      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(serializable, DRAFT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (e) {}
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraftToDb, 220);
  }

  async function loadDraftFromDb() {
    try {
      const db = await openDb();
      const saved = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(DRAFT_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      db.close();

      if (!saved) return false;

      state.includeInventario = saved.includeInventario !== false;

      if (saved.meta) {
        state.meta = {
          ...state.meta,
          ...saved.meta,
          fecha: saved.meta.fecha || todayIso(),
          firmaClienteStrokes: Array.isArray(saved.meta.firmaClienteStrokes)
            ? saved.meta.firmaClienteStrokes
            : [],
          firmaTecnicoStrokes: Array.isArray(saved.meta.firmaTecnicoStrokes)
            ? saved.meta.firmaTecnicoStrokes
            : []
        };
      }

      if (Array.isArray(saved.antivirus)) {
        saved.antivirus.forEach((sa) => {
          const target = state.antivirus.find((a) => a.id === sa.id);
          if (target) {
            target.status = sa.status || null;
            target.detail = sa.detail || '';
          }
        });
      }

      if (Array.isArray(saved.items)) {
        saved.items.forEach((si) => {
          const target = state.items.find((it) => it.id === si.id);
          if (target) {
            target.requiresPhoto = si.requiresPhoto !== false;
            target.checkStatus = si.checkStatus || null;
            if (Array.isArray(si.photos)) {
              target.photos = si.photos
                .filter((p) => p && p.blob)
                .map((p) => ({
                  id: p.id,
                  blob: p.blob,
                  previewUrl: URL.createObjectURL(p.blob),
                  name: p.name || 'evidencia.jpg',
                  caption: p.caption || ''
                }));
            }
          }
        });
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async function clearDraftFromDb() {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(DRAFT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (e) {}
  }

  /* -------------------- Firmas Digitales (Vectoriales) -------------------- */

  function drawSignatureOnCanvas(canvas, hintEl, strokes) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hasStrokes = Array.isArray(strokes) && strokes.length > 0;
    if (hintEl) hintEl.hidden = hasStrokes;
    if (!hasStrokes) return;

    ctx.strokeStyle = getCurrentTheme() === 'dark' ? '#e8eaed' : '#202124';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const stroke of strokes) {
      if (!stroke || stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x * canvas.width, stroke[0].y * canvas.height);
      if (stroke.length === 1) {
        ctx.lineTo(stroke[0].x * canvas.width + 0.5, stroke[0].y * canvas.height + 0.5);
      } else {
        for (let i = 1; i < stroke.length; i++) {
          ctx.lineTo(stroke[i].x * canvas.width, stroke[i].y * canvas.height);
        }
      }
      ctx.stroke();
    }
  }

  function redrawAllSignatures() {
    drawSignatureOnCanvas(els.sigCanvasCliente, els.sigHintCliente, state.meta.firmaClienteStrokes);
    drawSignatureOnCanvas(els.sigCanvasTecnico, els.sigHintTecnico, state.meta.firmaTecnicoStrokes);
  }

  function bindSignaturePad(canvas, hintEl, strokeKey) {
    if (!canvas) return;
    let isDrawing = false;
    let activeStroke = null;

    function getNormalizedPoint(e) {
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      return { x, y };
    }

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      isDrawing = true;
      activeStroke = [getNormalizedPoint(e)];
      state.meta[strokeKey].push(activeStroke);
      drawSignatureOnCanvas(canvas, hintEl, state.meta[strokeKey]);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!isDrawing || !activeStroke) return;
      activeStroke.push(getNormalizedPoint(e));
      drawSignatureOnCanvas(canvas, hintEl, state.meta[strokeKey]);
    });

    function finishStroke() {
      if (!isDrawing) return;
      isDrawing = false;
      activeStroke = null;
      invalidateLastPdf();
      scheduleSave();
    }

    canvas.addEventListener('pointerup', finishStroke);
    canvas.addEventListener('pointercancel', finishStroke);
  }

  document.querySelectorAll('[data-clear-sig]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const which = btn.getAttribute('data-clear-sig');
      if (which === 'cliente') {
        state.meta.firmaClienteStrokes = [];
      } else {
        state.meta.firmaTecnicoStrokes = [];
      }
      invalidateLastPdf();
      redrawAllSignatures();
      scheduleSave();
    });
  });

  /* -------------------- Utilidades UI -------------------- */

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    els.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 2800);
  }

  function isItemComplete(item) {
    return item.photos.length > 0 || !item.requiresPhoto;
  }

  function getStats() {
    const total = state.items.length;
    let completed = 0;
    let withPhotos = 0;
    let totalPhotos = 0;
    let firstPendingId = null;

    for (const item of state.items) {
      if (item.photos.length > 0) {
        withPhotos++;
        totalPhotos += item.photos.length;
      }
      if (isItemComplete(item)) {
        completed++;
      } else if (!firstPendingId) {
        firstPendingId = item.id;
      }
    }

    return {
      total,
      completed,
      remaining: total - completed,
      withPhotos,
      totalPhotos,
      firstPendingId,
      allReady: completed === total
    };
  }

  function syncMetaInputs() {
    META_INPUT_MAP.forEach(({ elId, key }) => {
      const el = document.getElementById(elId);
      if (el) el.value = state.meta[key] || '';
    });

    document.querySelectorAll('[data-equipo-tipo]').forEach((btn) => {
      const val = btn.getAttribute('data-equipo-tipo');
      const isSelected = val === state.meta.tipoEquipo;
      btn.setAttribute('aria-pressed', String(isSelected));
      btn.classList.toggle('active-blue', isSelected);
    });

    document.querySelectorAll('[data-equipment-state]').forEach((btn) => {
      const val = btn.getAttribute('data-equipment-state');
      const isSelected = val === state.meta.estadoEquipo;
      btn.setAttribute('aria-pressed', String(isSelected));
      btn.classList.remove('active-green', 'active-red');
      if (isSelected) {
        btn.classList.add(val === 'Operable' ? 'active-green' : 'active-red');
      }
    });

    redrawAllSignatures();
  }

  function createSiNoToggle(currentStatus, onChange) {
    const toggle = document.createElement('div');
    toggle.className = 'mini-toggle';
    ['SI', 'NO'].forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opt;
      if (currentStatus === opt) {
        btn.className = opt === 'SI' ? 'is-si' : 'is-no';
      }
      btn.addEventListener('click', () => onChange(currentStatus === opt ? null : opt));
      toggle.appendChild(btn);
    });
    return toggle;
  }

  function renderAntivirus() {
    els.antivirusList.innerHTML = '';
    state.antivirus.forEach((av) => {
      const box = document.createElement('div');
      box.className = 'av-item';

      const top = document.createElement('div');
      top.className = 'av-item-top';

      const label = document.createElement('span');
      label.className = 'av-label';
      label.textContent = av.label;

      const toggle = createSiNoToggle(av.status, (nextVal) => {
        av.status = nextVal;
        invalidateLastPdf();
        renderAntivirus();
        scheduleSave();
      });

      top.appendChild(label);
      top.appendChild(toggle);
      box.appendChild(top);

      if (av.hasDetail) {
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Especificar cuál...';
        input.value = av.detail;
        input.addEventListener('input', (e) => {
          av.detail = e.target.value;
          invalidateLastPdf();
          scheduleSave();
        });
        box.appendChild(input);
      }

      els.antivirusList.appendChild(box);
    });
  }

  function updateSummaryUI() {
    const stats = getStats();
    const pct = Math.round((stats.completed / stats.total) * 100);

    els.progressText.textContent = `${stats.completed} / ${stats.total} evidencias`;
    els.progressPill.classList.toggle('complete', stats.allReady);
    els.progressBarFill.style.width = `${pct}%`;
    els.progressBarFill.classList.toggle('complete', stats.allReady);

    els.btnNextPending.hidden = stats.allReady;
    els.btnGeneratePdf.disabled = !stats.allReady;
    els.btnPreviewPdf.disabled = !stats.allReady;

    if (stats.allReady) {
      els.footerStatusTitle.textContent = 'Todas las evidencias están listas';
      els.footerStatusHint.textContent =
        stats.totalPhotos > 0
          ? `${stats.totalPhotos} ${stats.totalPhotos === 1 ? 'foto adjunta' : 'fotos adjuntas'} · Formato listo para generar PDF.`
          : 'Ítems completos · Formato listo para generar PDF.';
    } else {
      els.footerStatusTitle.textContent =
        stats.remaining === 1
          ? 'Falta 1 evidencia por subir'
          : `Faltan ${stats.remaining} evidencias por subir`;
      els.footerStatusHint.textContent =
        'Sube al menos 1 foto por cada ítem requerido para habilitar el PDF.';
    }
  }

  function createSvgIcon(type) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    if (type === 'upload') {
      svg.innerHTML =
        '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>' +
        '<circle cx="8.5" cy="8.5" r="1.5"></circle>' +
        '<polyline points="21 15 16 10 5 21"></polyline>';
    } else if (type === 'plus') {
      svg.innerHTML = '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>';
    } else if (type === 'check') {
      svg.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
    }
    return svg;
  }

  function invalidateLastPdf() {
    if (lastPdfBlobUrl) {
      URL.revokeObjectURL(lastPdfBlobUrl);
      lastPdfBlobUrl = null;
      lastPdfFilename = null;
    }
  }

  function handleFilesForItem(itemId, fileList) {
    const item = state.items.find((it) => it.id === itemId);
    if (!item || !fileList || fileList.length === 0) return;

    const validFiles = Array.from(fileList).filter(
      (f) => (f.type && f.type.startsWith('image/')) || /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/i.test(f.name || '')
    );
    if (validFiles.length === 0) {
      showToast('Solo se admiten archivos de imagen (JPG, PNG, WEBP, etc.)');
      return;
    }

    validFiles.forEach((file) => {
      const id = `${itemId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      item.photos.push({
        id,
        blob: file,
        previewUrl: URL.createObjectURL(file),
        name: file.name || 'evidencia.png',
        caption: ''
      });
    });

    item.requiresPhoto = true;
    if (item.inChecklist !== false && !item.checkStatus) {
      item.checkStatus = 'SI';
    }

    invalidateLastPdf();
    renderEvidenceItem(itemId);
    updateSummaryUI();
    scheduleSave();

    const msg =
      validFiles.length === 1
        ? '1 imagen agregada correctamente'
        : `${validFiles.length} imágenes agregadas correctamente`;
    showToast(msg);
  }

  function attachDropEvents(targetEl, itemId) {
    targetEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      targetEl.classList.add('is-dragover');
    });
    targetEl.addEventListener('dragleave', () => {
      targetEl.classList.remove('is-dragover');
    });
    targetEl.addEventListener('drop', (e) => {
      e.preventDefault();
      targetEl.classList.remove('is-dragover');
      if (e.dataTransfer && e.dataTransfer.files) {
        handleFilesForItem(itemId, e.dataTransfer.files);
      }
    });
  }

  function buildCardContent(card, item, index) {
    card.innerHTML = '';
    const hasPhotos = item.photos.length > 0;
    const isSkipped = !item.requiresPhoto && !hasPhotos;
    const isComplete = hasPhotos;

    card.classList.toggle('is-complete', isComplete);
    card.classList.toggle('is-skipped', isSkipped);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.hidden = true;
    fileInput.addEventListener('change', (e) => {
      handleFilesForItem(item.id, e.target.files);
      fileInput.value = '';
    });
    card.appendChild(fileInput);

    // Encabezado del ítem con toggle Checklist SI/NO + estado de FOTOS
    const top = document.createElement('div');
    top.className = 'evidence-top';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'evidence-title-group';

    const badgeIndex = document.createElement('span');
    badgeIndex.className = 'item-index';
    if (isComplete) {
      const checkSvg = createSvgIcon('check');
      checkSvg.style.width = '15px';
      checkSvg.style.height = '15px';
      badgeIndex.appendChild(checkSvg);
    } else {
      badgeIndex.textContent = String(index + 1);
    }

    const titleEl = document.createElement('h4');
    titleEl.className = 'item-title';
    titleEl.textContent = item.title;

    titleGroup.appendChild(badgeIndex);
    titleGroup.appendChild(titleEl);

    const controls = document.createElement('div');
    controls.className = 'evidence-controls';

    if (item.inChecklist !== false) {
      const checkWrap = document.createElement('div');
      checkWrap.className = 'check-inline';
      const checkLbl = document.createElement('span');
      checkLbl.textContent = 'Checklist:';
      checkWrap.appendChild(checkLbl);
      checkWrap.appendChild(
        createSiNoToggle(item.checkStatus, (nextVal) => {
          item.checkStatus = nextVal;
          invalidateLastPdf();
          renderEvidenceItem(item.id);
          scheduleSave();
        })
      );
      controls.appendChild(checkWrap);
    } else {
      const onlyEvBadge = document.createElement('span');
      onlyEvBadge.className = 'summary-badge';
      onlyEvBadge.textContent = 'Solo evidencia';
      controls.appendChild(onlyEvBadge);
    }

    const statusBadge = document.createElement('span');
    statusBadge.className = 'status-badge ' + (isComplete ? 'ready' : isSkipped ? 'skipped' : 'pending');
    if (isComplete) {
      statusBadge.textContent = `${item.photos.length} ${item.photos.length === 1 ? 'foto' : 'fotos'}`;
    } else if (isSkipped) {
      statusBadge.textContent = 'Sin foto (NO)';
    } else {
      statusBadge.textContent = 'Pendiente';
    }
    controls.appendChild(statusBadge);

    if (!hasPhotos) {
      const skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.className = 'skip-toggle' + (isSkipped ? ' active' : '');
      skipBtn.textContent = isSkipped ? 'Requiere foto' : 'Sin foto (NO)';
      skipBtn.title = 'Marcar si este punto corresponde a FOTOS: NO';
      skipBtn.addEventListener('click', () => {
        item.requiresPhoto = !item.requiresPhoto;
        invalidateLastPdf();
        renderEvidenceItem(item.id);
        updateSummaryUI();
        scheduleSave();
      });
      controls.appendChild(skipBtn);
    }

    top.appendChild(titleGroup);
    top.appendChild(controls);
    card.appendChild(top);

    if (isSkipped) {
      const note = document.createElement('div');
      note.className = 'skipped-note';
      note.innerHTML = '<span>Marcado como <strong>FOTOS: NO</strong> en el checklist.</span>';

      const attachAnyway = document.createElement('button');
      attachAnyway.type = 'button';
      attachAnyway.className = 'text-button';
      attachAnyway.textContent = 'Subir foto de todas formas';
      attachAnyway.addEventListener('click', () => fileInput.click());
      note.appendChild(attachAnyway);
      card.appendChild(note);
      return;
    }

    if (!hasPhotos) {
      const dropzone = document.createElement('div');
      dropzone.className = 'dropzone';
      dropzone.setAttribute('role', 'button');
      dropzone.setAttribute('tabindex', '0');
      dropzone.setAttribute('aria-label', `Subir fotos para ${item.title}`);

      const dzContent = document.createElement('div');
      dzContent.className = 'dropzone-content';

      const dzIcon = document.createElement('div');
      dzIcon.className = 'dropzone-icon';
      dzIcon.appendChild(createSvgIcon('upload'));

      const dzText = document.createElement('div');
      dzText.className = 'dropzone-text';
      dzText.innerHTML =
        '<strong>Sube o arrastra las fotografías aquí</strong>' +
        '<span>También puedes pegar capturas con Ctrl+V</span>';

      dzContent.appendChild(dzIcon);
      dzContent.appendChild(dzText);

      const dzCta = document.createElement('span');
      dzCta.className = 'dropzone-cta';
      dzCta.textContent = 'Seleccionar';

      dropzone.appendChild(dzContent);
      dropzone.appendChild(dzCta);

      dropzone.addEventListener('click', () => fileInput.click());
      dropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInput.click();
        }
      });
      attachDropEvents(dropzone, item.id);

      card.appendChild(dropzone);
    } else {
      const grid = document.createElement('div');
      grid.className = 'photo-grid';

      item.photos.forEach((photo) => {
        const thumbCard = document.createElement('div');
        thumbCard.className = 'photo-thumb-card';

        const previewBtn = document.createElement('button');
        previewBtn.type = 'button';
        previewBtn.className = 'photo-preview-btn';
        previewBtn.title = 'Ampliar fotografía';
        const img = document.createElement('img');
        img.src = photo.previewUrl;
        img.alt = photo.caption || item.title;
        previewBtn.appendChild(img);
        previewBtn.addEventListener('click', () => openLightbox(photo.previewUrl, photo.caption || item.title));

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'photo-remove-btn';
        removeBtn.setAttribute('aria-label', 'Eliminar fotografía');
        removeBtn.title = 'Eliminar fotografía';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
          URL.revokeObjectURL(photo.previewUrl);
          item.photos = item.photos.filter((p) => p.id !== photo.id);
          invalidateLastPdf();
          renderEvidenceItem(item.id);
          updateSummaryUI();
          scheduleSave();
        });

        const captionInput = document.createElement('input');
        captionInput.type = 'text';
        captionInput.className = 'photo-caption-input';
        captionInput.placeholder = 'Nota opcional (ej. Antes / Después)';
        captionInput.value = photo.caption;
        captionInput.addEventListener('input', (e) => {
          photo.caption = e.target.value;
          invalidateLastPdf();
          scheduleSave();
        });

        thumbCard.appendChild(previewBtn);
        thumbCard.appendChild(removeBtn);
        thumbCard.appendChild(captionInput);
        grid.appendChild(thumbCard);
      });

      const addMore = document.createElement('button');
      addMore.type = 'button';
      addMore.className = 'add-more-tile';
      addMore.appendChild(createSvgIcon('plus'));
      const addLabel = document.createElement('span');
      addLabel.textContent = 'Agregar foto';
      addMore.appendChild(addLabel);
      addMore.addEventListener('click', () => fileInput.click());
      attachDropEvents(addMore, item.id);

      grid.appendChild(addMore);
      card.appendChild(grid);
    }
  }

  function renderEvidenceItem(itemId) {
    const index = state.items.findIndex((it) => it.id === itemId);
    if (index === -1) return;
    const item = state.items[index];
    const existing = document.getElementById(`card_${itemId}`);
    if (existing) {
      buildCardContent(existing, item, index);
    }
  }

  function renderAllEvidenceItems() {
    els.evidenceList.innerHTML = '';
    state.items.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'evidence-card';
      card.id = `card_${item.id}`;
      card.tabIndex = -1;

      card.addEventListener('focusin', () => {
        activeCardId = item.id;
      });
      card.addEventListener('mouseenter', () => {
        hoveredCardId = item.id;
      });
      card.addEventListener('mouseleave', () => {
        if (hoveredCardId === item.id) hoveredCardId = null;
      });

      buildCardContent(card, item, index);
      els.evidenceList.appendChild(card);
    });
  }

  /* -------------------- Modales (PDF y Lightbox) -------------------- */

  function openLightbox(src, caption) {
    els.lightboxImage.src = src;
    els.lightboxCaption.textContent = caption || '';
    els.imageModal.hidden = false;
  }

  function closeLightbox() {
    els.imageModal.hidden = true;
    els.lightboxImage.src = '';
  }

  function openPdfModal(blobUrl, filename) {
    els.pdfPreviewFrame.src = blobUrl;
    els.modalSubtitle.textContent = filename;
    els.pdfModal.hidden = false;
  }

  function closePdfModal() {
    els.pdfModal.hidden = true;
  }

  document.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', closePdfModal);
  });

  document.querySelectorAll('[data-close-image]').forEach((el) => {
    el.addEventListener('click', closeLightbox);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!els.imageModal.hidden) closeLightbox();
      else if (!els.pdfModal.hidden) closePdfModal();
    }
  });

  /* -------------------- Generación y Descarga de PDF -------------------- */

  function sanitizeFilenamePart(val) {
    return (val || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function buildPdfFilename() {
    const ticket = sanitizeFilenamePart(state.meta.ticket);
    const snOrUser = sanitizeFilenamePart(state.meta.sn || state.meta.usuario);
    const fecha = state.meta.fecha || todayIso();
    const tag = [ticket, snOrUser].filter(Boolean).join('_') || 'Equipo';
    const prefix = state.includeInventario === false ? 'Evidencias_Mantenimiento' : 'Formato_Inventario';
    return `${prefix}_${tag}_${fecha}.pdf`;
  }

  function triggerDownload(blobUrl, filename) {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function buildPdfIfNeeded() {
    if (lastPdfBlobUrl) {
      return { blobUrl: lastPdfBlobUrl, filename: lastPdfFilename };
    }
    const blob = await window.PdfEvidenceGenerator.generateEvidencePdf(state);
    lastPdfBlobUrl = URL.createObjectURL(blob);
    lastPdfFilename = buildPdfFilename();
    return { blobUrl: lastPdfBlobUrl, filename: lastPdfFilename };
  }

  async function runPdfAction(mode) {
    const stats = getStats();
    if (!stats.allReady) {
      showToast(`Faltan ${stats.remaining} evidencias por completar`);
      return;
    }

    const origGenText = els.btnGeneratePdf.innerHTML;
    const origPrevText = els.btnPreviewPdf.textContent;
    els.btnGeneratePdf.disabled = true;
    els.btnPreviewPdf.disabled = true;
    if (mode === 'download') {
      els.btnGeneratePdf.textContent = 'Generando PDF...';
    } else {
      els.btnPreviewPdf.textContent = 'Preparando...';
    }

    try {
      const { blobUrl, filename } = await buildPdfIfNeeded();
      if (mode === 'download') {
        triggerDownload(blobUrl, filename);
        showToast(`PDF descargado: ${filename}`);
      } else {
        openPdfModal(blobUrl, filename);
      }
    } catch (err) {
      console.error(err);
      showToast('Ocurrió un error al generar el PDF. Revisa las imágenes adjuntas.');
    } finally {
      els.btnGeneratePdf.innerHTML = origGenText;
      els.btnPreviewPdf.textContent = origPrevText;
      updateSummaryUI();
    }
  }

  els.btnGeneratePdf.addEventListener('click', () => runPdfAction('download'));
  els.btnPreviewPdf.addEventListener('click', () => runPdfAction('preview'));
  els.btnModalDownload.addEventListener('click', () => {
    if (lastPdfBlobUrl && lastPdfFilename) {
      triggerDownload(lastPdfBlobUrl, lastPdfFilename);
      showToast(`PDF descargado: ${lastPdfFilename}`);
    }
  });

  /* -------------------- Enlace de eventos de formulario -------------------- */

  META_INPUT_MAP.forEach(({ elId, key, event }) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.addEventListener(event, (e) => {
      state.meta[key] = e.target.value;
      invalidateLastPdf();
      scheduleSave();
    });
  });

  document.querySelectorAll('[data-equipo-tipo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.meta.tipoEquipo = btn.getAttribute('data-equipo-tipo');
      invalidateLastPdf();
      syncMetaInputs();
      scheduleSave();
    });
  });

  document.querySelectorAll('[data-equipment-state]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.meta.estadoEquipo = btn.getAttribute('data-equipment-state');
      invalidateLastPdf();
      syncMetaInputs();
      scheduleSave();
    });
  });

  els.btnNextPending.addEventListener('click', () => {
    const stats = getStats();
    if (!stats.firstPendingId) return;
    const card = document.getElementById(`card_${stats.firstPendingId}`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('is-highlight');
    setTimeout(() => card.classList.remove('is-highlight'), 1400);
  });

  document.addEventListener('paste', (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      const hasFiles = e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0;
      if (!hasFiles) return;
    }

    const files = [];
    if (e.clipboardData && e.clipboardData.items) {
      for (const item of e.clipboardData.items) {
        if (item.type && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
    }
    if (files.length === 0) return;

    e.preventDefault();
    const stats = getStats();
    const targetId = hoveredCardId || activeCardId || stats.firstPendingId || state.items[0].id;
    const targetIdx = state.items.findIndex((it) => it.id === targetId);
    handleFilesForItem(targetId, files);
    if (targetIdx !== -1) {
      showToast(`Captura pegada en el punto ${targetIdx + 1}`);
    }
  });

  els.btnReset.addEventListener('click', async () => {
    const hasContent =
      state.items.some((it) => it.photos.length > 0 || !it.requiresPhoto || it.checkStatus) ||
      Object.entries(state.meta).some(([k, v]) => {
        if (k === 'fecha' || k === 'tipoEquipo' || k === 'estadoEquipo') return false;
        return Array.isArray(v) ? v.length > 0 : Boolean(v);
      });

    if (hasContent && !window.confirm('¿Deseas limpiar todo el formato, firmas y fotografías cargadas?')) {
      return;
    }

    state.items.forEach((it) => {
      it.photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    });
    invalidateLastPdf();

    const keepInventoryMode = state.includeInventario !== false;
    state = createInitialState();
    state.includeInventario = keepInventoryMode;
    await clearDraftFromDb();
    applyInventoryVisibility();
    syncMetaInputs();
    renderAntivirus();
    renderAllEvidenceItems();
    updateSummaryUI();
    showToast('Formato reiniciado');
  });

  /* -------------------- Inicialización -------------------- */

  async function init() {
    bindSignaturePad(els.sigCanvasCliente, els.sigHintCliente, 'firmaClienteStrokes');
    bindSignaturePad(els.sigCanvasTecnico, els.sigHintTecnico, 'firmaTecnicoStrokes');

    applyTheme(getCurrentTheme());
    applyInventoryVisibility();
    syncMetaInputs();
    renderAntivirus();
    renderAllEvidenceItems();
    updateSummaryUI();

    const restored = await loadDraftFromDb();
    if (restored) {
      applyInventoryVisibility();
      syncMetaInputs();
      renderAntivirus();
      renderAllEvidenceItems();
      updateSummaryUI();
    }
  }

  init();
})();
