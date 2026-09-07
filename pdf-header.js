/* El cintillo institucional de todos los PDF, con los tres logos.
   Es el mismo de la Sala Situacional, adaptado a scripts sueltos.
   Uso:  var y = dibujarHeaderPDF(doc, {titulo, subtitulo}); */
(function () {
  'use strict';
// pdf-header.js
// Helper unico para que TODOS los PDFs del proyecto tengan el mismo cintillo
// institucional con los 3 logos (Cristobal Rojas, Yuhismar, PSUV).
//
// Uso:
//   import { dibujarHeaderPDF } from './pdf-header.js';
//   const doc = new jsPDF();
//   const yInicio = dibujarHeaderPDF(doc, {
//     titulo: 'Reporte de Asistencia',
//     subtitulo: 'Periodo 01-mar a 31-mar 2026'
//   });
//   autoTable(doc, { startY: yInicio + 4, head: [...], body: [...] });


/**
 * Dibuja el cintillo institucional en la pagina actual y devuelve la Y donde
 * el cuerpo del documento puede empezar a escribir (en mm).
 *
 * @param {jsPDF} doc - instancia de jsPDF
 * @param {Object} opts
 * @param {string} opts.titulo    - titulo principal grande
 * @param {string} [opts.subtitulo] - linea opcional debajo del titulo
 * @returns {number} y en mm donde el cuerpo puede comenzar
 */
function dibujarHeaderPDF(doc, { titulo, subtitulo } = {}) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const orientation = doc.internal.pageSize.getWidth() > doc.internal.pageSize.getHeight() ? 'landscape' : 'portrait';

    // Margen y banda azul institucional arriba
    doc.setFillColor(10, 35, 81);   // #0a2351
    doc.rect(0, 0, pageWidth, 6, 'F');

    // Logo Cristobal Rojas (izquierda)
    try { doc.addImage(window.LOGO_CRISTOBAL_ROJAS, 'PNG', 14, 10, 22, 22); } catch (_) {}

    // Logo PSUV (derecha)
    try { doc.addImage(window.LOGO_PSUV, 'PNG', pageWidth - 50, 12, 36, 18); } catch (_) {}

    // Texto institucional centrado
    doc.setTextColor(10, 35, 81);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('ALCALDIA DEL MUNICIPIO CRISTOBAL ROJAS', pageWidth / 2, 16, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text('Republica Bolivariana de Venezuela - Estado Miranda - Despacho de la Alcaldesa', pageWidth / 2, 21, { align: 'center' });

    // Logo Yuhismar (texto, debajo del titulo institucional)
    try { doc.addImage(window.LOGO_YUHISMAR, 'PNG', pageWidth / 2 - 22, 23, 44, 8); } catch (_) {}

    // Linea separadora dorada delgada
    doc.setDrawColor(212, 160, 23); // #d4a017 dorado oxido
    doc.setLineWidth(0.7);
    doc.line(14, 35, pageWidth - 14, 35);

    let cursorY = 41;

    // Titulo del documento
    if (titulo) {
        doc.setTextColor(10, 35, 81);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text(titulo, 14, cursorY);
        cursorY += 5;
    }

    if (subtitulo) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text(subtitulo, 14, cursorY);
        cursorY += 5;
    }

    // Fecha de generacion (siempre)
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    const ahora = new Date().toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    doc.text(`Generado el ${ahora}`, pageWidth - 14, cursorY, { align: 'right' });

    // Reset estilos antes de devolver
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    return cursorY + 2;
}

/**
 * Pie de pagina con leyenda institucional + paginacion. Llamar al final
 * (despues de autoTable) o en cada cambio de pagina via didDrawPage.
 */
function dibujarFooterPDF(doc) {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    doc.setDrawColor(10, 35, 81);
    doc.setLineWidth(0.3);
    doc.line(14, pageH - 12, pageW - 14, pageH - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text('Despacho de la Alcaldesa Yuhismar Hernandez - Municipio Cristobal Rojas - Farmacia Municipal', pageW / 2, pageH - 7, { align: 'center' });
    const pagina = doc.internal.getNumberOfPages();
    doc.text(`Pagina ${pagina}`, pageW - 14, pageH - 7, { align: 'right' });
}

  window.dibujarHeaderPDF = dibujarHeaderPDF;
  window.dibujarFooterPDF = dibujarFooterPDF;
})();
