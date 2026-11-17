/**
 * Generador PDF 1.4 puro en navegador (sin dependencias externas, 100% offline).
 * Página 1: Replica el "FORMATO DE INVENTARIO" (Versión 3) con todos los campos editables,
 * descripción del equipo, checklist completo SI/NO, columna FOTOS SI/NO, estado, observaciones y firmas.
 * Páginas 2..N: Evidencias fotográficas adjuntas organizadas por punto del checklist.
 */
(function (global) {
  'use strict';

  const PAGE_W = 612; // US Letter 8.5 x 11 in
  const PAGE_H = 792;
  const MARGIN_X = 36;
  const CONTENT_W = PAGE_W - MARGIN_X * 2; // 540 pt
  const MARGIN_TOP = 32;
  const MARGIN_BOTTOM = 44;

  const HELV_WIDTHS = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
  ];

  const WINANSI_SPECIAL = {
    0x20AC: 0x80,
    0x201A: 0x82,
    0x0192: 0x83,
    0x201E: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02C6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8A,
    0x2039: 0x8B,
    0x0152: 0x8C,
    0x017D: 0x8E,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201C: 0x93,
    0x201D: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02DC: 0x98,
    0x2122: 0x99,
    0x0161: 0x9A,
    0x203A: 0x9B,
    0x0153: 0x9C,
    0x017E: 0x9E,
    0x0178: 0x9F
  };

  const DIACRITIC_BASE = {
    'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'Á': 'A', 'À': 'A', 'Ä': 'A', 'Â': 'A',
    'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e', 'É': 'E', 'È': 'E', 'Ë': 'E', 'Ê': 'E',
    'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i', 'Í': 'I', 'Ì': 'I', 'Ï': 'I', 'Î': 'I',
    'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o', 'Ó': 'O', 'Ò': 'O', 'Ö': 'O', 'Ô': 'O',
    'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u', 'Ú': 'U', 'Ù': 'U', 'Ü': 'U', 'Û': 'U',
    'ñ': 'n', 'Ñ': 'N', 'ç': 'c', 'Ç': 'C', '¿': '?', '¡': '!', '°': 'o', '•': '*'
  };

  function charWidthUnits(ch) {
    const mapped = DIACRITIC_BASE[ch] || ch;
    const code = mapped.charCodeAt(0);
    if (code >= 32 && code <= 126) {
      return HELV_WIDTHS[code - 32];
    }
    return 556;
  }

  function measureText(text, fontSize, isBold) {
    if (!text) return 0;
    const factor = isBold ? 1.045 : 1.0;
    let total = 0;
    for (let i = 0; i < text.length; i++) {
      total += charWidthUnits(text[i]);
    }
    return (total / 1000) * fontSize * factor;
  }

  function fitTextToWidth(text, fontSize, maxWidth, isBold) {
    const str = String(text || '');
    if (measureText(str, fontSize, isBold) <= maxWidth) return str;
    let out = '';
    for (let i = 0; i < str.length; i++) {
      if (measureText(out + str[i] + '...', fontSize, isBold) > maxWidth) {
        return out + '...';
      }
      out += str[i];
    }
    return out;
  }

  function wrapText(text, fontSize, maxWidth, isBold) {
    if (!text) return [''];
    const paragraphs = String(text).replace(/\r\n/g, '\n').split('\n');
    const lines = [];

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) {
        lines.push('');
        continue;
      }
      const words = trimmed.split(/\s+/);
      let current = '';

      for (const word of words) {
        const candidate = current ? current + ' ' + word : word;
        if (measureText(candidate, fontSize, isBold) <= maxWidth) {
          current = candidate;
        } else if (current) {
          lines.push(current);
          current = word;
        } else {
          let chunk = '';
          for (const ch of word) {
            if (measureText(chunk + ch, fontSize, isBold) > maxWidth && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          current = chunk;
        }
      }
      if (current) lines.push(current);
    }
    return lines.length ? lines : [''];
  }

  function encodePdfStringBytes(str) {
    const text = String(str || '').normalize('NFC');
    const out = [0x28];

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 0x28 || code === 0x29 || code === 0x5C) {
        out.push(0x5C, code);
      } else if (code >= 0x20 && code <= 0x7E) {
        out.push(code);
      } else if (code >= 0xA0 && code <= 0xFF) {
        out.push(code);
      } else if (WINANSI_SPECIAL[code] !== undefined) {
        out.push(WINANSI_SPECIAL[code]);
      } else if (code === 0x09) {
        out.push(0x20);
      } else if (code >= 0xD800 && code <= 0xDBFF) {
        i++;
      } else {
        out.push(0x3F);
      }
    }

    out.push(0x29);
    return new Uint8Array(out);
  }

  function asciiBytes(str) {
    const arr = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      arr[i] = str.charCodeAt(i) & 0xFF;
    }
    return arr;
  }

  class PageCanvas {
    constructor() {
      this.chunks = [];
    }

    cmd(asciiStr) {
      this.chunks.push(asciiBytes(asciiStr + '\n'));
    }

    rgb(r, g, b, isStroke) {
      this.cmd(
        `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} ${isStroke ? 'RG' : 'rg'}`
      );
    }

    rect(x, yTop, w, h, fillColor, strokeColor, lineWidth) {
      const y = PAGE_H - yTop - h;
      this.cmd('q');
      if (fillColor) this.rgb(fillColor[0], fillColor[1], fillColor[2], false);
      if (strokeColor) {
        this.rgb(strokeColor[0], strokeColor[1], strokeColor[2], true);
        this.cmd(`${(lineWidth || 0.75).toFixed(2)} w`);
      }
      this.cmd(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
      if (fillColor && strokeColor) this.cmd('B');
      else if (fillColor) this.cmd('f');
      else this.cmd('S');
      this.cmd('Q');
    }

    line(x1, yTop1, x2, yTop2, strokeColor, lineWidth) {
      const y1 = PAGE_H - yTop1;
      const y2 = PAGE_H - yTop2;
      this.cmd('q');
      this.rgb(strokeColor[0], strokeColor[1], strokeColor[2], true);
      this.cmd(`${(lineWidth || 0.75).toFixed(2)} w`);
      this.cmd(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
      this.cmd('Q');
    }

    checkmark(x, yTop, size, color) {
      const y = PAGE_H - yTop;
      this.cmd('q');
      this.rgb(color[0], color[1], color[2], true);
      this.cmd('1.35 w 1 J 1 j');
      const p1x = x + size * 0.18;
      const p1y = y - size * 0.54;
      const p2x = x + size * 0.42;
      const p2y = y - size * 0.78;
      const p3x = x + size * 0.84;
      const p3y = y - size * 0.24;
      this.cmd(`${p1x.toFixed(2)} ${p1y.toFixed(2)} m ${p2x.toFixed(2)} ${p2y.toFixed(2)} l ${p3x.toFixed(2)} ${p3y.toFixed(2)} l S`);
      this.cmd('Q');
    }

    signatureStrokes(strokes, x, yTop, w, h, color) {
      if (!Array.isArray(strokes) || strokes.length === 0) return;
      this.cmd('q');
      this.rgb(color[0], color[1], color[2], true);
      this.cmd('1.30 w 1 J 1 j');
      for (const stroke of strokes) {
        if (!stroke || stroke.length === 0) continue;
        const sx = x + stroke[0].x * w;
        const sy = PAGE_H - (yTop + stroke[0].y * h);
        this.cmd(`${sx.toFixed(2)} ${sy.toFixed(2)} m`);
        if (stroke.length === 1) {
          this.cmd(`${(sx + 0.5).toFixed(2)} ${(sy - 0.5).toFixed(2)} l`);
        } else {
          for (let i = 1; i < stroke.length; i++) {
            const px = x + stroke[i].x * w;
            const py = PAGE_H - (yTop + stroke[i].y * h);
            this.cmd(`${px.toFixed(2)} ${py.toFixed(2)} l`);
          }
        }
        this.cmd('S');
      }
      this.cmd('Q');
    }

    text(str, x, yTop, opts) {
      const size = (opts && opts.size) || 10;
      const bold = Boolean(opts && opts.bold);
      const color = (opts && opts.color) || [32, 33, 36];
      const align = (opts && opts.align) || 'left';

      let drawX = x;
      if (align === 'right') {
        drawX = x - measureText(str, size, bold);
      } else if (align === 'center') {
        drawX = x - measureText(str, size, bold) / 2;
      }

      const baselineY = PAGE_H - yTop - size * 0.82;
      this.cmd('q');
      this.rgb(color[0], color[1], color[2], false);
      this.cmd(`BT /${bold ? 'F2' : 'F1'} ${size.toFixed(2)} Tf ${drawX.toFixed(2)} ${baselineY.toFixed(2)} Td`);
      this.chunks.push(encodePdfStringBytes(str));
      this.cmd(' Tj ET Q');
    }

    image(imgName, x, yTop, w, h) {
      const y = PAGE_H - yTop - h;
      this.cmd(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${imgName} Do Q`);
    }

    toUint8Array() {
      let len = 0;
      for (const c of this.chunks) len += c.length;
      const merged = new Uint8Array(len);
      let offset = 0;
      for (const c of this.chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      return merged;
    }
  }

  // Paleta PDF
  const C_BLUE = [26, 115, 232];
  const C_BLUE_BAR = [66, 133, 244];
  const C_RED_BAR = [234, 67, 53];
  const C_YELLOW_BAR = [251, 188, 5];
  const C_GREEN_BAR = [52, 168, 83];
  const C_GREEN = [30, 142, 62];
  const C_GREEN_SOFT = [230, 244, 234];
  const C_RED = [217, 48, 37];
  const C_RED_SOFT = [252, 232, 230];
  const C_INK = [32, 33, 36];
  const C_MUTED = [95, 99, 104];
  const C_BORDER = [145, 150, 156];
  const C_BORDER_LIGHT = [218, 220, 224];
  const C_BG_LIGHT = [248, 249, 250];
  const C_BG_HEADER = [228, 231, 235];
  const C_BG_SUB = [241, 243, 244];
  const C_WHITE = [255, 255, 255];

  function drawGoogleTopBar(page) {
    const segW = CONTENT_W / 4;
    const colors = [C_BLUE_BAR, C_RED_BAR, C_YELLOW_BAR, C_GREEN_BAR];
    for (let i = 0; i < 4; i++) {
      page.rect(MARGIN_X + segW * i, 20, segW + 0.3, 2.8, colors[i], null);
    }
  }

  function formatDateDisplay(isoDate) {
    if (!isoDate) return '';
    const parts = String(isoDate).split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return isoDate;
  }

  async function rasterizeToJpeg(photo) {
    let bitmap = null;
    let imgEl = null;

    if (photo.blob && typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(photo.blob, { imageOrientation: 'from-image' });
      } catch (e) {
        bitmap = null;
      }
    }

    if (!bitmap) {
      const objectUrl = photo.blob ? URL.createObjectURL(photo.blob) : null;
      try {
        imgEl = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('No se pudo decodificar la imagen'));
          img.src = objectUrl || photo.previewUrl || photo.dataUrl;
        });
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    }

    const srcW = bitmap ? bitmap.width : imgEl.naturalWidth || imgEl.width;
    const srcH = bitmap ? bitmap.height : imgEl.naturalHeight || imgEl.height;

    const MAX_EDGE = 1400;
    const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, dstW, dstH);
    ctx.drawImage(bitmap || imgEl, 0, 0, dstW, dstH);

    if (bitmap && typeof bitmap.close === 'function') {
      bitmap.close();
    }

    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.86);
    const base64 = jpegDataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return { bytes, width: dstW, height: dstH };
  }

  function assemblePdf(pages, images) {
    const objects = [];

    function addObject(contentChunks) {
      objects.push(contentChunks);
      return objects.length;
    }

    addObject([]);
    addObject([]);
    addObject([
      asciiBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    ]);
    addObject([
      asciiBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
    ]);

    const imageObjMap = {};
    for (const img of images) {
      const header = asciiBytes(
        `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`
      );
      const footer = asciiBytes('\nendstream');
      imageObjMap[img.name] = addObject([header, img.bytes, footer]);
    }

    const xObjectDictEntries = images
      .map((img) => `/${img.name} ${imageObjMap[img.name]} 0 R`)
      .join(' ');

    const pageObjIds = [];
    for (const page of pages) {
      const streamBytes = page.toUint8Array();
      const contentId = addObject([
        asciiBytes(`<< /Length ${streamBytes.length} >>\nstream\n`),
        streamBytes,
        asciiBytes('\nendstream')
      ]);

      const xObjPart = xObjectDictEntries ? ` /XObject << ${xObjectDictEntries} >>` : '';
      const pageId = addObject([
        asciiBytes(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xObjPart} >> /Contents ${contentId} 0 R >>`
        )
      ]);
      pageObjIds.push(pageId);
    }

    objects[0] = [asciiBytes('<< /Type /Catalog /Pages 2 0 R >>')];
    objects[1] = [asciiBytes(`<< /Type /Pages /Kids [ ${pageObjIds.map((id) => `${id} 0 R`).join(' ')} ] /Count ${pageObjIds.length} >>`)];

    const outputChunks = [];
    let byteCursor = 0;

    function pushBytes(u8) {
      outputChunks.push(u8);
      byteCursor += u8.length;
    }

    pushBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

    const offsets = [0];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(byteCursor);
      pushBytes(asciiBytes(`${i + 1} 0 obj\n`));
      for (const part of objects[i]) {
        pushBytes(part);
      }
      pushBytes(asciiBytes('\nendobj\n'));
    }

    const xrefStart = byteCursor;
    pushBytes(asciiBytes(`xref\n0 ${objects.length + 1}\n`));
    pushBytes(asciiBytes('0000000000 65535 f \n'));
    for (let i = 1; i <= objects.length; i++) {
      const off = String(offsets[i]).padStart(10, '0');
      pushBytes(asciiBytes(`${off} 00000 n \n`));
    }

    pushBytes(
      asciiBytes(
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
      )
    );

    return new Blob(outputChunks, { type: 'application/pdf' });
  }

  /**
   * Dibuja un campo etiqueta + valor con línea inferior sutil dentro de una celda.
   */
  function drawLabeledField(page, label, value, x, y, maxW, labelW) {
    page.text(label, x, y + 4, { size: 7.8, bold: true, color: C_INK });
    const valX = x + labelW;
    const availW = Math.max(20, maxW - labelW - 6);
    const valText = fitTextToWidth(value || '', 8.0, availW, false);
    if (valText) {
      page.text(valText, valX + 2, y + 3.8, { size: 8.0, color: C_INK });
    }
    page.line(valX, y + 12.5, x + maxW - 6, y + 12.5, C_BORDER_LIGHT, 0.55);
  }

  /**
   * Dibuja un cuadro de verificación [✓] o [ ] con color opcional.
   */
  function drawCheckMarkBox(page, x, y, size, checked, color) {
    const fill = checked ? (color === C_RED ? C_RED_SOFT : C_GREEN_SOFT) : C_WHITE;
    const stroke = checked ? color : C_BORDER;
    page.rect(x, y, size, size, fill, stroke, 0.75);
    if (checked) {
      page.checkmark(x, y, size, color);
    }
  }

  /**
   * Dibuja la Página 1 replicando el FORMATO DE INVENTARIO (Versión 3).
   */
  function drawFormatPageOne(p1, state) {
    const m = state.meta;
    drawGoogleTopBar(p1);

    let y = 28;

    // Título principal en recuadro
    p1.rect(MARGIN_X, y, CONTENT_W, 20, C_BG_SUB, C_BORDER, 0.85);
    p1.text('FORMATO DE INVENTARIO', MARGIN_X + CONTENT_W / 2, y + 5.5, { size: 10.5, bold: true, color: C_INK, align: 'center' });
    y += 24;

    // Bloque 1: EMPRESA / No. Ticket / Nombre Usuario / Fecha
    const b1H = 48;
    p1.rect(MARGIN_X, y, CONTENT_W, b1H, C_WHITE, C_BORDER, 0.85);
    p1.line(MARGIN_X, y + 16, MARGIN_X + CONTENT_W, y + 16, C_BORDER, 0.65);
    p1.line(MARGIN_X + 340, y, MARGIN_X + 340, y + 16, C_BORDER, 0.65);

    drawLabeledField(p1, 'EMPRESA:', m.empresa, MARGIN_X + 6, y + 1, 332, 52);
    drawLabeledField(p1, 'No. Ticket:', m.ticket, MARGIN_X + 346, y + 1, 192, 52);
    drawLabeledField(p1, 'Nombre Usuario:', m.usuario, MARGIN_X + 6, y + 17, CONTENT_W - 10, 76);
    drawLabeledField(p1, 'Fecha:', formatDateDisplay(m.fecha), MARGIN_X + 6, y + 33, 200, 34);
    y += b1H;

    // Bloque 2: DESCRIPCIÓN DEL EQUIPO
    const descHeaderH = 16;
    const descBodyH = 113; // Tipo/SN (17) + Marca (16) + 5 filas hardware (5 * 16 = 80)
    p1.rect(MARGIN_X, y, CONTENT_W, descHeaderH, C_BG_SUB, C_BORDER, 0.85);
    p1.text('DESCRIPCIÓN DEL EQUIPO', MARGIN_X + CONTENT_W / 2, y + 4.2, { size: 8.5, bold: true, color: C_INK, align: 'center' });
    y += descHeaderH;

    p1.rect(MARGIN_X, y, CONTENT_W, descBodyH, C_WHITE, C_BORDER, 0.85);

    // Fila Tipo: PORTATIL [ ] PC [ ] S/N:
    const isPortatil = m.tipoEquipo === 'Portátil';
    const isPc = m.tipoEquipo === 'PC';
    p1.text('Tipo:', MARGIN_X + 6, y + 5, { size: 7.8, bold: true, color: C_INK });
    p1.text('PORTATIL', MARGIN_X + 74, y + 5, { size: 7.8, color: C_INK });
    drawCheckMarkBox(p1, MARGIN_X + 124, y + 3.5, 10, isPortatil, C_BLUE);

    p1.text('PC', MARGIN_X + 220, y + 5, { size: 7.8, color: C_INK });
    drawCheckMarkBox(p1, MARGIN_X + 244, y + 3.5, 10, isPc, C_BLUE);

    drawLabeledField(p1, 'S/N:', m.sn, MARGIN_X + 286, y + 1, 250, 24);

    // Fila Marca:
    drawLabeledField(p1, 'Marca:', m.marca, MARGIN_X + 6, y + 18, 260, 36);

    // 5 filas de 2 columnas (Izq / Der)
    const hwRows = [
      ['Procesador:', m.procesador, 'Modelo:', m.modelo],
      ['Memoria RAM:', m.ram, 'Disco Duro:', m.disco],
      ['Unidad Óptica:', m.unidadOptica, 'S.O:', m.so],
      ['Monitor:', m.monitor, 'Serial:', m.monitorSerial],
      ['Teclado:', m.teclado, 'Serial:', m.tecladoSerial]
    ];

    hwRows.forEach(([lLabel, lVal, rLabel, rVal], idx) => {
      const ry = y + 34 + idx * 16;
      drawLabeledField(p1, lLabel, lVal, MARGIN_X + 6, ry, 260, 68);
      drawLabeledField(p1, rLabel, rVal, MARGIN_X + 286, ry, 250, 56);
    });

    y += descBodyH;

    // Bloque 3: CHECKLIST MANTENIMIENTO PREVENTIVO
    const chkTopY = y;
    const chkTitleH = 16;

    // Precalcular altura de cada fila del checklist para alinear cuadrículas y borde exterior
    const leftTextX = MARGIN_X + 6;
    const leftSiX = MARGIN_X + 236;
    const colBoxW = 24;
    const fotosSiX = MARGIN_X + 306;
    const estadoBoxX = MARGIN_X + 412;
    const estadoBoxW = CONTENT_W - (estadoBoxX - MARGIN_X); // 128

    // Filas: 3 de Antivirus + ítems con FOTOS
    const avRows = state.antivirus.map((av, idx) => {
      let text = av.label;
      if (av.id === 'av_otro') {
        text = av.detail && av.detail.trim() ? `Otro: ${av.detail.trim()}` : 'Otro: _______________';
      }
      return {
        prefix: idx === 0 ? 'Antivirus:' : '',
        label: text,
        checkStatus: av.status,
        hasFotoCols: false,
        fotoStatus: null,
        lines: [text],
        height: 14
      };
    });

    const itemRows = state.items
      .filter((item) => item.inChecklist !== false)
      .map((item) => {
        const lines = wrapText(item.title, 7.5, 224, true);
        const height = Math.max(14, lines.length * 9.2 + 4.8);
        const hasPhotos = item.photos.length > 0;
        const fotoStatus = state.isBlankTemplate
          ? null
          : !item.requiresPhoto && !hasPhotos
            ? 'NO'
            : hasPhotos
              ? 'SI'
              : 'NO';
        const checkStatus = state.isBlankTemplate ? null : item.checkStatus || (hasPhotos ? 'SI' : null);
        return {
          prefix: '',
          label: item.title,
          checkStatus,
          hasFotoCols: true,
          fotoStatus,
          lines,
          height
        };
      });

    const allChecklistRows = [...avRows, ...itemRows];
    const headerRowH = 15;
    const bodyChecklistH = headerRowH + allChecklistRows.reduce((acc, r) => acc + r.height, 0);
    const totalChecklistH = chkTitleH + bodyChecklistH;

    p1.rect(MARGIN_X, chkTopY, CONTENT_W, totalChecklistH, C_WHITE, C_BORDER, 0.85);
    p1.text('CHECKLIST MANTENIMIENTO PREVENTIVO', MARGIN_X + CONTENT_W / 2, chkTopY + 4, { size: 8.4, bold: true, color: C_INK, align: 'center' });

    let ry = chkTopY + chkTitleH;

    // Encabezado SI | NO del checklist principal
    p1.rect(leftSiX, ry, colBoxW, headerRowH, C_BG_HEADER, C_BORDER, 0.65);
    p1.rect(leftSiX + colBoxW, ry, colBoxW, headerRowH, C_BG_HEADER, C_BORDER, 0.65);
    p1.text('SI', leftSiX + colBoxW / 2, ry + 4, { size: 7.5, bold: true, color: C_INK, align: 'center' });
    p1.text('NO', leftSiX + colBoxW * 1.5, ry + 4, { size: 7.5, bold: true, color: C_INK, align: 'center' });

    // Caja Estado del Equipo (arriba a la derecha dentro del checklist)
    const estY = ry;
    const estH = 62;
    p1.rect(estadoBoxX, estY, estadoBoxW, estH, C_WHITE, C_BORDER, 0.8);
    p1.line(estadoBoxX, estY + 15, estadoBoxX + estadoBoxW, estY + 15, C_BORDER, 0.7);
    p1.text('Estado del Equipo', estadoBoxX + 6, estY + 4, { size: 8.0, bold: true, color: C_INK });

    const isOperable = m.estadoEquipo === 'Operable';
    const isNoOperable = m.estadoEquipo === 'No Operable';
    p1.text('Operable', estadoBoxX + 6, estY + 23, { size: 7.8, color: C_INK });
    drawCheckMarkBox(p1, estadoBoxX + estadoBoxW - 22, estY + 21, 11, isOperable, C_GREEN);

    p1.text('No Operable', estadoBoxX + 6, estY + 43, { size: 7.8, color: C_INK });
    drawCheckMarkBox(p1, estadoBoxX + estadoBoxW - 22, estY + 41, 11, isNoOperable, C_RED);

    ry += headerRowH;

    allChecklistRows.forEach((row, idx) => {
      const h = row.height;

      // Texto de Antivirus / Ítem
      if (idx < 3) {
        if (row.prefix) {
          p1.text(row.prefix, leftTextX, ry + 3.4, { size: 7.6, bold: true, color: C_INK });
        }
        p1.text(fitTextToWidth(row.label, 7.5, 152, false), leftTextX + 76, ry + 3.4, { size: 7.5, color: C_INK });
      } else {
        const startY = ry + (h - row.lines.length * 9.2) / 2 + 1;
        row.lines.forEach((ln, li) => {
          p1.text(ln, leftTextX, startY + li * 9.2, { size: 7.5, bold: true, color: C_INK });
        });
      }

      // Celdas SI | NO izquierda
      p1.rect(leftSiX, ry, colBoxW, h, C_WHITE, C_BORDER, 0.6);
      p1.rect(leftSiX + colBoxW, ry, colBoxW, h, C_WHITE, C_BORDER, 0.6);
      if (row.checkStatus === 'SI') {
        p1.text('X', leftSiX + colBoxW / 2, ry + h / 2 - 4, { size: 8.2, bold: true, color: C_GREEN, align: 'center' });
      } else if (row.checkStatus === 'NO') {
        p1.text('X', leftSiX + colBoxW * 1.5, ry + h / 2 - 4, { size: 8.2, bold: true, color: C_RED, align: 'center' });
      }

      // Etiqueta FOTOS: y su cabecera SI | NO alineadas exactamente con filas 2 y 3 (igual que el formato original)
      if (idx === 1) {
        p1.text('FOTOS:', fotosSiX + colBoxW, ry + 4, { size: 7.8, bold: true, color: C_INK, align: 'center' });
      } else if (idx === 2) {
        p1.rect(fotosSiX, ry, colBoxW, h, C_BG_HEADER, C_BORDER, 0.65);
        p1.rect(fotosSiX + colBoxW, ry, colBoxW, h, C_BG_HEADER, C_BORDER, 0.65);
        p1.text('SI', fotosSiX + colBoxW / 2, ry + 4, { size: 7.5, bold: true, color: C_INK, align: 'center' });
        p1.text('NO', fotosSiX + colBoxW * 1.5, ry + 4, { size: 7.5, bold: true, color: C_INK, align: 'center' });
      }

      // Celdas FOTOS: SI | NO para los 9 ítems
      if (row.hasFotoCols) {
        p1.rect(fotosSiX, ry, colBoxW, h, C_WHITE, C_BORDER, 0.6);
        p1.rect(fotosSiX + colBoxW, ry, colBoxW, h, C_WHITE, C_BORDER, 0.6);
        if (row.fotoStatus === 'SI') {
          p1.text('X', fotosSiX + colBoxW / 2, ry + h / 2 - 4, { size: 8.2, bold: true, color: C_BLUE, align: 'center' });
        } else if (row.fotoStatus === 'NO') {
          p1.text('X', fotosSiX + colBoxW * 1.5, ry + h / 2 - 4, { size: 8.2, bold: true, color: C_MUTED, align: 'center' });
        }
      }

      ry += h;
    });

    y = chkTopY + totalChecklistH;

    // Bloque 4: OBSERVACIONES con líneas horizontales tipo formato
    const obsBoxH = 68;
    p1.rect(MARGIN_X, y, CONTENT_W, obsBoxH, C_WHITE, C_BORDER, 0.85);
    p1.rect(MARGIN_X, y, 86, 17, C_WHITE, C_BORDER, 0.65);
    p1.text('OBSERVACIONES', MARGIN_X + 7, y + 4.8, { size: 7.8, bold: true, color: C_INK });

    for (let li = 1; li <= 3; li++) {
      const ly = y + li * 17;
      p1.line(MARGIN_X, ly, MARGIN_X + CONTENT_W, ly, C_BORDER, 0.55);
    }

    const obsClean = (m.observaciones || '').trim();
    if (obsClean) {
      const obsLines = wrapText(obsClean, 8.1, CONTENT_W - 100, false);
      if (obsLines[0]) {
        p1.text(obsLines[0], MARGIN_X + 94, y + 4.5, { size: 8.1, color: C_INK });
      }
      const restText = obsLines.slice(1).join(' ');
      if (restText) {
        const restLines = wrapText(restText, 8.1, CONTENT_W - 16, false).slice(0, 3);
        restLines.forEach((ln, idx) => {
          p1.text(ln, MARGIN_X + 8, y + 21.5 + idx * 17, { size: 8.1, color: C_INK });
        });
      }
    }

    y += obsBoxH;

    // Bloque 5: FIRMAS (Usuario CLIENTE y Técnico TELEFONICA)
    const sigBoxH = 112;
    const halfW = CONTENT_W / 2;
    p1.rect(MARGIN_X, y, CONTENT_W, sigBoxH, C_WHITE, C_BORDER, 0.85);
    p1.line(MARGIN_X + halfW, y, MARGIN_X + halfW, y + sigBoxH, C_BORDER, 0.8);

    // Trazo vectorial de firmas arriba de las líneas de firma
    p1.signatureStrokes(m.firmaClienteStrokes, MARGIN_X + 20, y + 8, halfW - 40, 56, C_INK);
    p1.signatureStrokes(m.firmaTecnicoStrokes, MARGIN_X + halfW + 20, y + 8, halfW - 40, 56, C_INK);

    const lineSigY = y + 78;
    p1.text('Firma Usuario (CLIENTE):', MARGIN_X + 8, lineSigY - 8, { size: 7.8, bold: true, color: C_INK });
    p1.line(MARGIN_X + 114, lineSigY, MARGIN_X + halfW - 12, lineSigY, C_BORDER, 0.65);

    p1.text('Nombre:', MARGIN_X + 8, lineSigY + 12, { size: 7.8, bold: true, color: C_INK });
    if (m.firmaClienteNombre && m.firmaClienteNombre.trim()) {
      p1.text(fitTextToWidth(m.firmaClienteNombre.trim(), 8.1, halfW - 64, false), MARGIN_X + 48, lineSigY + 11.5, { size: 8.1, color: C_INK });
    }
    p1.line(MARGIN_X + 46, lineSigY + 20, MARGIN_X + halfW - 12, lineSigY + 20, C_BORDER, 0.65);

    p1.text('Firma Tecnico (TELEFONICA):', MARGIN_X + halfW + 8, lineSigY - 8, { size: 7.8, bold: true, color: C_INK });
    p1.line(MARGIN_X + halfW + 132, lineSigY, MARGIN_X + CONTENT_W - 12, lineSigY, C_BORDER, 0.65);

    if (m.firmaTecnicoNombre && m.firmaTecnicoNombre.trim()) {
      p1.text('Nombre:', MARGIN_X + halfW + 8, lineSigY + 12, { size: 7.8, bold: true, color: C_INK });
      p1.text(fitTextToWidth(m.firmaTecnicoNombre.trim(), 8.1, halfW - 64, false), MARGIN_X + halfW + 48, lineSigY + 11.5, { size: 8.1, color: C_INK });
      p1.line(MARGIN_X + halfW + 46, lineSigY + 20, MARGIN_X + CONTENT_W - 12, lineSigY + 20, C_BORDER, 0.65);
    }

    y += sigBoxH + 8;

    // Versión oficial del formato
    p1.text('Formato de inventario y Mantenimiento Preventivo. Versión 3', MARGIN_X + CONTENT_W, y, {
      size: 7.8,
      color: C_MUTED,
      align: 'right'
    });
  }

  /**
   * Genera el PDF completo (Página 1 = Formato de Inventario, Páginas 2..N = Evidencias).
   */
  async function generateEvidencePdf(state) {
    const pages = [];
    const encodedImages = [];
    let imgCounter = 1;

    // 1. Preprocesar todas las fotos a JPEG en paralelo manteniendo orden
    const itemJpegs = new Map();
    const rasterizedPerItem = await Promise.all(
      state.items.map((item) => Promise.all(item.photos.map((photo) => rasterizeToJpeg(photo))))
    );

    state.items.forEach((item, idx) => {
      const list = [];
      rasterizedPerItem[idx].forEach((jpeg, pIdx) => {
        const name = `Im${imgCounter++}`;
        const imgRecord = { name, ...jpeg };
        encodedImages.push(imgRecord);
        list.push({
          ...imgRecord,
          caption: (item.photos[pIdx].caption || '').trim()
        });
      });
      itemJpegs.set(item.id, list);
    });

    // 2. Página 1 (opcional): Formato de Inventario y Mantenimiento Preventivo
    if (state.includeInventario !== false) {
      const p1 = new PageCanvas();
      pages.push(p1);
      drawFormatPageOne(p1, state);
    }

    if (state.isBlankTemplate) {
      return assemblePdf(pages, encodedImages);
    }

    // 3. Páginas siguientes: Evidencias Fotográficas Adjuntas
    let curPage = new PageCanvas();
    pages.push(curPage);
    drawGoogleTopBar(curPage);
    let cy = MARGIN_TOP;

    function startNewEvidencePage(continuedLabel) {
      curPage = new PageCanvas();
      pages.push(curPage);
      drawGoogleTopBar(curPage);
      cy = MARGIN_TOP;
      curPage.text(continuedLabel || 'EVIDENCIAS FOTOGRÁFICAS ADJUNTAS', MARGIN_X, cy, { size: 10.5, bold: true, color: C_MUTED });
      cy += 20;
    }

    curPage.text('EVIDENCIAS FOTOGRÁFICAS ADJUNTAS', MARGIN_X, cy, { size: 13.5, bold: true, color: C_INK });
    cy += 17;
    const subRef = [state.meta.ticket, state.meta.sn, state.meta.usuario].filter(Boolean).join(' · ');
    curPage.text(
      subRef ? `Registro visual · ${subRef}` : 'Registro visual correspondiente a los puntos del checklist preventivo',
      MARGIN_X,
      cy,
      { size: 9, color: C_MUTED }
    );
    cy += 18;

    state.items.forEach((item, idx) => {
      const photos = itemJpegs.get(item.id) || [];
      const itemTitle = `${idx + 1}. ${item.title}`;

      if (photos.length === 0) {
        if (cy + 34 > PAGE_H - MARGIN_BOTTOM) {
          startNewEvidencePage();
        }
        curPage.rect(MARGIN_X, cy, CONTENT_W, 26, C_BG_LIGHT, C_BORDER_LIGHT, 0.6);
        curPage.text(itemTitle, MARGIN_X + 10, cy + 8.5, { size: 8.5, bold: true, color: C_MUTED });
        curPage.text('FOTOS: NO (Omitido)', MARGIN_X + CONTENT_W - 10, cy + 8.5, { size: 8, bold: true, color: C_MUTED, align: 'right' });
        cy += 34;
        return;
      }

      const titleLines = wrapText(itemTitle, 9.5, CONTENT_W - 86, true);
      const itemHeaderH = Math.max(24, titleLines.length * 12 + 12);
      const isSingle = photos.length === 1;
      const colGap = 12;
      const colW = isSingle ? CONTENT_W : (CONTENT_W - colGap) / 2;
      const maxImgH = isSingle ? 235 : 176;

      const photoRows = [];
      if (isSingle) {
        photoRows.push([photos[0]]);
      } else {
        for (let i = 0; i < photos.length; i += 2) {
          photoRows.push(photos.slice(i, i + 2));
        }
      }

      function computeRowMetrics(rowPhotos) {
        const slotPadding = 8;
        const innerW = colW - slotPadding * 2;
        let maxScaledH = 0;
        let hasCaption = false;

        const computed = rowPhotos.map((p) => {
          const ratio = Math.min(innerW / p.width, maxImgH / p.height);
          const drawW = p.width * ratio;
          const drawH = p.height * ratio;
          if (drawH > maxScaledH) maxScaledH = drawH;
          if (p.caption) hasCaption = true;
          return { ...p, drawW, drawH };
        });

        const captionH = hasCaption ? 16 : 0;
        const cardH = slotPadding * 2 + maxScaledH + captionH;
        return { computed, cardH, slotPadding, maxScaledH, hasCaption };
      }

      const firstMetrics = computeRowMetrics(photoRows[0]);
      if (cy + itemHeaderH + firstMetrics.cardH > PAGE_H - MARGIN_BOTTOM) {
        startNewEvidencePage();
      }

      function drawSectionBanner(isContinuation) {
        const label = isContinuation ? `${itemTitle} (continuación)` : itemTitle;
        const lines = wrapText(label, 9.5, CONTENT_W - 86, true);
        const h = Math.max(24, lines.length * 12 + 12);

        curPage.rect(MARGIN_X, cy, CONTENT_W, h, C_BG_SUB, C_BORDER_LIGHT, 0.75);
        curPage.rect(MARGIN_X, cy, 3.5, h, C_BLUE, null);
        lines.forEach((ln, li) => {
          curPage.text(ln, MARGIN_X + 11, cy + 7 + li * 12, { size: 9.5, bold: true, color: C_INK });
        });
        const badgeText = `${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}`;
        curPage.text(badgeText, MARGIN_X + CONTENT_W - 10, cy + 7.5, { size: 8, bold: true, color: C_GREEN, align: 'right' });
        cy += h + 8;
      }

      drawSectionBanner(false);

      photoRows.forEach((rowPhotos, rowIdx) => {
        const m = rowIdx === 0 ? firstMetrics : computeRowMetrics(rowPhotos);
        if (rowIdx > 0 && cy + m.cardH > PAGE_H - MARGIN_BOTTOM) {
          startNewEvidencePage();
          drawSectionBanner(true);
        }

        m.computed.forEach((p, colIdx) => {
          const cardX = MARGIN_X + colIdx * (colW + colGap);
          curPage.rect(cardX, cy, colW, m.cardH, C_WHITE, C_BORDER_LIGHT, 0.75);

          const imgX = cardX + (colW - p.drawW) / 2;
          const imgY = cy + m.slotPadding + (m.maxScaledH - p.drawH) / 2;
          curPage.image(p.name, imgX, imgY, p.drawW, p.drawH);

          if (p.caption) {
            const capLines = wrapText(p.caption, 8, colW - 16, false);
            curPage.text(
              capLines[0],
              cardX + colW / 2,
              cy + m.slotPadding + m.maxScaledH + 4,
              { size: 8, color: C_MUTED, align: 'center' }
            );
          }
        });

        cy += m.cardH + 10;
      });

      cy += 6;
    });

    // 4. Pie de página en todas las páginas
    const totalPages = pages.length;
    const now = new Date();
    const stamp = `${now.toLocaleDateString('es-CO')} ${now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`;

    pages.forEach((page, i) => {
      const footerY = PAGE_H - 26;
      page.line(MARGIN_X, footerY - 6, MARGIN_X + CONTENT_W, footerY - 6, C_BORDER_LIGHT, 0.5);
      page.text(`Formato de Inventario y Evidencias · ${stamp}`, MARGIN_X, footerY, { size: 7.5, color: C_MUTED });
      page.text(`Página ${i + 1} de ${totalPages}`, MARGIN_X + CONTENT_W, footerY, { size: 7.5, bold: true, color: C_MUTED, align: 'right' });
    });

    return assemblePdf(pages, encodedImages);
  }

  global.PdfEvidenceGenerator = {
    generateEvidencePdf
  };
})(window);
