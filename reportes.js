/* REPORTES: lo que se imprime y lo que se descarga.

   Tres cosas que la farmacia necesita en papel o en Excel:

     · El ACTA DE ENTREGA-RECEPCIÓN de lo que se despacha a un centro de
       salud. Es el documento que firma quien recibe y el que respalda la
       salida del inventario. Estaba en el plan desde el principio.
     · El COMPROBANTE de lo que retiró una persona.
     · Los LISTADOS en Excel: catálogo, alertas de vencimiento, historial
       de entregas y bitácora.

   Todos llevan el mismo cintillo institucional de la Alcaldía, el mismo
   que usan los demás sistemas del municipio. */
(function () {
  'use strict';

  var R = {};

  function esc(t) { return String(t == null ? '' : t); }

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
               'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /* Las fechas de cara al usuario van en letra Y en números: así se leen
     bien y no hay dudas de si el 03/04 es marzo o abril. */
  function fechaLarga(f) {
    var d = f ? new Date(String(f).slice(0, 10) + 'T12:00:00') : new Date();
    return d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear() +
           ' · ' + String(d.getDate()).padStart(2, '0') + '/' +
           String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }
  function fechaCorta(f) {
    if (!f) return '';
    var p = String(f).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(f);
  }
  function ahora() {
    var d = new Date();
    return fechaLarga(d) + ' a las ' + String(d.getHours()).padStart(2, '0') + ':' +
           String(d.getMinutes()).padStart(2, '0');
  }
  function limpiaNombre(t) {
    return String(t || 'reporte').replace(/[\\/:*?"<>|]/g, '-').slice(0, 90);
  }

  function hayLibrerias() {
    return typeof window.XLSX !== 'undefined';
  }
  function hayPDF() {
    return window.jspdf && window.jspdf.jsPDF;
  }

  /* ================================================================
     EXCEL
     Formato de la casa: título en la primera fila, "Generado el…" en la
     segunda, encabezados en la tercera con filtro y panel congelado.
  ================================================================ */

  /* SheetJS no sabe congelar filas, así que hay que abrir el zip del
     archivo y meterle el <pane> a mano. Si algo falla, se guarda igual
     sin congelar: mejor un Excel sin congelar que ningún Excel. */
  function guardarXlsx(wb, nombre) {
    try {
      var filaHdr = (wb.SheetNames || []).map(function (n) {
        var ws = (wb.Sheets || {})[n] || {};
        var ref = ws['!autofilter'] && ws['!autofilter'].ref;
        var m = ref && /^[A-Za-z]+(\d+)/.exec(String(ref));
        return m ? Number(m[1]) : 0;
      });
      if (!filaHdr.some(Boolean)) throw new Error('ninguna hoja tiene filtro');
      var cfb = XLSX.CFB.read(new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })),
                              { type: 'array' });
      var n = 0;
      (cfb.FullPaths || []).forEach(function (ruta, i) {
        var mh = /\/xl\/worksheets\/sheet(\d+)\.xml$/.exec(ruta);
        if (!mh) return;
        var y = filaHdr[Number(mh[1]) - 1];
        var ent = cfb.FileIndex[i];
        if (!y || !ent || !ent.content) return;
        var celda = 'A' + (y + 1);
        var pane = '<pane ySplit="' + y + '" topLeftCell="' + celda + '" activePane="bottomLeft" state="frozen"/>' +
                   '<selection pane="bottomLeft" activeCell="' + celda + '" sqref="' + celda + '"/>';
        var xml = new TextDecoder('utf-8').decode(new Uint8Array(ent.content));
        var antes = xml;
        xml = xml.replace(/(<sheetView[^>]*?)\/>/, '$1>' + pane + '</sheetView>');
        if (xml === antes) return;
        var b = new TextEncoder().encode(xml);
        ent.content = b; ent.size = b.length; n++;
      });
      if (!n) throw new Error('no se pudo congelar');
      var blob = new Blob([XLSX.CFB.write(cfb, { type: 'array', fileType: 'zip' })],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = nombre;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    } catch (e) {
      XLSX.writeFile(wb, nombre);
    }
  }

  var AZUL = '0A2351', ORO = 'F4C20D';

  function hoja(h) {
    var enc = h.encabezados, filas = h.filas;
    var datos = [[h.titulo], ['Generado el ' + ahora()], enc].concat(filas);
    var ws = XLSX.utils.aoa_to_sheet(datos);
    var ancho = enc.length;

    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: ancho - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: ancho - 1 } }
    ];
    ws['!cols'] = (h.anchos || enc.map(function () { return 18; }))
      .map(function (w) { return { wch: w }; });
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({
      s: { r: 2, c: 0 }, e: { r: 2 + filas.length, c: ancho - 1 } }) };
    ws['!freeze'] = { xSplit: 0, ySplit: 3 };

    /* Título, subtítulo y encabezados con el color institucional. */
    if (ws.A1) ws.A1.s = { font: { bold: true, sz: 15, color: { rgb: AZUL } },
                           alignment: { horizontal: 'center' } };
    if (ws.A2) ws.A2.s = { font: { sz: 10, color: { rgb: '777777' } },
                           alignment: { horizontal: 'center' } };
    for (var c = 0; c < ancho; c++) {
      var ref = XLSX.utils.encode_cell({ r: 2, c: c });
      if (ws[ref]) ws[ref].s = {
        font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: AZUL } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: { bottom: { style: 'thin', color: { rgb: ORO } } }
      };
    }
    return ws;
  }

  /* hojas = [{ nombre, titulo, encabezados, filas, anchos }] */
  R.excel = function (archivo, hojas) {
    if (!hayLibrerias()) { alert('Todavía se está cargando el generador de Excel. Inténtalo en unos segundos.'); return; }
    var wb = XLSX.utils.book_new();
    hojas.forEach(function (h) {
      XLSX.utils.book_append_sheet(wb, hoja(h), (h.nombre || 'Hoja').slice(0, 31));
    });
    guardarXlsx(wb, limpiaNombre(archivo) + '.xlsx');
  };

  /* ================================================================
     PDF
  ================================================================ */
  /* Guardar o devolver. Devolverlo sirve para las pruebas: se puede mirar
     el PDF sin depender de que el navegador complete una descarga. */
  function entregar(doc, nombre, devolver) {
    if (devolver) return doc.output('datauristring');
    doc.save(limpiaNombre(nombre) + '.pdf');
    return null;
  }

  function nuevoPDF(horizontal) {
    var jsPDF = window.jspdf.jsPDF;
    return new jsPDF({ orientation: horizontal ? 'landscape' : 'portrait',
                       unit: 'mm', format: 'letter' });
  }

  /* Un listado cualquiera, con el cintillo y el pie institucional. */
  R.pdfTabla = function (opts) {
    if (!hayPDF()) { alert('Todavía se está cargando el generador de PDF. Inténtalo en unos segundos.'); return; }
    var doc = nuevoPDF(opts.horizontal);
    var y = window.dibujarHeaderPDF(doc, { titulo: opts.titulo, subtitulo: opts.subtitulo });
    doc.autoTable({
      startY: y + 4,
      head: [opts.encabezados],
      body: opts.filas,
      styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak' },
      headStyles: { fillColor: [10, 35, 81], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [244, 247, 251] },
      columnStyles: opts.columnas || {},
      margin: { left: 14, right: 14 },
      didDrawPage: function () { window.dibujarFooterPDF(doc); }
    });
    return entregar(doc, opts.archivo || opts.titulo, opts.devolver);
  };

  /* ----------------------------------------------------------------
     ACTA DE ENTREGA-RECEPCIÓN
     Es el documento que respalda lo que sale hacia un centro de salud.
     Lo firma quien entrega y quien recibe.
  ---------------------------------------------------------------- */
  R.acta = function (d) {
    if (!hayPDF()) { alert('Todavía se está cargando el generador de PDF. Inténtalo en unos segundos.'); return; }
    var doc = nuevoPDF(false);
    var ancho = doc.internal.pageSize.getWidth();
    var y = window.dibujarHeaderPDF(doc, {
      titulo: 'Acta de Entrega-Recepción',
      subtitulo: 'Farmacia Municipal · ' + fechaLarga(d.fecha)
    });

    var total = d.renglones.reduce(function (s, r) { return s + Number(r.cantidad || 0); }, 0);

    /* El párrafo de rigor. Se escribe con los datos reales, no con
       espacios en blanco para llenar a mano. */
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    var texto =
      'En Charallave, Municipio Bolivariano Cristóbal Rojas del estado Miranda, en la fecha ' +
      'arriba indicada, la Dirección de Salud Pública de la Alcaldía, a través de su Farmacia ' +
      'Municipal, hace entrega formal al centro de salud ' + esc(d.centro) +
      (d.centroTipo ? ' (' + esc(d.centroTipo) + ')' : '') +
      ' de los medicamentos e insumos que se detallan a continuación, los cuales son recibidos ' +
      'de conformidad por la persona que suscribe al pie de la presente acta.';
    var lineas = doc.splitTextToSize(texto, ancho - 28);
    doc.text(lineas, 14, y + 8);
    var yy = y + 8 + lineas.length * 4.6;

    doc.autoTable({
      startY: yy + 4,
      head: [['#', 'Medicamento o insumo', 'Lote', 'Vence', 'Cantidad']],
      body: d.renglones.map(function (r, i) {
        return [i + 1, r.producto, r.lote || 'sin número', fechaCorta(r.vence) || 'sin fecha',
                String(r.cantidad)];
      }),
      foot: [['', 'TOTAL DE UNIDADES ENTREGADAS', '', '', String(total)]],
      styles: { fontSize: 9, cellPadding: 2.2 },
      headStyles: { fillColor: [10, 35, 81], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [238, 242, 249], textColor: [10, 35, 81], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 88 },
                      2: { cellWidth: 30 }, 3: { cellWidth: 26, halign: 'center' },
                      4: { cellWidth: 24, halign: 'right' } },
      margin: { left: 14, right: 14 },
      didDrawPage: function () { window.dibujarFooterPDF(doc); }
    });

    /* Las firmas. Si no caben, van en una hoja nueva: partir un acta
       entre la tabla y las firmas la deja sin valor. */
    var yFirma = doc.lastAutoTable.finalY + 22;
    if (yFirma > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage(); window.dibujarFooterPDF(doc); yFirma = 40;
    }
    firma(doc, 20, yFirma, 'ENTREGA', d.entregaNombre, d.entregaCedula,
          'Farmacia Municipal');
    firma(doc, ancho / 2 + 6, yFirma, 'RECIBE', d.recibeNombre, d.recibeCedula, d.centro);

    return entregar(doc, 'Acta de entrega - ' + d.centro + ' - ' + fechaCorta(d.fecha), d.devolver);
  };

  function firma(doc, x, y, rotulo, nombre, cedula, pie) {
    var w = 76;
    doc.setDrawColor(60, 60, 60);
    doc.setLineWidth(0.3);
    doc.line(x, y, x + w, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(10, 35, 81);
    doc.text(rotulo, x, y - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(40, 40, 40);
    doc.text(esc(nombre) || '', x, y + 5, { maxWidth: w });
    doc.setFontSize(8);
    doc.setTextColor(110, 110, 110);
    if (cedula) doc.text('C.I. ' + esc(cedula), x, y + 10);
    doc.text(esc(pie) || '', x, y + 15, { maxWidth: w });
  }

  /* ----------------------------------------------------------------
     COMPROBANTE de lo que retiró una persona
  ---------------------------------------------------------------- */
  R.comprobante = function (d) {
    if (!hayPDF()) { alert('Todavía se está cargando el generador de PDF. Inténtalo en unos segundos.'); return; }
    var doc = nuevoPDF(false);
    var ancho = doc.internal.pageSize.getWidth();
    var y = window.dibujarHeaderPDF(doc, {
      titulo: 'Comprobante de Entrega',
      subtitulo: 'Farmacia Municipal · ' + fechaLarga(d.fecha)
    });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(10, 35, 81);
    doc.text('Entregado a:', 14, y + 9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(30, 30, 30);
    doc.text(esc(d.paciente), 42, y + 9, { maxWidth: ancho - 56 });
    doc.setFontSize(9);
    doc.setTextColor(110, 110, 110);
    doc.text(esc(d.cedula || ''), 42, y + 14.5);

    var total = d.renglones.reduce(function (s, r) { return s + Number(r.cantidad || 0); }, 0);
    doc.autoTable({
      startY: y + 20,
      head: [['#', 'Medicamento', 'Lote', 'Vence', 'Cantidad']],
      body: d.renglones.map(function (r, i) {
        return [i + 1, r.producto, r.lote || 'sin número', fechaCorta(r.vence) || 'sin fecha',
                String(r.cantidad)];
      }),
      foot: [['', 'TOTAL', '', '', String(total)]],
      styles: { fontSize: 9, cellPadding: 2.2 },
      headStyles: { fillColor: [10, 35, 81], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [238, 242, 249], textColor: [10, 35, 81], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 88 },
                      2: { cellWidth: 30 }, 3: { cellWidth: 26, halign: 'center' },
                      4: { cellWidth: 24, halign: 'right' } },
      margin: { left: 14, right: 14 },
      didDrawPage: function () { window.dibujarFooterPDF(doc); }
    });

    var yFirma = doc.lastAutoTable.finalY + 24;
    if (yFirma > doc.internal.pageSize.getHeight() - 50) {
      doc.addPage(); window.dibujarFooterPDF(doc); yFirma = 40;
    }
    firma(doc, 20, yFirma, 'ENTREGA', d.entregaNombre, d.entregaCedula, 'Farmacia Municipal');
    firma(doc, ancho / 2 + 6, yFirma, 'RECIBE', d.paciente, d.cedula, '');

    return entregar(doc, 'Comprobante - ' + d.paciente + ' - ' + fechaCorta(d.fecha), d.devolver);
  };

  R.fechaCorta = fechaCorta;
  R.fechaLarga = fechaLarga;
  window.FARMREP = R;
})();
