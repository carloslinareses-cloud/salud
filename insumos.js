/* INSUMOS — lo que se le entrega a cada centro de salud o destino.

   Es la hoja del Excel de insumos llevada al sistema. Por ahora la
   primera: "REGISTRO DE ENTREGAS C.D.S". La segunda, "CONTROL DE INSUMOS
   ENTREGADOS", queda anunciada hasta que se explique cómo se usa.

   Cada entrega guarda: Fecha, Centro de Salud / Destino, Recibido Por
   (Responsable) y la Descripción del Insumo con cada insumo en su propio
   renglón y SU Cantidad Entregada. Se agregan de uno en uno con
   "Agregar +", sin límite.

   Es un REGISTRO: no descuenta del inventario. Se guarda por la función
   farmacia.insumos_cds_guardar, que revisa todo y guarda la entrega con
   todos sus insumos juntos (o nada). La ven inventario y el administrador.

   Lo que vino del Excel trae UNA cantidad para todos los insumos de su
   renglón: se muestra así, sin repartirla (repartirla sería inventar). */
(function (raiz) {
  'use strict';

  var HOJAS = [
    { v: 'registro', t: 'REGISTRO DE ENTREGAS C.D.S' },
    { v: 'control',  t: 'CONTROL DE INSUMOS ENTREGADOS' }
  ];
  var POR_PAGINA = 30;

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function F() { return raiz.FARM; }

  /* ================================================================
     Lógica pura (se prueba con Node en pruebas/insumos-unitarias.mjs)
  ================================================================ */

  /* "30" -> 30 · "1,5" -> 1.5 · "" -> null · "2.339" -> error (¿miles?) */
  function leeCantidad(v) {
    var t = String(v == null ? '' : v).replace(/\s+/g, '');
    if (t === '') return { valor: null };
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) return { error: 'Escribe la cantidad sin puntos de miles (ejemplo: 2339).' };
    if (!/^\d+([.,]\d{1,2})?$/.test(t)) return { error: 'La cantidad tiene que ser un número.' };
    var n = Number(t.replace(',', '.'));
    if (!(n > 0)) return { error: 'La cantidad tiene que ser mayor que cero.' };
    if (n > 1000000) return { error: 'Revisa la cantidad: es demasiado grande.' };
    return { valor: n };
  }

  /* Revisa el formulario ANTES de mandarlo. Devuelve { error } o { datos }.
     `exigeCantidad` es falso solo al corregir algo que vino del Excel. */
  function revisaFormulario(f, hoy, exigeCantidad) {
    var fecha = String(f.fecha || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: 'Falta la fecha.' };
    if (hoy && fecha > hoy) return { error: 'La fecha no puede ser futura.' };
    var destino = String(f.destino || '').replace(/\s+/g, ' ').trim();
    var recibe = String(f.recibido_por || '').replace(/\s+/g, ' ').trim();
    if (exigeCantidad && destino.length < 3) return { error: 'Escribe el centro de salud o destino.' };
    if (exigeCantidad && recibe.length < 3) return { error: 'Escribe quién lo recibió (el responsable).' };

    var items = [];
    var filas = f.items || [];
    for (var i = 0; i < filas.length; i++) {
      var it = filas[i] || {};
      var desc = F().normalizaInsumo(it.descripcion);
      var c = leeCantidad(it.cantidad);
      if (!desc && c.valor == null && !c.error) continue;          // renglón vacío: se ignora
      var n = items.length + 1;
      if (desc.length < 2) return { error: 'Al insumo número ' + n + ' le falta la descripción.' };
      if (c.error) return { error: desc + ': ' + c.error };
      if (c.valor == null && exigeCantidad) return { error: 'Falta la cantidad entregada de ' + desc + '.' };
      items.push({
        descripcion: desc, cantidad: c.valor,
        revisar: !!it.revisar, revisar_motivo: it.revisar ? (it.revisar_motivo || null) : null
      });
    }
    if (!items.length) return { error: 'Agrega al menos un insumo con su cantidad.' };
    return { datos: { fecha: fecha, destino: destino, recibido_por: recibe, items: items } };
  }

  function sumaCantidades(items) {
    var s = 0, hay = false;
    (items || []).forEach(function (it) {
      var c = typeof it.cantidad === 'number' ? { valor: it.cantidad } : leeCantidad(it.cantidad);
      if (c.valor != null) { s += c.valor; hay = true; }
    });
    return hay ? Math.round(s * 100) / 100 : null;
  }

  function num(n) {
    if (n == null || n === '') return '';
    return Number(n).toLocaleString('es-VE', { maximumFractionDigits: 2 });
  }

  /* Una fila de Excel/PDF por INSUMO. Lo del Excel no tiene cantidad por
     insumo: esa celda va vacía y la total del renglón va en su columna. */
  var ENCABEZADOS = ['Fecha', 'Centro de Salud / Destino', 'Descripción del Insumo', 'Cantidad Entregada',
                     'Recibido Por (Responsable)', 'Cantidad total del renglón (Excel)', 'Observación'];
  function filasReporte(entregas) {
    var filas = [];
    (entregas || []).forEach(function (e) {
      var items = e.items && e.items.length ? e.items : [{ descripcion: '', cantidad: null }];
      items.forEach(function (it, k) {
        var obs = [];
        if (it.revisar) obs.push('Por revisar: ' + (it.revisar_motivo || ''));
        if (!e.items || !e.items.length) obs.push('El Excel no anota insumos en este renglón');
        filas.push([
          F().muestraFecha(e.fecha),
          e.destino || 'No consta',
          it.descripcion || '',
          it.cantidad == null ? '' : Number(it.cantidad),
          e.recibido_por || 'No consta',
          k === 0 && e.cantidad_total_excel != null ? Number(e.cantidad_total_excel) : '',
          obs.join(' · ')
        ]);
      });
    });
    return filas;
  }

  var LOGICA = { leeCantidad: leeCantidad, revisaFormulario: revisaFormulario, sumaCantidades: sumaCantidades,
                 filasReporte: filasReporte, ENCABEZADOS: ENCABEZADOS, HOJAS: HOJAS };
  raiz.INSUMOS_LOGICA = LOGICA;
  if (typeof module !== 'undefined' && module.exports) module.exports = LOGICA;
  if (typeof document === 'undefined') return;

  /* ================================================================
     Pantalla
  ================================================================ */
  function Insumos(sb, zona, pfx) {
    this.sb = sb; this.raiz = zona; this.pfx = pfx;
    this.hoja = 'registro';
    this.modo = 'lista';              // lista | form | detalle
    this.busca = ''; this.desde = ''; this.hasta = ''; this.filtro = 'todas';
    this.pagina = 0; this.total = 0; this.filas = []; this.pedido = 0;
    this.actual = null;               // la entrega abierta (detalle o corrección)
    this.items = [];                  // los renglones del formulario
    this.esAdmin = false;
    this.destinos = [];
  }
  Insumos.prototype.id = function (n) { return this.pfx + n; };
  Insumos.prototype.q = function (n) { return this.raiz.querySelector('#' + this.pfx + n); };
  Insumos.prototype.aviso = function (clase, txt) {
    var z = this.q('Aviso');
    if (!z) return;
    z.innerHTML = '<div class="aviso ' + clase + '" role="status">' + esc(txt) + '</div>';
    if (z.scrollIntoView) z.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  Insumos.prototype.limpiaAviso = function () { var z = this.q('Aviso'); if (z) z.innerHTML = ''; };

  Insumos.prototype.pintar = function () {
    var t = this, i = function (n) { return t.id(n); };
    t.raiz.innerHTML =
      '<h2>Insumos</h2>' +
      '<div class="chips" id="' + i('Hojas') + '">' + HOJAS.map(function (h) {
        return '<button type="button" data-h="' + h.v + '"' + (t.hoja === h.v ? ' class="on"' : '') + '>' + esc(h.t) + '</button>';
      }).join('') + '</div>' +
      '<div id="' + i('Zona') + '"></div><div id="' + i('Aviso') + '"></div>';

    t.q('Hojas').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.h === t.hoja) return;
        t.hoja = b.dataset.h; t.modo = 'lista'; t.pintar();
      });
    });

    if (t.hoja === 'control') {
      t.q('Zona').innerHTML =
        '<h3 class="sub-t">CONTROL DE INSUMOS ENTREGADOS</h3>' +
        '<div class="aviso warn">Esta hoja se arma en el siguiente paso, cuando se explique cómo se usa. ' +
        'Por ahora está lista la primera: REGISTRO DE ENTREGAS C.D.S.</div>';
      return;
    }
    if (t.modo === 'form') t.verFormulario();
    else if (t.modo === 'detalle') t.verDetalle();
    else t.verLista();
  };

  /* ---------------------------------------------------------------- lista */
  Insumos.prototype.verLista = function () {
    var t = this, i = function (n) { return t.id(n); };
    var FILTROS = [
      { v: 'todas', t: 'Todas' }, { v: 'revisar', t: 'Por revisar' },
      { v: 'excel', t: 'Del Excel' }, { v: 'manual', t: 'Registradas aquí' }, { v: 'anuladas', t: 'Anuladas' }
    ];
    t.q('Zona').innerHTML =
      '<h3 class="sub-t">REGISTRO DE ENTREGAS C.D.S</h3>' +
      '<p class="sub">Lo que se le entregó a cada centro de salud o destino, insumo por insumo. ' +
        'Es un registro: no descuenta del inventario.</p>' +
      '<button type="button" class="principal" id="' + i('Nueva') + '">Registrar una entrega +</button>' +
      '<label for="' + i('Busca') + '">Buscar</label>' +
      '<input id="' + i('Busca') + '" type="search" autocomplete="off" placeholder="Centro, insumo o responsable" value="' + esc(t.busca) + '">' +
      '<div class="dos-columnas">' +
        '<div><label for="' + i('Desde') + '">Desde</label><input id="' + i('Desde') + '" type="date" value="' + esc(t.desde) + '"></div>' +
        '<div><label for="' + i('Hasta') + '">Hasta</label><input id="' + i('Hasta') + '" type="date" value="' + esc(t.hasta) + '"></div>' +
      '</div>' +
      '<div class="chips" id="' + i('Filtro') + '">' + FILTROS.map(function (f) {
        return '<button type="button" data-f="' + f.v + '"' + (t.filtro === f.v ? ' class="on"' : '') + '>' + f.t + '</button>';
      }).join('') + '</div>' +
      '<div class="barra-lista"><p class="sub conteo" id="' + i('Conteo') + '">Buscando…</p>' +
        '<div class="descargas"><button type="button" id="' + i('Excel') + '">Excel</button>' +
        '<button type="button" id="' + i('Pdf') + '">PDF</button></div></div>' +
      '<div id="' + i('Lista') + '" class="lista"></div>' +
      '<div class="botonera" id="' + i('Paginas') + '"></div>';

    var buscar = F().retardo ? F().retardo(function () { t.pagina = 0; t.buscar(); }, 300)
                             : function () { t.pagina = 0; t.buscar(); };
    t.q('Nueva').addEventListener('click', function () { t.abrirFormulario(null); });
    t.q('Busca').addEventListener('input', function () { t.busca = this.value; buscar(); });
    t.q('Desde').addEventListener('change', function () { t.desde = this.value; t.pagina = 0; t.buscar(); });
    t.q('Hasta').addEventListener('change', function () { t.hasta = this.value; t.pagina = 0; t.buscar(); });
    t.q('Filtro').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        t.filtro = b.dataset.f; t.pagina = 0;
        t.q('Filtro').querySelectorAll('button').forEach(function (o) { o.classList.toggle('on', o === b); });
        t.buscar();
      });
    });
    t.q('Excel').addEventListener('click', function () { t.descargar('excel', this); });
    t.q('Pdf').addEventListener('click', function () { t.descargar('pdf', this); });
    t.buscar();
  };

  Insumos.prototype.consulta = function (conConteo) {
    var t = this;
    var qy = t.sb.from('v_insumos_entregas_cds').select('*', conConteo ? { count: 'exact' } : undefined);
    if (t.filtro === 'anuladas') qy = qy.eq('anulada', true);
    else qy = qy.eq('anulada', false);
    if (t.filtro === 'revisar') qy = qy.gt('por_revisar', 0);
    if (t.filtro === 'excel') qy = qy.eq('origen', 'excel');
    if (t.filtro === 'manual') qy = qy.eq('origen', 'manual');
    if (t.desde) qy = qy.gte('fecha', t.desde);
    if (t.hasta) qy = qy.lte('fecha', t.hasta);
    var palabras = F().sinAcentos(t.busca).toUpperCase().split(' ').filter(Boolean);
    palabras.forEach(function (p) { qy = qy.ilike('busqueda', '%' + p.replace(/[%_]/g, '') + '%'); });
    return qy.order('fecha', { ascending: false }).order('creado_en', { ascending: false });
  };

  Insumos.prototype.buscar = function () {
    var t = this;
    var mio = ++t.pedido;
    var desde = t.pagina * POR_PAGINA;
    t.consulta(true).range(desde, desde + POR_PAGINA - 1).then(function (r) {
      if (mio !== t.pedido || !t.q('Lista')) return;
      if (r.error) { t.q('Conteo').textContent = ''; t.aviso('bad', 'No se pudo cargar: ' + F().traduceError(r.error)); return; }
      t.filas = r.data || []; t.total = r.count || 0;
      t.pintarLista();
    });
  };

  Insumos.prototype.pintarLista = function () {
    var t = this;
    var z = t.q('Lista');
    t.q('Conteo').textContent = t.total === 1 ? '1 entrega' : num(t.total) + ' entregas';
    if (!t.filas.length) {
      z.innerHTML = '<p class="sub">No hay entregas con esa búsqueda.</p>';
    } else {
      z.innerHTML = t.filas.map(function (e) {
        var cant = e.suma_cantidades != null ? num(e.suma_cantidades) + ' unidades'
                 : e.cantidad_total_excel != null ? num(e.cantidad_total_excel) + ' unidades en total (Excel)' : 'sin cantidad';
        var chips = (e.origen === 'excel' ? ' <span class="sit gris">Del Excel</span>' : '') +
                    (e.por_revisar ? ' <span class="sit ojo">' + e.por_revisar + ' por revisar</span>' : '') +
                    (e.anulada ? ' <span class="sit mal">Anulada</span>' : '');
        return '<button type="button" class="item" data-id="' + esc(e.id) + '">' +
          '<b>' + esc(F().muestraFecha(e.fecha)) + ' · ' + esc(e.destino || 'Destino no consta') + chips + '</b>' +
          '<span>' + e.insumos + (e.insumos === 1 ? ' insumo' : ' insumos') + ' · ' + cant +
          ' · Recibió: ' + esc(e.recibido_por || 'no consta') + '</span></button>';
      }).join('');
      z.querySelectorAll('[data-id]').forEach(function (b) {
        b.addEventListener('click', function () {
          t.actual = t.filas.filter(function (x) { return x.id === b.dataset.id; })[0];
          t.modo = 'detalle'; t.pintar();
        });
      });
    }
    var pags = Math.ceil(t.total / POR_PAGINA);
    var p = t.q('Paginas');
    p.innerHTML = pags > 1
      ? '<button type="button" class="secundario" data-p="-1"' + (t.pagina === 0 ? ' disabled' : '') + '>← Anteriores</button>' +
        '<span class="sub" style="align-self:center">Página ' + (t.pagina + 1) + ' de ' + pags + '</span>' +
        '<button type="button" class="secundario" data-p="1"' + (t.pagina + 1 >= pags ? ' disabled' : '') + '>Siguientes →</button>'
      : '';
    p.querySelectorAll('[data-p]').forEach(function (b) {
      b.addEventListener('click', function () { t.pagina += Number(b.dataset.p); t.buscar(); });
    });
  };

  Insumos.prototype.descargar = function (cual, boton) {
    var t = this;
    var R = raiz.FARMREP;
    if (!R) { t.aviso('bad', 'Todavía se está cargando el generador de reportes. Inténtalo en unos segundos.'); return; }
    var txt = boton.textContent;
    boton.disabled = true; boton.textContent = 'Preparando…';
    var todas = [];
    (function tanda(desde) {
      t.consulta(false).range(desde, desde + 999).then(function (r) {
        if (r.error) {
          boton.disabled = false; boton.textContent = txt;
          t.aviso('bad', 'No se pudo preparar el reporte: ' + F().traduceError(r.error)); return;
        }
        todas = todas.concat(r.data || []);
        if ((r.data || []).length === 1000 && todas.length < 20000) return tanda(desde + 1000);
        boton.disabled = false; boton.textContent = txt;
        var filas = filasReporte(todas);
        var sub = todas.length + ' entrega(s), ' + filas.length + ' renglón(es) de insumos' +
          (t.desde || t.hasta ? ' · ' + (t.desde ? 'desde ' + F().muestraFecha(t.desde) : '') + (t.hasta ? ' hasta ' + F().muestraFecha(t.hasta) : '') : '');
        if (cual === 'excel') {
          R.excel('Insumos - Registro de entregas CDS', [{
            nombre: 'REGISTRO DE ENTREGAS C.D.S', titulo: 'REGISTRO DE ENTREGAS C.D.S — ' + sub,
            encabezados: ENCABEZADOS, filas: filas, anchos: [12, 32, 44, 12, 30, 16, 40]
          }]);
        } else {
          R.pdfTabla({
            titulo: 'REGISTRO DE ENTREGAS C.D.S', subtitulo: sub, horizontal: true,
            archivo: 'Insumos - Registro de entregas CDS',
            encabezados: ENCABEZADOS,
            filas: filas.map(function (f) { return f.map(function (c) { return typeof c === 'number' ? num(c) : c; }); }),
            columnas: { 0: { cellWidth: 20 }, 1: { cellWidth: 40 }, 2: { cellWidth: 62 }, 3: { cellWidth: 20, halign: 'right' },
                        4: { cellWidth: 38 }, 5: { cellWidth: 26, halign: 'right' }, 6: { cellWidth: 45 } }
          });
        }
      });
    })(0);
  };

  /* -------------------------------------------------------------- detalle */
  Insumos.prototype.verDetalle = function () {
    var t = this, i = function (n) { return t.id(n); }, e = t.actual;
    if (!e) { t.modo = 'lista'; t.pintar(); return; }
    var items = e.items || [];
    var total = e.suma_cantidades != null ? e.suma_cantidades : null;
    t.q('Zona').innerHTML =
      '<button type="button" class="volver" id="' + i('Volver') + '">← Volver a la lista</button>' +
      '<h3 class="sub-t">Entrega del ' + esc(F().muestraFecha(e.fecha)) + '</h3>' +
      (e.anulada ? '<div class="aviso bad"><b>Anulada</b><span>' + esc(e.anulada_motivo || '') + '</span></div>' : '') +
      '<div class="renglones">' +
        dato('Fecha', F().muestraFecha(e.fecha)) +
        dato('Centro de Salud / Destino', e.destino || 'No consta en el Excel') +
        (e.departamento ? dato('Departamento / Servicio', e.departamento) : '') +
        dato('Recibido Por (Responsable)', e.recibido_por || 'No consta en el Excel') +
        dato('Registrada', e.origen === 'excel' ? 'Cargada del Excel (fila ' + e.fila_excel + ')'
                                                : 'Aquí' + (e.registrado_por_nombre ? ', por ' + e.registrado_por_nombre : '')) +
      '</div>' +
      '<h3 class="sub-t">Descripción del Insumo</h3>' +
      (items.length
        ? '<div class="tabla-caja"><table class="tabla"><thead><tr><th>#</th><th>Descripción del Insumo</th>' +
          '<th class="num">Cantidad Entregada</th></tr></thead><tbody>' +
          items.map(function (it, k) {
            return '<tr><td>' + (k + 1) + '</td><td>' + esc(it.descripcion) +
              (it.revisar ? ' <span class="sit ojo" title="' + esc(it.revisar_motivo || '') + '">Revisar</span>' +
                            '<span class="chico" style="display:block;font-size:11.5px;color:var(--warn-ink)">' + esc(it.revisar_motivo || '') + '</span>' : '') +
              '</td><td class="num">' + (it.cantidad == null ? '—' : num(it.cantidad)) + '</td></tr>';
          }).join('') +
          (total != null ? '<tr><td></td><td><b>Total</b></td><td class="num"><b>' + num(total) + '</b></td></tr>' : '') +
          '</tbody></table></div>'
        : '<p class="sub">El Excel no anota insumos en este renglón.</p>') +
      (e.origen === 'excel' && e.cantidad_total_excel != null
        ? '<div class="aviso warn"><b>Cantidad Entregada: ' + num(e.cantidad_total_excel) + ' en total</b>' +
          '<span>Así la anota el Excel: una sola cantidad para todos los insumos de este renglón. No se reparte entre ellos ' +
          'porque sería inventar números. Si sabes cuánto fue de cada uno, usa «Corregir».</span></div>' : '') +
      (e.texto_original ? '<details style="margin-top:12px"><summary class="sub">Cómo venía escrito en el Excel</summary>' +
        '<p class="sub" style="overflow-wrap:anywhere">' + esc(e.texto_original) + '</p></details>' : '') +
      (e.anulada ? '' :
        '<div class="botonera"><button type="button" class="secundario" id="' + i('Corregir') + '">Corregir</button>' +
        '<button type="button" class="secundario" id="' + i('Anular') + '" hidden>Anular</button></div>' +
        '<div id="' + i('CajaAnular') + '" hidden><label for="' + i('Motivo') + '">¿Por qué se anula?</label>' +
        '<input id="' + i('Motivo') + '" type="text" autocomplete="off" placeholder="Ej: se registró dos veces">' +
        '<button type="button" class="principal" id="' + i('ConfirmaAnular') + '">Anular esta entrega</button></div>');

    t.q('Volver').addEventListener('click', function () { t.modo = 'lista'; t.pintar(); });
    if (e.anulada) return;
    t.q('Corregir').addEventListener('click', function () { t.abrirFormulario(e); });
    if (t.esAdmin) t.q('Anular').hidden = false;
    t.q('Anular').addEventListener('click', function () { t.q('CajaAnular').hidden = false; t.q('Motivo').focus(); });
    t.q('ConfirmaAnular').addEventListener('click', function () {
      var motivo = t.q('Motivo').value.trim();
      if (motivo.length < 5) { t.aviso('warn', 'Escribe por qué se anula (al menos 5 letras).'); return; }
      var b = this; b.disabled = true; b.textContent = 'Anulando…';
      t.sb.rpc('insumos_cds_anular', { p_id: e.id, p_motivo: motivo }).then(function (r) {
        b.disabled = false; b.textContent = 'Anular esta entrega';
        if (r.error || r.data !== true) { t.aviso('bad', 'No se anuló: ' + F().traduceError(r.error || 'la entrega ya no estaba activa')); return; }
        t.modo = 'lista'; t.pintar();
        t.aviso('ok', 'La entrega quedó anulada. Se puede ver en el filtro «Anuladas».');
      });
    });
  };

  function dato(rotulo, valor) {
    return '<div class="renglon"><div class="que"><span>' + esc(rotulo) + '</span><b>' + esc(valor) + '</b></div></div>';
  }

  /* ----------------------------------------------------------- formulario */
  Insumos.prototype.abrirFormulario = function (e) {
    var t = this;
    t.actual = e;
    t.items = e && e.items && e.items.length
      ? e.items.map(function (it) {
          return { descripcion: it.descripcion, cantidad: it.cantidad == null ? '' : String(it.cantidad).replace('.', ','),
                   revisar: it.revisar, revisar_motivo: it.revisar_motivo };
        })
      : [{ descripcion: '', cantidad: '' }];
    t.modo = 'form'; t.pintar();
  };

  Insumos.prototype.verFormulario = function () {
    var t = this, i = function (n) { return t.id(n); }, e = t.actual;
    var hoy = F().hoyCaracas();
    var deExcel = !!(e && e.origen === 'excel');
    t.q('Zona').innerHTML =
      '<button type="button" class="volver" id="' + i('Volver') + '">← Volver' + (e ? ' a la entrega' : ' a la lista') + '</button>' +
      '<h3 class="sub-t">' + (e ? 'Corregir la entrega' : 'Registrar una entrega') + '</h3>' +
      (deExcel ? '<div class="aviso warn">Esta entrega vino del Excel. Puedes separar o corregir sus insumos y ponerles ' +
                 'cantidad si la sabes; si no, déjala vacía.</div>' : '') +
      '<label for="' + i('Fecha') + '">Fecha</label>' +
      '<input id="' + i('Fecha') + '" type="date" max="' + esc(hoy) + '" value="' + esc(e ? e.fecha : hoy) + '">' +
      '<label for="' + i('Destino') + '">Centro de Salud / Destino</label>' +
      '<input id="' + i('Destino') + '" type="text" autocomplete="off" list="' + i('Destinos') + '" ' +
        'placeholder="Ej: CDI MAMA PANCHA" value="' + esc(e ? e.destino || '' : '') + '">' +
      '<datalist id="' + i('Destinos') + '">' + t.destinos.map(function (d) { return '<option value="' + esc(d) + '">'; }).join('') + '</datalist>' +
      '<label for="' + i('Recibe') + '">Recibido Por (Responsable)</label>' +
      '<input id="' + i('Recibe') + '" type="text" autocomplete="off" placeholder="Nombre de quien lo recibió" value="' + esc(e ? e.recibido_por || '' : '') + '">' +
      '<h3 class="sub-t">Descripción del Insumo</h3>' +
      '<p class="sub">Un insumo por renglón, con su cantidad entregada.</p>' +
      '<div class="insumo-fila insumo-cabeza" aria-hidden="true"><span>INSUMO</span><span>CANT</span><span></span></div>' +
      '<div id="' + i('Items') + '" class="insumo-filas"></div>' +
      '<button type="button" class="secundario insumo-agregar" id="' + i('Agregar') + '">Agregar +</button>' +
      '<p class="sub" id="' + i('Total') + '"></p>' +
      '<button type="button" class="principal" id="' + i('Guardar') + '">' + (e ? 'Guardar la corrección' : 'Guardar la entrega') + '</button>';

    t.pintarItems();
    t.q('Agregar').addEventListener('click', function () {
      t.items.push({ descripcion: '', cantidad: '' });
      t.pintarItems();
      var cajas = t.q('Items').querySelectorAll('[data-desc]');
      if (cajas.length) cajas[cajas.length - 1].focus();
    });
    t.q('Volver').addEventListener('click', function () { t.modo = e ? 'detalle' : 'lista'; t.pintar(); });
    t.q('Guardar').addEventListener('click', function () { t.guardar(); });
  };

  Insumos.prototype.pintarItems = function () {
    var t = this;
    var z = t.q('Items');
    z.innerHTML = t.items.map(function (it, k) {
      return '<div class="insumo-fila">' +
        '<input type="text" autocomplete="off" data-desc="' + k + '" aria-label="Insumo ' + (k + 1) + '" ' +
          'placeholder="Ej: ACETAMINOFEN 500MG" value="' + esc(it.descripcion) + '">' +
        '<input type="text" inputmode="decimal" autocomplete="off" data-cant="' + k + '" aria-label="Cantidad del insumo ' + (k + 1) + '" ' +
          'placeholder="CANT" value="' + esc(it.cantidad) + '">' +
        '<button type="button" class="quitar" data-quitar="' + k + '" aria-label="Quitar el insumo ' + (k + 1) + '">✕</button>' +
        (it.revisar ? '<span class="insumo-revisar">Revisar: ' + esc(it.revisar_motivo || '') + '</span>' : '') +
      '</div>';
    }).join('');
    z.querySelectorAll('[data-desc]').forEach(function (c) {
      c.addEventListener('input', function () {
        var it = t.items[+c.dataset.desc];
        it.descripcion = c.value;
        if (it.revisar) { it.revisar = false; it.revisar_motivo = null; }   // una persona ya lo miró y lo tocó
        t.pintarTotal();
      });
    });
    z.querySelectorAll('[data-cant]').forEach(function (c) {
      c.addEventListener('input', function () { t.items[+c.dataset.cant].cantidad = c.value; t.pintarTotal(); });
    });
    z.querySelectorAll('[data-quitar]').forEach(function (b) {
      b.addEventListener('click', function () {
        t.items.splice(+b.dataset.quitar, 1);
        if (!t.items.length) t.items.push({ descripcion: '', cantidad: '' });
        t.pintarItems();
      });
    });
    t.pintarTotal();
  };

  Insumos.prototype.pintarTotal = function () {
    var t = this;
    var llenos = t.items.filter(function (it) { return String(it.descripcion || '').trim(); }).length;
    var s = sumaCantidades(t.items);
    t.q('Total').textContent = llenos + (llenos === 1 ? ' insumo' : ' insumos') + (s != null ? ' · ' + num(s) + ' unidades en total' : '');
  };

  Insumos.prototype.guardar = function () {
    var t = this, e = t.actual;
    t.limpiaAviso();
    var rev = revisaFormulario({
      fecha: t.q('Fecha').value, destino: t.q('Destino').value, recibido_por: t.q('Recibe').value, items: t.items
    }, F().hoyCaracas(), !(e && e.origen === 'excel'));
    if (rev.error) { t.aviso('warn', rev.error); return; }

    var b = t.q('Guardar'), txt = b.textContent;
    b.disabled = true; b.textContent = 'Guardando…';
    t.sb.rpc('insumos_cds_guardar', { p_id: e ? e.id : null, p_datos: rev.datos }).then(function (r) {
      if (r.error || !r.data) {
        b.disabled = false; b.textContent = txt;
        // Nunca se dice "guardado" si el servidor no lo confirmó.
        t.aviso('bad', 'No se guardó: ' + F().traduceError(r.error || 'el servidor no confirmó'));
        return;
      }
      /* Se vuelve a leer de la base lo que quedó, para mostrar lo guardado de verdad. */
      t.sb.from('v_insumos_entregas_cds').select('*').eq('id', r.data).single().then(function (v) {
        t.cargarDestinos();
        if (v.error || !v.data) { t.modo = 'lista'; t.pintar(); t.aviso('ok', 'Guardado.'); return; }
        t.actual = v.data; t.modo = 'detalle'; t.pintar();
        t.aviso('ok', (e ? 'La corrección quedó guardada: ' : 'La entrega quedó guardada: ') +
          v.data.insumos + (v.data.insumos === 1 ? ' insumo' : ' insumos') + ' para ' + (v.data.destino || 'el destino') + '.');
      });
    });
  };

  Insumos.prototype.cargarDestinos = function () {
    var t = this;
    Promise.all([
      t.sb.from('instituciones').select('nombre').order('nombre'),
      t.sb.from('insumos_entregas_cds').select('destino').not('destino', 'is', null).limit(2000)
    ]).then(function (r) {
      var vistos = {}, lista = [];
      [].concat((r[0].data || []).map(function (x) { return x.nombre; }), (r[1].data || []).map(function (x) { return x.destino; }))
        .forEach(function (n) {
          var k = F().sinAcentos(n);
          if (n && !vistos[k]) { vistos[k] = 1; lista.push(String(n).trim()); }
        });
      t.destinos = lista.sort();
    });
  };

  raiz.PANTALLA_INSUMOS = function (cliente, contenedor, opciones) {
    var t = new Insumos(cliente, contenedor, (opciones && opciones.prefijo) || 'in');
    t.cargarDestinos();
    cliente.rpc('mi_rol').then(function (r) {
      t.esAdmin = !r.error && r.data === 'admin';
      var b = t.q('Anular');
      if (b && t.esAdmin) b.hidden = false;
    });
    t.pintar();
    return t;
  };
})(typeof window !== 'undefined' ? window : globalThis);
