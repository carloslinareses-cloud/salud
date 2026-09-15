/* INSUMOS — lo que se le entrega a cada centro de salud, destino o persona.

   Dos hojas del Excel de insumos, en la misma pantalla:

   1) "REGISTRO DE ENTREGAS C.D.S" — a qué centro/destino, con insumo
      por insumo y SU cantidad. El Excel trae UNA cantidad para todos
      los insumos del renglón: se guarda sin repartirla.

   2) "CONTROL DE INSUMOS ENTREGADOS" — a qué persona, con categoría,
      Total Entregado del Excel (sin desglose), última entrega, estado
      de inventario y observación. Cada insumo va en su renglón.

   Ambas hojas tienen balance por trimestre (ENERO A MARZO, ABRIL A
   JUNIO, JULIO A SEPTIEMBRE, OCTUBRE A DICIEMBRE) e informe en Excel
   y PDF.

   Es un REGISTRO: no descuenta del inventario. Escritura solo por
   funciones security definer (inventario y admin). */
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

  /* ---------------------------------------------------------------
     CONTROL (hoja 2): formulario y reportes
  --------------------------------------------------------------- */

  /* Revisa el formulario de CONTROL DE INSUMOS ENTREGADOS.
     `exigeCantidad` es falso al corregir algo que vino del Excel. */
  function revisaFormularioControl(f, hoy, exigeCantidad) {
    var fecha = String(f.fecha || '').trim();
    var persona = String(f.persona || '').replace(/\s+/g, ' ').trim();
    if (exigeCantidad) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: 'Falta la fecha.' };
      if (hoy && fecha > hoy) return { error: 'La fecha no puede ser futura.' };
      if (persona.length < 3) return { error: 'Escribe el nombre y apellido de la persona.' };
    } else if (fecha && (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || (hoy && fecha > hoy))) {
      return { error: 'La fecha no es válida.' };
    }

    var items = [];
    var filas = f.items || [];
    for (var i = 0; i < filas.length; i++) {
      var it = filas[i] || {};
      var desc = F().normalizaInsumo(it.descripcion);
      var c = leeCantidad(it.cantidad);
      if (!desc && c.valor == null && !c.error) continue;
      var n = items.length + 1;
      if (desc.length < 2) return { error: 'Al insumo número ' + n + ' le falta la descripción.' };
      if (c.error) return { error: desc + ': ' + c.error };
      if (c.valor == null && exigeCantidad) return { error: 'Falta la cantidad de ' + desc + '.' };
      items.push({
        descripcion: desc, cantidad: c.valor,
        revisar: !!it.revisar, revisar_motivo: it.revisar ? (it.revisar_motivo || null) : null
      });
    }
    if (!items.length) return { error: 'Agrega al menos un insumo.' };
    return {
      datos: {
        fecha: fecha || null,
        persona: persona || null,
        categoria: String(f.categoria || '').replace(/\s+/g, ' ').trim() || null,
        observacion: String(f.observacion || '').replace(/\s+/g, ' ').trim() || null,
        estado_inventario: String(f.estado_inventario || '').replace(/\s+/g, ' ').trim() || null,
        ultima_entrega: String(f.ultima_entrega || '').trim() || null,
        items: items
      }
    };
  }

  /* Una fila de Excel/PDF por INSUMO de la hoja control. */
  var ENCABEZADOS_CONTROL = ['Fecha', 'Nombre y Apellido', 'Descripción del Insumo / Medicamento',
    'Categoría / Tipo', 'Cantidad', 'Total Entregado (Excel, sin desglose)',
    'Última Entrega', 'Estado Inventario', 'Observación'];

  function filasReporteControl(entregas) {
    var filas = [];
    (entregas || []).forEach(function (e) {
      var items = e.items && e.items.length ? e.items : [{ descripcion: '', cantidad: null }];
      items.forEach(function (it, k) {
        var obs = [];
        if (e.observacion) obs.push(e.observacion);
        if (it.revisar) obs.push('Por revisar: ' + (it.revisar_motivo || ''));
        if (e.revisar) obs.push('Registro por revisar: ' + (e.revisar_motivo || ''));
        if (!e.items || !e.items.length) obs.push('El Excel no anota insumos en este renglón');
        if (e.fecha_texto && !e.fecha) obs.push('Fecha original: ' + e.fecha_texto);
        filas.push([
          e.fecha ? F().muestraFecha(e.fecha) : (e.fecha_texto || 'Sin fecha'),
          e.persona || 'No consta',
          it.descripcion || '',
          e.categoria || '',
          it.cantidad == null ? '' : Number(it.cantidad),
          k === 0 && e.total_entregado_excel != null ? Number(e.total_entregado_excel) : '',
          e.ultima_entrega ? F().muestraFecha(e.ultima_entrega) : (e.ultima_entrega_texto || ''),
          e.estado_inventario || '',
          obs.join(' · ')
        ]);
      });
    });
    return filas;
  }

  /* ---------------------------------------------------------------
     Trimestres (para las DOS hojas)
  --------------------------------------------------------------- */
  function trimestreDe(iso) {
    if (!iso) return null;
    var p = String(iso).slice(0, 10).split('-');
    if (p.length !== 3) return null;
    var anio = +p[0], mes = +p[1];
    if (!anio || mes < 1 || mes > 12) return null;
    var nombre, inicioMes, finMes;
    if (mes <= 3) { nombre = 'ENERO A MARZO'; inicioMes = 1; finMes = 3; }
    else if (mes <= 6) { nombre = 'ABRIL A JUNIO'; inicioMes = 4; finMes = 6; }
    else if (mes <= 9) { nombre = 'JULIO A SEPTIEMBRE'; inicioMes = 7; finMes = 9; }
    else { nombre = 'OCTUBRE A DICIEMBRE'; inicioMes = 10; finMes = 12; }
    function dos(n) { return String(n).padStart(2, '0'); }
    return {
      clave: anio + '-T' + Math.ceil(mes / 3),
      nombre: nombre + ' ' + anio,
      anio: anio,
      inicio: anio + '-' + dos(inicioMes) + '-01',
      fin: anio + '-' + dos(finMes) + '-' + dos(new Date(Date.UTC(anio, finMes, 0)).getUTCDate())
    };
  }

  /* Agrupa entregas por trimestre y arma el balance general.
     `hoja` es 'registro' o 'control'. */
  function armaBalance(entregas, hoja) {
    var grupos = [], por = {};
    var sinFecha = { entregas: 0, unidadesConCantidad: 0, totalesExcel: 0, porRevisar: 0, claves: {}, categorias: {}, personas: {} };
    (entregas || []).forEach(function (e) {
      var t = trimestreDe(e.fecha);
      var g;
      if (!t) {
        g = sinFecha;
      } else {
        g = por[t.clave];
        if (!g) {
          g = por[t.clave] = {
            clave: t.clave, nombre: t.nombre, anio: t.anio, inicio: t.inicio, fin: t.fin,
            entregas: 0, unidadesConCantidad: 0, totalesExcel: 0, porRevisar: 0,
            claves: {}, categorias: {}, personas: {}
          };
          grupos.push(g);
        }
      }
      g.entregas++;
      /* Personas distintas: solo se cuentan (nunca se listan). */
      if (hoja === 'control' && e.persona) {
        g.personas[String(e.persona).normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim().toUpperCase()] = 1;
      }
      if (e.suma_cantidades != null) g.unidadesConCantidad += Number(e.suma_cantidades);
      var tot = hoja === 'control' ? e.total_entregado_excel : e.cantidad_total_excel;
      if (tot != null) g.totalesExcel += Number(tot);
      var rev = (e.por_revisar || 0) + (e.revisar ? 1 : 0) + (e.insumos === 0 ? 1 : 0);
      if (hoja === 'registro' && !e.destino) rev++;
      g.porRevisar += rev;
      var grupoDestino = hoja === 'control' ? (e.categoria || 'Sin categoría') : (e.destino || 'Sin destino');
      g.claves[grupoDestino] = (g.claves[grupoDestino] || 0) + 1;
      (e.items || []).forEach(function (it) {
        if (it.revisar) return;
        var d = it.descripcion;
        if (!d) return;
        if (hoja === 'control') {
          g.categorias[d] = (g.categorias[d] || 0) + 1;
        } else {
          g.categorias[d] = (g.categorias[d] || 0) + 1;
        }
      });
    });
    grupos.sort(function (a, b) {
      if (a.anio !== b.anio) return a.anio - b.anio;
      return a.inicio < b.inicio ? -1 : 1;
    });
    function top(obj, n) {
      return Object.keys(obj).map(function (k) { return { clave: k, veces: obj[k] }; })
        .sort(function (a, b) { return b.veces - a.veces || a.clave.localeCompare(b.clave); })
        .slice(0, n || 8);
    }
    return {
      trimestres: grupos.map(function (g) {
        return {
          clave: g.clave, nombre: g.nombre, anio: g.anio, inicio: g.inicio, fin: g.fin,
          entregas: g.entregas,
          personas: Object.keys(g.personas).length,
          unidadesConCantidad: g.unidadesConCantidad,
          totalesExcel: g.totalesExcel,
          porRevisar: g.porRevisar,
          porGrupo: top(g.claves, 20),
          masEntregados: top(g.categorias, 10)
        };
      }),
      sinFecha: sinFecha.entregas ? {
        entregas: sinFecha.entregas,
        personas: Object.keys(sinFecha.personas).length,
        unidadesConCantidad: sinFecha.unidadesConCantidad,
        totalesExcel: sinFecha.totalesExcel,
        porRevisar: sinFecha.porRevisar
      } : null
    };
  }

  var ENCABEZADOS_BALANCE = ['Trimestre', 'Entregas', 'Personas distintas', 'Unidades con cantidad',
    'Totales del Excel (sin desglose)', 'Por revisar', 'Grupo principal', 'Insumo más entregado'];

  function filasBalance(bal, hoja) {
    var filas = [];
    (bal.trimestres || []).forEach(function (t) {
      var grupo = t.porGrupo && t.porGrupo[0] ? t.porGrupo[0].clave + ' (' + t.porGrupo[0].veces + ')' : '';
      var mas = t.masEntregados && t.masEntregados[0]
        ? t.masEntregados[0].clave + ' (' + t.masEntregados[0].veces + ')' : '';
      filas.push([t.nombre, t.entregas, hoja === 'control' ? t.personas : '', t.unidadesConCantidad, t.totalesExcel, t.porRevisar, grupo, mas]);
    });
    if (bal.sinFecha) {
      filas.push(['Sin fecha válida', bal.sinFecha.entregas, hoja === 'control' ? bal.sinFecha.personas : '', bal.sinFecha.unidadesConCantidad,
                  bal.sinFecha.totalesExcel, bal.sinFecha.porRevisar, '', '']);
    }
    return filas;
  }

  var LOGICA = {
    leeCantidad: leeCantidad, revisaFormulario: revisaFormulario, sumaCantidades: sumaCantidades,
    filasReporte: filasReporte, ENCABEZADOS: ENCABEZADOS, HOJAS: HOJAS,
    revisaFormularioControl: revisaFormularioControl,
    filasReporteControl: filasReporteControl, ENCABEZADOS_CONTROL: ENCABEZADOS_CONTROL,
    trimestreDe: trimestreDe, armaBalance: armaBalance,
    filasBalance: filasBalance, ENCABEZADOS_BALANCE: ENCABEZADOS_BALANCE
  };
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
    this.trimestre = 'todo';
    this.pagina = 0; this.total = 0; this.filas = []; this.pedido = 0;
    this.actual = null;               // la entrega abierta (detalle o corrección)
    this.items = [];                  // los renglones del formulario
    this.esAdmin = false;
    this.destinos = [];
    this.ultimoBalance = null;
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
      if (t.modo === 'form') t.verFormularioControl();
      else if (t.modo === 'detalle') t.verDetalleControl();
      else t.verListaControl();
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
      '<div id="' + i('Dudas') + '"></div>' +
      '<button type="button" class="principal" id="' + i('Nueva') + '">Registrar una entrega +</button>' +
      '<label for="' + i('Busca') + '">Buscar</label>' +
      '<input id="' + i('Busca') + '" type="search" autocomplete="off" placeholder="Centro, insumo o responsable" value="' + esc(t.busca) + '">' +
      '<div class="dos-columnas">' +
        '<div><label for="' + i('Desde') + '">Desde</label><input id="' + i('Desde') + '" type="date" value="' + esc(t.desde) + '"></div>' +
        '<div><label for="' + i('Hasta') + '">Hasta</label><input id="' + i('Hasta') + '" type="date" value="' + esc(t.hasta) + '"></div>' +
      '</div>' +
      '<div class="chips" id="' + i('Trimestre') + '"></div>' +
      '<div class="chips" id="' + i('Filtro') + '">' + FILTROS.map(function (f) {
        return '<button type="button" data-f="' + f.v + '"' + (t.filtro === f.v ? ' class="on"' : '') + '>' + f.t + '</button>';
      }).join('') + '</div>' +
      '<div class="barra-lista"><p class="sub conteo" id="' + i('Conteo') + '">Buscando…</p>' +
        '<div class="descargas"><button type="button" id="' + i('Balance') + '">Balance</button>' +
        '<button type="button" id="' + i('Excel') + '">Excel</button>' +
        '<button type="button" id="' + i('Pdf') + '">PDF</button></div></div>' +
      '<div id="' + i('BalanceZona') + '"></div>' +
      '<div id="' + i('Lista') + '" class="lista"></div>' +
      '<div class="botonera" id="' + i('Paginas') + '"></div>';

    var buscar = F().retardo ? F().retardo(function () { t.pagina = 0; t.buscar(); }, 300)
                             : function () { t.pagina = 0; t.buscar(); };
    t.q('Nueva').addEventListener('click', function () { t.abrirFormulario(null); });
    t.q('Busca').addEventListener('input', function () { t.busca = this.value; buscar(); });
    t.q('Desde').addEventListener('change', function () { t.desde = this.value; t.pagina = 0; t.buscar(); });
    t.q('Hasta').addEventListener('change', function () { t.hasta = this.value; t.pagina = 0; t.buscar(); });
    t.pintarChipsTrimestre(function () { t.pagina = 0; t.buscar(); });
    t.q('Filtro').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        t.filtro = b.dataset.f; t.pagina = 0;
        t.q('Filtro').querySelectorAll('button').forEach(function (o) { o.classList.toggle('on', o === b); });
        t.buscar();
      });
    });
    t.q('Balance').addEventListener('click', function () { t.verBalance('registro'); });
    t.q('Excel').addEventListener('click', function () { t.descargar('excel', this); });
    t.q('Pdf').addEventListener('click', function () { t.descargar('pdf', this); });
    t.buscar();
    t.cargarDudas();
  };

  /* LAS DUDAS DEL EXCEL, para que inventario las revise a mano.
     Son los insumos marcados "revisar" (cada uno con su pregunta) y las
     entregas del Excel que llegaron incompletas (sin insumos o sin destino).
     Se van quitando solas a medida que se corrigen. */
  Insumos.prototype.cargarDudas = function () {
    var t = this;
    Promise.all([
      t.sb.from('insumos_entregas_cds_items')
        .select('id, descripcion, revisar_motivo, entrega_id, insumos_entregas_cds!inner(fecha, destino, anulada)')
        .eq('revisar', true).eq('insumos_entregas_cds.anulada', false),
      t.sb.from('v_insumos_entregas_cds').select('id, fecha, destino, insumos')
        .eq('anulada', false).or('insumos.eq.0,destino.is.null')
    ]).then(function (r) {
      var z = t.q('Dudas');
      if (!z) return;
      if (r[0].error || r[1].error) { z.innerHTML = ''; return; }
      var dudas = (r[0].data || []).map(function (x) {
        var e = x.insumos_entregas_cds || {};
        return { entrega: x.entrega_id, fecha: e.fecha, destino: e.destino, texto: x.descripcion, pregunta: x.revisar_motivo || 'Revisar este insumo' };
      }).concat((r[1].data || []).map(function (e) {
        return { entrega: e.id, fecha: e.fecha, destino: e.destino, texto: e.insumos ? '' : '(sin insumos)',
                 pregunta: !e.insumos ? 'El Excel no dice qué se entregó ni cuánto. ¿Qué se entregó?' : 'El Excel no dice a qué centro o destino fue.' };
      }));
      dudas.sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); });
      if (!dudas.length) { z.innerHTML = ''; return; }
      z.innerHTML =
        '<div class="aviso warn dudas-caja"><b>Dudas del Excel para revisar: ' + dudas.length + '</b>' +
        '<span>Estos datos vinieron del Excel y no se entiende qué quisieron poner. Abre cada uno, míralo y ' +
        'corrígelo con «Corregir» (separar, cambiar el nombre, poner el destino…). Si ya está bien como vino, ' +
        'toca «Está bien así». Cada duda desaparece de aquí cuando se resuelve.</span>' +
        '<div class="renglones">' + dudas.map(function (d) {
          return '<div class="renglon"><div class="que">' +
            '<b>' + esc(F().muestraFecha(d.fecha)) + ' · ' + esc(d.destino || 'Destino no consta') + (d.texto ? ' · ' + esc(d.texto) : '') + '</b>' +
            '<span>' + esc(d.pregunta) + '</span></div>' +
            '<button type="button" class="quitar" data-duda="' + esc(d.entrega) + '">Revisar</button></div>';
        }).join('') + '</div></div>';
      z.querySelectorAll('[data-duda]').forEach(function (b) {
        b.addEventListener('click', function () {
          b.disabled = true;
          t.sb.from('v_insumos_entregas_cds').select('*').eq('id', b.dataset.duda).single().then(function (v) {
            b.disabled = false;
            if (v.error || !v.data) { t.aviso('bad', 'No se pudo abrir: ' + F().traduceError(v.error || 'no encontrada')); return; }
            t.actual = v.data; t.modo = 'detalle'; t.pintar();
          });
        });
      });
    });
  };

  Insumos.prototype.consulta = function (conConteo) {
    var t = this;
    var qy = t.sb.from('v_insumos_entregas_cds').select('*', conConteo ? { count: 'exact' } : undefined);
    if (t.filtro === 'anuladas') qy = qy.eq('anulada', true);
    else qy = qy.eq('anulada', false);
    if (t.filtro === 'revisar') qy = qy.or('por_revisar.gt.0,insumos.eq.0,destino.is.null');
    if (t.filtro === 'excel') qy = qy.eq('origen', 'excel');
    if (t.filtro === 'manual') qy = qy.eq('origen', 'manual');
    if (t.desde) qy = qy.gte('fecha', t.desde);
    if (t.hasta) qy = qy.lte('fecha', t.hasta);
    if (t.trimestre && t.trimestre !== 'todo') {
      var p = t.trimestre.split('-T');
      var anio = +p[0], tq = +p[1];
      var ini = anio + '-' + String((tq - 1) * 3 + 1).padStart(2, '0') + '-01';
      var mesFin = tq * 3;
      var fin = anio + '-' + String(mesFin).padStart(2, '0') + '-' +
                String(new Date(Date.UTC(anio, mesFin, 0)).getUTCDate()).padStart(2, '0');
      qy = qy.gte('fecha', ini).lte('fecha', fin);
    }
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
      (!e.anulada && (e.por_revisar || (e.origen === 'excel' && (!e.insumos || !e.destino)))
        ? '<div class="aviso warn"><b>Esta entrega tiene dudas por revisar</b><span>Toca «Corregir» abajo: ahí puedes separar o ' +
          'cambiar cada insumo, poner el destino o agregar lo que falta. Si un insumo marcado ya está bien, toca «Está bien así».</span></div>' : '') +
      '<div class="renglones">' +
        dato('Fecha', F().muestraFecha(e.fecha)) +
        dato('Centro de Salud / Destino', e.destino || 'No consta en el Excel') +
        (e.departamento ? dato('Departamento / Servicio', e.departamento) : '') +
        dato('Recibido Por (Responsable)', e.recibido_por || 'No consta en el Excel') +
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
      comoSeRegistro(e) +
      '<div id="' + i('Historial') + '"></div>' +
      (e.anulada ? '' :
        '<div class="botonera"><button type="button" class="secundario" id="' + i('Corregir') + '">Corregir</button>' +
        '<button type="button" class="secundario" id="' + i('Anular') + '" hidden>Anular</button></div>' +
        '<div id="' + i('CajaAnular') + '" hidden><label for="' + i('Motivo') + '">¿Por qué se anula?</label>' +
        '<input id="' + i('Motivo') + '" type="text" autocomplete="off" placeholder="Ej: se registró dos veces">' +
        '<button type="button" class="principal" id="' + i('ConfirmaAnular') + '">Anular esta entrega</button></div>');

    t.q('Volver').addEventListener('click', function () { t.modo = 'lista'; t.pintar(); });
    t.cargarHistorial(e);
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

  /* ---------------------------------------------------------------
     CÓMO SE REGISTRÓ: de dónde vino, quién, cuándo y cómo venía escrito.
  --------------------------------------------------------------- */
  function cuando(iso) {
    return iso ? F().muestraFecha(F().hoyCaracas(iso)) + ' a las ' + F().horaCaracas(iso) : '';
  }

  function comoSeRegistro(e) {
    var corregida = e.actualizado_en && e.creado_en &&
                    (new Date(e.actualizado_en).getTime() - new Date(e.creado_en).getTime()) > 60000;
    var filas = [
      dato('Origen', e.origen === 'excel'
        ? 'Cargada del Excel «insumos_cdi.xlsx», hoja REGISTRO DE ENTREGAS C.D.S, fila ' + e.fila_excel
        : 'Registrada a mano en el sistema'),
      dato(e.origen === 'excel' ? 'Cargada al sistema' : 'Registrada por',
        e.origen === 'excel' ? cuando(e.creado_en) + ' (carga única del Excel)'
                             : (e.registrado_por_nombre || 'No consta') + ' · ' + cuando(e.creado_en)),
      corregida ? dato('Última corrección', cuando(e.actualizado_en)) : '',
      dato('Insumos', e.insumos + (e.insumos === 1 ? ' insumo' : ' insumos') +
        (e.por_revisar ? ' · ' + e.por_revisar + ' por revisar' : '') +
        (e.suma_cantidades != null ? ' · ' + num(e.suma_cantidades) + ' unidades' : '')),
      e.cantidad_total_excel != null
        ? dato('Cantidad Entregada según el Excel', num(e.cantidad_total_excel) + ' en total (una sola cifra para todo el renglón)') : '',
      e.anulada ? dato('Anulada', cuando(e.anulada_en) + ' · ' + (e.anulada_motivo || '')) : ''
    ].join('');
    return '<h3 class="sub-t">Cómo se registró</h3><div class="renglones">' + filas + '</div>' +
      (e.texto_original
        ? '<div class="trat"><span class="lbl">Así venía escrito en el Excel (celda «Descripción del Insumo»)</span>' +
          '<span style="overflow-wrap:anywhere">' + esc(e.texto_original) + '</span></div>'
        : (e.origen === 'excel' ? '<div class="trat"><span class="lbl">En el Excel</span>Este renglón no traía insumos.</div>' : ''));
  }

  /* El historial de cambios sale de la bitácora. Solo el administrador la
     puede leer (así está en la base); a los demás no se les muestra. */
  var CAMPOS = { fecha: 'Fecha', destino: 'Centro de Salud / Destino', recibido_por: 'Recibido Por', institucion_id: 'centro enlazado',
                 anulada: 'anulada', anulada_motivo: 'motivo de anulación', anulada_por: 'quién anuló', anulada_en: 'cuándo se anuló',
                 descripcion: 'descripción', cantidad: 'cantidad', revisar: 'marca de revisar', revisar_motivo: 'pregunta de revisión', orden: 'orden' };

  function resumenHistorial(filas) {
    var grupos = [], por = {};
    (filas || []).forEach(function (b) {
      var k = String(b.momento).slice(0, 19) + '|' + (b.usuario_nombre || '');
      var g = por[k];
      if (!g) { g = por[k] = { momento: b.momento, quien: b.usuario_nombre, rol: b.usuario_rol, partes: {} }; grupos.push(g); }
      var tabla = /items$/.test(b.tabla) ? 'insumo' : 'entrega';
      var op = String(b.operacion || '').toUpperCase();
      var p = g.partes[tabla + op] || (g.partes[tabla + op] = { n: 0, campos: {} });
      p.n++;
      (b.campos || []).forEach(function (c) { if (c !== 'actualizado_en') p.campos[c] = 1; });
    });
    var ORDEN = ['entregaINSERT', 'entregaUPDATE', 'insumoDELETE', 'insumoINSERT', 'insumoUPDATE', 'entregaDELETE'];
    return grupos.map(function (g) {
      var que = ORDEN.filter(function (o) { return g.partes[o]; }).map(function (o) {
        var p = g.partes[o];
        var campos = Object.keys(p.campos).map(function (c) { return CAMPOS[c] || c; });
        var cuantos = p.n + (p.n === 1 ? ' insumo' : ' insumos');
        if (o === 'entregaINSERT') return 'creó la entrega';
        if (o === 'entregaUPDATE') return 'cambió ' + (campos.length ? campos.join(', ') : 'la entrega');
        if (o === 'insumoDELETE') return 'quitó ' + cuantos;
        if (o === 'insumoINSERT') return 'puso ' + cuantos;
        if (o === 'insumoUPDATE') return 'cambió ' + (campos.length ? campos.join(', ') : 'datos') + ' en ' + cuantos;
        return 'borró la entrega';
      });
      return { momento: g.momento, quien: g.quien || null, rol: g.rol || null, que: que.join(' · ') };
    });
  }

  Insumos.prototype.cargarHistorial = function (e) {
    var t = this;
    if (!t.esAdmin) return;
    t.sb.from('bitacora').select('momento, usuario_nombre, usuario_rol, tabla, operacion, campos')
      .in('tabla', ['insumos_entregas_cds', 'insumos_entregas_cds_items'])
      .or('registro_id.eq.' + e.id + ',despues->>entrega_id.eq.' + e.id + ',antes->>entrega_id.eq.' + e.id)
      .order('momento', { ascending: true }).limit(3000)
      .then(function (r) {
        var z = t.q('Historial');
        if (!z || r.error || !r.data || !r.data.length) return;
        z.innerHTML = '<h3 class="sub-t">Historial de cambios <span class="opc">(solo lo ve el administrador)</span></h3>' +
          '<div class="renglones">' + resumenHistorial(r.data).map(function (x) {
            return '<div class="renglon"><div class="que"><b>' + esc(x.que) + '</b><span>' + esc(cuando(x.momento)) + ' · ' +
              esc(x.quien ? x.quien + (x.rol ? ' (' + x.rol + ')' : '') : 'El sistema (carga del Excel o ajuste directo en la base)') +
              '</span></div></div>';
          }).join('') + '</div>';
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
        (it.revisar ? '<span class="insumo-revisar">Revisar: ' + esc(it.revisar_motivo || '') +
          ' <button type="button" class="enlace" data-bien="' + k + '">Está bien así</button></span>' : '') +
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
    z.querySelectorAll('[data-bien]').forEach(function (b) {
      b.addEventListener('click', function () {
        var it = t.items[+b.dataset.bien];
        it.revisar = false; it.revisar_motivo = null;
        t.pintarItems();
        t.aviso('ok', 'Marcado como bien. Toca «Guardar la corrección» para que quede guardado.');
      });
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

  /* ================================================================
     HOJA 2 — CONTROL DE INSUMOS ENTREGADOS
  ================================================================ */

  Insumos.prototype.consultaControl = function (conConteo) {
    var t = this;
    var qy = t.sb.from('v_insumos_control_entregas').select('*', conConteo ? { count: 'exact' } : undefined);
    if (t.filtro === 'anuladas') qy = qy.eq('anulada', true);
    else qy = qy.eq('anulada', false);
    if (t.filtro === 'revisar') qy = qy.or('por_revisar.gt.0,revisar.eq.true,insumos.eq.0');
    if (t.filtro === 'pendientes') qy = qy.ilike('estado_inventario', '%PENDIENTE%');
    if (t.filtro === 'excel') qy = qy.eq('origen', 'excel');
    if (t.filtro === 'manual') qy = qy.eq('origen', 'manual');
    if (t.desde) qy = qy.gte('fecha', t.desde);
    if (t.hasta) qy = qy.lte('fecha', t.hasta);
    if (t.trimestre && t.trimestre !== 'todo') {
      var p = t.trimestre.split('-T');
      var anio = +p[0], tq = +p[1];
      var ini = anio + '-' + String((tq - 1) * 3 + 1).padStart(2, '0') + '-01';
      var mesFin = tq * 3;
      var fin = anio + '-' + String(mesFin).padStart(2, '0') + '-' +
                String(new Date(Date.UTC(anio, mesFin, 0)).getUTCDate()).padStart(2, '0');
      qy = qy.gte('fecha', ini).lte('fecha', fin);
    }
    var palabras = F().sinAcentos(t.busca).toUpperCase().split(' ').filter(Boolean);
    palabras.forEach(function (p) { qy = qy.ilike('busqueda', '%' + p.replace(/[%_]/g, '') + '%'); });
    return qy.order('fecha', { ascending: false, nullsFirst: false }).order('creado_en', { ascending: false });
  };

  Insumos.prototype.verListaControl = function () {
    var t = this, i = function (n) { return t.id(n); };
    var FILTROS = [
      { v: 'todas', t: 'Todas' }, { v: 'revisar', t: 'Por revisar' },
      { v: 'excel', t: 'Del Excel' }, { v: 'manual', t: 'Registradas aquí' }, { v: 'pendientes', t: 'Pendientes de próxima entrega' }, { v: 'anuladas', t: 'Anuladas' }
    ];
    t.q('Zona').innerHTML =
      '<h3 class="sub-t">CONTROL DE INSUMOS ENTREGADOS</h3>' +
      '<p class="sub">Lo que se le entregó a cada persona, insumo por insumo. ' +
        'Es un registro: no descuenta del inventario.</p>' +
      '<div id="' + i('Dudas') + '"></div>' +
      '<button type="button" class="principal" id="' + i('Nueva') + '">Registrar una entrega +</button>' +
      '<label for="' + i('Busca') + '">Buscar</label>' +
      '<input id="' + i('Busca') + '" type="search" autocomplete="off" placeholder="Persona, insumo o categoría" value="' + esc(t.busca) + '">' +
      '<div class="dos-columnas">' +
        '<div><label for="' + i('Desde') + '">Desde</label><input id="' + i('Desde') + '" type="date" value="' + esc(t.desde) + '"></div>' +
        '<div><label for="' + i('Hasta') + '">Hasta</label><input id="' + i('Hasta') + '" type="date" value="' + esc(t.hasta) + '"></div>' +
      '</div>' +
      '<div class="chips" id="' + i('Trimestre') + '"></div>' +
      '<div class="chips" id="' + i('Filtro') + '">' + FILTROS.map(function (f) {
        return '<button type="button" data-f="' + f.v + '"' + (t.filtro === f.v ? ' class="on"' : '') + '>' + f.t + '</button>';
      }).join('') + '</div>' +
      '<div class="barra-lista"><p class="sub conteo" id="' + i('Conteo') + '">Buscando…</p>' +
        '<div class="descargas"><button type="button" id="' + i('Balance') + '">Balance</button>' +
        '<button type="button" id="' + i('Excel') + '">Excel</button>' +
        '<button type="button" id="' + i('Pdf') + '">PDF</button></div></div>' +
      '<div id="' + i('BalanceZona') + '"></div>' +
      '<div id="' + i('Lista') + '" class="lista"></div>' +
      '<div class="botonera" id="' + i('Paginas') + '"></div>';

    var buscar = F().retardo ? F().retardo(function () { t.pagina = 0; t.buscarControl(); }, 300)
                             : function () { t.pagina = 0; t.buscarControl(); };
    t.q('Nueva').addEventListener('click', function () { t.abrirFormularioControl(null); });
    t.q('Busca').addEventListener('input', function () { t.busca = this.value; buscar(); });
    t.q('Desde').addEventListener('change', function () { t.desde = this.value; t.pagina = 0; t.buscarControl(); });
    t.q('Hasta').addEventListener('change', function () { t.hasta = this.value; t.pagina = 0; t.buscarControl(); });
    t.pintarChipsTrimestre(function () { t.pagina = 0; t.buscarControl(); });
    t.q('Filtro').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        t.filtro = b.dataset.f; t.pagina = 0;
        t.q('Filtro').querySelectorAll('button').forEach(function (o) { o.classList.toggle('on', o === b); });
        t.buscarControl();
      });
    });
    t.q('Balance').addEventListener('click', function () { t.verBalance('control'); });
    t.q('Excel').addEventListener('click', function () { t.descargarControl('excel', this); });
    t.q('Pdf').addEventListener('click', function () { t.descargarControl('pdf', this); });
    t.buscarControl();
    t.cargarDudasControl();
  };

  Insumos.prototype.pintarChipsTrimestre = function (alCambiar) {
    var t = this;
    var z = t.q('Trimestre');
    if (!z) return;
    var hoy = F().hoyCaracas();
    var anio = Number(String(hoy).slice(0, 4));
    var opciones = [{ v: 'todo', t: 'Todo' }];
    for (var a = anio; a >= anio - 2; a--) {
      opciones.push({ v: a + '-T1', t: 'ENE–MAR ' + a });
      opciones.push({ v: a + '-T2', t: 'ABR–JUN ' + a });
      opciones.push({ v: a + '-T3', t: 'JUL–SEP ' + a });
      opciones.push({ v: a + '-T4', t: 'OCT–DIC ' + a });
    }
    z.innerHTML = '<span class="sub" style="margin-right:6px">Trimestre</span>' + opciones.map(function (o) {
      var on = (t.trimestre || 'todo') === o.v;
      return '<button type="button" data-t="' + o.v + '"' + (on ? ' class="on"' : '') + '>' + o.t + '</button>';
    }).join('');
    z.querySelectorAll('[data-t]').forEach(function (b) {
      b.addEventListener('click', function () {
        t.trimestre = b.dataset.t;
        z.querySelectorAll('[data-t]').forEach(function (o) { o.classList.toggle('on', o === b); });
        if (alCambiar) alCambiar();
      });
    });
  };

  Insumos.prototype.buscarControl = function () {
    var t = this;
    var mio = ++t.pedido;
    var desde = t.pagina * POR_PAGINA;
    t.consultaControl(true).range(desde, desde + POR_PAGINA - 1).then(function (r) {
      if (mio !== t.pedido || !t.q('Lista')) return;
      if (r.error) { t.q('Conteo').textContent = ''; t.aviso('bad', 'No se pudo cargar: ' + F().traduceError(r.error)); return; }
      t.filas = r.data || []; t.total = r.count || 0;
      t.pintarListaControl();
    });
  };

  Insumos.prototype.pintarListaControl = function () {
    var t = this;
    var z = t.q('Lista');
    t.q('Conteo').textContent = t.total === 1 ? '1 registro' : num(t.total) + ' registros';
    if (!t.filas.length) {
      z.innerHTML = '<p class="sub">No hay registros con esa búsqueda.</p>';
    } else {
      z.innerHTML = t.filas.map(function (e) {
        var cant = e.suma_cantidades != null ? num(e.suma_cantidades) + ' unidades'
                 : e.total_entregado_excel != null ? num(e.total_entregado_excel) + ' unidades en total (Excel)' : 'sin cantidad';
        var fecha = e.fecha ? F().muestraFecha(e.fecha) : (e.fecha_texto || 'Sin fecha');
        var chips = (e.origen === 'excel' ? ' <span class="sit gris">Del Excel</span>' : '') +
                    (e.por_revisar ? ' <span class="sit ojo">' + e.por_revisar + ' por revisar</span>' : '') +
                    (e.revisar ? ' <span class="sit ojo">Revisar</span>' : '') +
                    (e.anulada ? ' <span class="sit mal">Anulada</span>' : '');
        return '<button type="button" class="item" data-id="' + esc(e.id) + '">' +
          '<b>' + esc(fecha) + ' · ' + esc(e.persona || 'Persona no consta') + chips + '</b>' +
          '<span>' + e.insumos + (e.insumos === 1 ? ' insumo' : ' insumos') + ' · ' + cant +
          (e.categoria ? ' · ' + esc(e.categoria) : '') + '</span></button>';
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
      b.addEventListener('click', function () { t.pagina += Number(b.dataset.p); t.buscarControl(); });
    });
  };

  Insumos.prototype.cargarDudasControl = function () {
    var t = this;
    Promise.all([
      t.sb.from('insumos_control_entregas_items')
        .select('id, descripcion, revisar_motivo, entrega_id, insumos_control_entregas!inner(fecha, fecha_texto, persona, anulada)')
        .eq('revisar', true).eq('insumos_control_entregas.anulada', false),
      t.sb.from('v_insumos_control_entregas').select('id, fecha, fecha_texto, persona, insumos, revisar, revisar_motivo')
        .eq('anulada', false).or('insumos.eq.0,revisar.eq.true')
    ]).then(function (r) {
      var z = t.q('Dudas');
      if (!z) return;
      if (r[0].error || r[1].error) { z.innerHTML = ''; return; }
      var dudas = (r[0].data || []).map(function (x) {
        var e = x.insumos_control_entregas || {};
        return {
          entrega: x.entrega_id,
          fecha: e.fecha, fechaTexto: e.fecha_texto,
          texto: x.descripcion,
          pregunta: x.revisar_motivo || 'Revisar este insumo'
        };
      }).concat((r[1].data || []).map(function (e) {
        return {
          entrega: e.id, fecha: e.fecha, fechaTexto: e.fecha_texto, texto: e.insumos ? '' : '(sin insumos)',
          pregunta: e.revisar_motivo || (!e.insumos
            ? 'El Excel no dice qué se entregó ni cuánto. ¿Qué se entregó?'
            : 'Revisar este registro del Excel.')
        };
      }));
      dudas.sort(function (a, b) { return String(a.fecha || a.fechaTexto || '').localeCompare(String(b.fecha || b.fechaTexto || '')); });
      if (!dudas.length) { z.innerHTML = ''; return; }
      z.innerHTML =
        '<div class="aviso warn dudas-caja"><b>Dudas del Excel para revisar: ' + dudas.length + '</b>' +
        '<span>Estos datos vinieron del Excel y no se entiende qué quisieron poner. Abre cada uno, míralo y ' +
        'corrígelo con «Corregir». Si un insumo marcado ya está bien, toca «Está bien así».</span>' +
        '<div class="renglones">' + dudas.map(function (d) {
          var fecha = d.fecha ? F().muestraFecha(d.fecha) : (d.fechaTexto || 'Sin fecha');
          return '<div class="renglon"><div class="que">' +
            '<b>' + esc(fecha) + (d.texto ? ' · ' + esc(d.texto) : '') + '</b>' +
            '<span>' + esc(d.pregunta) + '</span></div>' +
            '<button type="button" class="quitar" data-duda="' + esc(d.entrega) + '">Revisar</button></div>';
        }).join('') + '</div></div>';
      z.querySelectorAll('[data-duda]').forEach(function (b) {
        b.addEventListener('click', function () {
          b.disabled = true;
          t.sb.from('v_insumos_control_entregas').select('*').eq('id', b.dataset.duda).single().then(function (v) {
            b.disabled = false;
            if (v.error || !v.data) { t.aviso('bad', 'No se pudo abrir: ' + F().traduceError(v.error || 'no encontrado')); return; }
            t.actual = v.data; t.modo = 'detalle'; t.pintar();
          });
        });
      });
    });
  };

  Insumos.prototype.descargarControl = function (cual, boton) {
    var t = this;
    var R = raiz.FARMREP;
    if (!R) { t.aviso('bad', 'Todavía se está cargando el generador de reportes. Inténtalo en unos segundos.'); return; }
    var txt = boton.textContent;
    boton.disabled = true; boton.textContent = 'Preparando…';
    var todas = [];
    (function tanda(desde) {
      t.consultaControl(false).range(desde, desde + 999).then(function (r) {
        if (r.error) {
          boton.disabled = false; boton.textContent = txt;
          t.aviso('bad', 'No se pudo preparar el reporte: ' + F().traduceError(r.error)); return;
        }
        todas = todas.concat(r.data || []);
        if ((r.data || []).length === 1000 && todas.length < 20000) return tanda(desde + 1000);
        boton.disabled = false; boton.textContent = txt;
        var filas = filasReporteControl(todas);
        var sub = todas.length + ' registro(s), ' + filas.length + ' renglón(es) de insumos' +
          (t.trimestre && t.trimestre !== 'todo' ? ' · ' + t.trimestre : '');
        if (cual === 'excel') {
          R.excel('Insumos - Control de insumos entregados', [{
            nombre: 'CONTROL DE INSUMOS', titulo: 'CONTROL DE INSUMOS ENTREGADOS — ' + sub,
            encabezados: ENCABEZADOS_CONTROL, filas: filas, anchos: [12, 28, 44, 22, 10, 16, 14, 22, 36]
          }]);
        } else {
          R.pdfTabla({
            titulo: 'CONTROL DE INSUMOS ENTREGADOS', subtitulo: sub, horizontal: true,
            archivo: 'Insumos - Control de insumos entregados',
            encabezados: ENCABEZADOS_CONTROL,
            filas: filas.map(function (f) { return f.map(function (c) { return typeof c === 'number' ? num(c) : c; }); }),
            columnas: {
              0: { cellWidth: 18 }, 1: { cellWidth: 28 }, 2: { cellWidth: 50 }, 3: { cellWidth: 24 },
              4: { cellWidth: 12, halign: 'right' }, 5: { cellWidth: 18, halign: 'right' },
              6: { cellWidth: 18 }, 7: { cellWidth: 24 }, 8: { cellWidth: 40 }
            }
          });
        }
      });
    })(0);
  };

  Insumos.prototype.verDetalleControl = function () {
    var t = this, i = function (n) { return t.id(n); }, e = t.actual;
    if (!e) { t.modo = 'lista'; t.pintar(); return; }
    var items = e.items || [];
    var total = e.suma_cantidades != null ? e.suma_cantidades : null;
    var fechaTxt = e.fecha ? F().muestraFecha(e.fecha) : (e.fecha_texto || 'Sin fecha');
    t.q('Zona').innerHTML =
      '<button type="button" class="volver" id="' + i('Volver') + '">← Volver a la lista</button>' +
      '<h3 class="sub-t">Control del ' + esc(fechaTxt) + '</h3>' +
      (e.anulada ? '<div class="aviso bad"><b>Anulada</b><span>' + esc(e.anulada_motivo || '') + '</span></div>' : '') +
      ((!e.anulada && (e.por_revisar || e.revisar || (e.origen === 'excel' && !e.insumos)))
        ? '<div class="aviso warn"><b>Este registro tiene dudas por revisar</b><span>Toca «Corregir» abajo. ' +
          'Si un insumo marcado ya está bien, toca «Está bien así».</span></div>' : '') +
      '<div class="renglones">' +
        dato('Fecha', fechaTxt + (e.fecha_texto && e.fecha && e.fecha_texto !== e.fecha
          ? ' (en el Excel: ' + e.fecha_texto + ')' : '')) +
        dato('Nombre y Apellido', e.persona || 'No consta en el Excel') +
        (e.categoria ? dato('Categoría / Tipo', e.categoria) : '') +
        (e.estado_inventario ? dato('Estado Inventario', e.estado_inventario) : '') +
        (e.observacion ? dato('Observación', e.observacion) : '') +
        (e.ultima_entrega || e.ultima_entrega_texto
          ? dato('Última Entrega', e.ultima_entrega ? F().muestraFecha(e.ultima_entrega) : e.ultima_entrega_texto) : '') +
      '</div>' +
      '<h3 class="sub-t">Descripción del Insumo / Medicamento</h3>' +
      (items.length
        ? '<div class="tabla-caja"><table class="tabla"><thead><tr><th>#</th><th>Descripción del Insumo / Medicamento</th>' +
          '<th class="num">Cantidad</th></tr></thead><tbody>' +
          items.map(function (it, k) {
            return '<tr><td>' + (k + 1) + '</td><td>' + esc(it.descripcion) +
              (it.revisar ? ' <span class="sit ojo" title="' + esc(it.revisar_motivo || '') + '">Revisar</span>' +
                            '<span class="chico" style="display:block;font-size:11.5px;color:var(--warn-ink)">' + esc(it.revisar_motivo || '') + '</span>' : '') +
              '</td><td class="num">' + (it.cantidad == null ? '—' : num(it.cantidad)) + '</td></tr>';
          }).join('') +
          (total != null ? '<tr><td></td><td><b>Total Entregado (suma de cantidades)</b></td><td class="num"><b>' + num(total) + '</b></td></tr>' : '') +
          '</tbody></table></div>'
        : '<p class="sub">El Excel no anota insumos en este renglón.</p>') +
      (e.origen === 'excel' && e.total_entregado_excel != null
        ? '<div class="aviso warn"><b>Total Entregado según el Excel: ' + num(e.total_entregado_excel) + '</b>' +
          '<span>Así lo anota el Excel: una sola cifra para todos los insumos de este renglón, sin cantidad por insumo. ' +
          'No se reparte porque sería inventar números. Si sabes cuánto fue de cada uno, usa «Corregir».</span></div>' : '') +
      comoSeRegistroControl(e) +
      '<div id="' + i('Historial') + '"></div>' +
      (e.anulada ? '' :
        '<div class="botonera"><button type="button" class="secundario" id="' + i('Corregir') + '">Corregir</button>' +
        '<button type="button" class="secundario" id="' + i('Anular') + '" hidden>Anular</button></div>' +
        '<div id="' + i('CajaAnular') + '" hidden><label for="' + i('Motivo') + '">¿Por qué se anula?</label>' +
        '<input id="' + i('Motivo') + '" type="text" autocomplete="off" placeholder="Ej: se registró dos veces">' +
        '<button type="button" class="principal" id="' + i('ConfirmaAnular') + '">Anular este registro</button></div>');

    t.q('Volver').addEventListener('click', function () { t.modo = 'lista'; t.pintar(); });
    t.cargarHistorialControl(e);
    if (e.anulada) return;
    t.q('Corregir').addEventListener('click', function () { t.abrirFormularioControl(e); });
    if (t.esAdmin) t.q('Anular').hidden = false;
    t.q('Anular').addEventListener('click', function () { t.q('CajaAnular').hidden = false; t.q('Motivo').focus(); });
    t.q('ConfirmaAnular').addEventListener('click', function () {
      var motivo = t.q('Motivo').value.trim();
      if (motivo.length < 5) { t.aviso('warn', 'Escribe por qué se anula (al menos 5 letras).'); return; }
      var b = this; b.disabled = true; b.textContent = 'Anulando…';
      t.sb.rpc('insumos_control_anular', { p_id: e.id, p_motivo: motivo }).then(function (r) {
        b.disabled = false; b.textContent = 'Anular este registro';
        if (r.error || r.data !== true) { t.aviso('bad', 'No se anuló: ' + F().traduceError(r.error || 'ya no estaba activo')); return; }
        t.modo = 'lista'; t.pintar();
        t.aviso('ok', 'El registro quedó anulado. Se puede ver en el filtro «Anuladas».');
      });
    });
  };

  function comoSeRegistroControl(e) {
    var corregida = e.actualizado_en && e.creado_en &&
                    (new Date(e.actualizado_en).getTime() - new Date(e.creado_en).getTime()) > 60000;
    var filas = [
      dato('Origen', e.origen === 'excel'
        ? 'Cargada del Excel «insumos_cdi.xlsx», hoja CONTROL DE INSUMOS ENTREGADOS, fila ' + e.fila_excel
        : 'Registrada a mano en el sistema'),
      dato(e.origen === 'excel' ? 'Cargada al sistema' : 'Registrada por',
        e.origen === 'excel' ? cuando(e.creado_en) + ' (carga única del Excel)'
                             : (e.registrado_por_nombre || 'No consta') + ' · ' + cuando(e.creado_en)),
      corregida ? dato('Última corrección', cuando(e.actualizado_en)) : '',
      dato('Insumos', e.insumos + (e.insumos === 1 ? ' insumo' : ' insumos') +
        (e.por_revisar ? ' · ' + e.por_revisar + ' por revisar' : '') +
        (e.suma_cantidades != null ? ' · ' + num(e.suma_cantidades) + ' unidades' : '')),
      e.total_entregado_excel != null
        ? dato('Total Entregado según el Excel', num(e.total_entregado_excel) + ' en total (sin cantidad por insumo)') : '',
      e.anulada ? dato('Anulada', cuando(e.anulada_en) + ' · ' + (e.anulada_motivo || '')) : ''
    ].join('');
    return '<h3 class="sub-t">Cómo se registró</h3><div class="renglones">' + filas + '</div>' +
      (e.texto_original
        ? '<div class="trat"><span class="lbl">Así venía escrito en el Excel (celda «Descripción del Insumo / Medicamento»)</span>' +
          '<span style="overflow-wrap:anywhere">' + esc(e.texto_original) + '</span></div>'
        : (e.origen === 'excel' ? '<div class="trat"><span class="lbl">En el Excel</span>Este renglón no traía insumos.</div>' : ''));
  }

  var CAMPOS_CTRL = {
    fecha: 'Fecha', fecha_texto: 'fecha original', persona: 'Nombre y Apellido',
    categoria: 'Categoría', total_entregado_excel: 'Total Entregado del Excel',
    ultima_entrega: 'Última Entrega', estado_inventario: 'Estado Inventario',
    observacion: 'Observación', anulada: 'anulada', anulada_motivo: 'motivo de anulación',
    descripcion: 'descripción', cantidad: 'cantidad', revisar: 'marca de revisar',
    revisar_motivo: 'pregunta de revisión', orden: 'orden'
  };

  Insumos.prototype.cargarHistorialControl = function (e) {
    var t = this;
    if (!t.esAdmin) return;
    t.sb.from('bitacora').select('momento, usuario_nombre, usuario_rol, tabla, operacion, campos')
      .in('tabla', ['insumos_control_entregas', 'insumos_control_entregas_items'])
      .or('registro_id.eq.' + e.id + ',despues->>entrega_id.eq.' + e.id + ',antes->>entrega_id.eq.' + e.id)
      .order('momento', { ascending: true }).limit(3000)
      .then(function (r) {
        var z = t.q('Historial');
        if (!z || r.error || !r.data || !r.data.length) return;
        var grupos = [], por = {};
        r.data.forEach(function (b) {
          var k = String(b.momento).slice(0, 19) + '|' + (b.usuario_nombre || '');
          var g = por[k];
          if (!g) { g = por[k] = { momento: b.momento, quien: b.usuario_nombre, rol: b.usuario_rol, partes: {} }; grupos.push(g); }
          var tabla = /items$/.test(b.tabla) ? 'insumo' : 'entrega';
          var op = String(b.operacion || '').toUpperCase();
          var p = g.partes[tabla + op] || (g.partes[tabla + op] = { n: 0, campos: {} });
          p.n++;
          (b.campos || []).forEach(function (c) { if (c !== 'actualizado_en') p.campos[c] = 1; });
        });
        var ORDEN = ['entregaINSERT', 'entregaUPDATE', 'insumoDELETE', 'insumoINSERT', 'insumoUPDATE', 'entregaDELETE'];
        z.innerHTML = '<h3 class="sub-t">Historial de cambios <span class="opc">(solo lo ve el administrador)</span></h3>' +
          '<div class="renglones">' + grupos.map(function (g) {
            var que = ORDEN.filter(function (o) { return g.partes[o]; }).map(function (o) {
              var p = g.partes[o];
              var campos = Object.keys(p.campos).map(function (c) { return CAMPOS_CTRL[c] || c; });
              if (o === 'entregaINSERT') return 'creó el registro';
              if (o === 'entregaUPDATE') return 'cambió ' + (campos.length ? campos.join(', ') : 'el registro');
              if (o === 'insumoDELETE') return 'quitó ' + p.n + (p.n === 1 ? ' insumo' : ' insumos');
              if (o === 'insumoINSERT') return 'puso ' + p.n + (p.n === 1 ? ' insumo' : ' insumos');
              if (o === 'insumoUPDATE') return 'cambió ' + (campos.length ? campos.join(', ') : 'datos');
              return 'borró el registro';
            }).join(' · ');
            return '<div class="renglon"><div class="que"><b>' + esc(que) + '</b><span>' + esc(cuando(g.momento)) + ' · ' +
              esc(g.quien ? g.quien + (g.rol ? ' (' + g.rol + ')' : '') : 'El sistema (carga del Excel o ajuste directo en la base)') +
              '</span></div></div>';
          }).join('') + '</div>';
      });
  };

  Insumos.prototype.abrirFormularioControl = function (e) {
    var t = this;
    t.actual = e;
    t.items = e && e.items && e.items.length
      ? e.items.map(function (it) {
          return {
            descripcion: it.descripcion,
            cantidad: it.cantidad == null ? '' : String(it.cantidad).replace('.', ','),
            revisar: it.revisar, revisar_motivo: it.revisar_motivo
          };
        })
      : [{ descripcion: '', cantidad: '' }];
    t.modo = 'form'; t.pintar();
  };

  Insumos.prototype.verFormularioControl = function () {
    var t = this, i = function (n) { return t.id(n); }, e = t.actual;
    var hoy = F().hoyCaracas();
    var deExcel = !!(e && e.origen === 'excel');
    t.q('Zona').innerHTML =
      '<button type="button" class="volver" id="' + i('Volver') + '">← Volver' + (e ? ' al registro' : ' a la lista') + '</button>' +
      '<h3 class="sub-t">' + (e ? 'Corregir el registro' : 'Registrar una entrega') + '</h3>' +
      (deExcel ? '<div class="aviso warn">Este registro vino del Excel. Puedes separar o corregir sus insumos y ponerles ' +
                 'cantidad si la sabes; si no, déjala vacía.</div>' : '') +
      '<label for="' + i('Fecha') + '">Fecha</label>' +
      '<input id="' + i('Fecha') + '" type="date"' + (deExcel ? '' : ' max="' + esc(hoy) + '"') + ' value="' +
        esc(e && e.fecha ? e.fecha : (deExcel ? '' : hoy)) + '">' +
      (deExcel && e.fecha_texto ? '<p class="sub">En el Excel venía: ' + esc(e.fecha_texto) + '</p>' : '') +
      '<label for="' + i('Persona') + '">Nombre y Apellido</label>' +
      '<input id="' + i('Persona') + '" type="text" autocomplete="off" placeholder="Nombre y apellido de la persona" value="' +
        esc(e ? e.persona || '' : '') + '">' +
      '<label for="' + i('Categoria') + '">Categoría / Tipo</label>' +
      '<input id="' + i('Categoria') + '" type="text" autocomplete="off" placeholder="Ej: INSUMO PREOPERATORIO" value="' +
        esc(e ? e.categoria || '' : '') + '">' +
      '<label for="' + i('Ultima') + '">Última Entrega</label>' +
      '<input id="' + i('Ultima') + '" type="date" value="' +
        esc(e && e.ultima_entrega ? e.ultima_entrega : '') + '">' +
      '<label for="' + i('Estado') + '">Estado Inventario</label>' +
      '<input id="' + i('Estado') + '" type="text" autocomplete="off" placeholder="Ej: ENTREGADO" value="' +
        esc(e ? e.estado_inventario || '' : '') + '">' +
      '<label for="' + i('Obs') + '">Observación</label>' +
      '<input id="' + i('Obs') + '" type="text" autocomplete="off" placeholder="Opcional" value="' +
        esc(e ? e.observacion || '' : '') + '">' +
      '<h3 class="sub-t">Descripción del Insumo / Medicamento</h3>' +
      '<p class="sub">Un insumo por renglón, con su cantidad.</p>' +
      '<div class="insumo-fila insumo-cabeza" aria-hidden="true"><span>INSUMO</span><span>CANT</span><span></span></div>' +
      '<div id="' + i('Items') + '" class="insumo-filas"></div>' +
      '<button type="button" class="secundario insumo-agregar" id="' + i('Agregar') + '">Agregar +</button>' +
      '<p class="sub" id="' + i('Total') + '"></p>' +
      '<button type="button" class="principal" id="' + i('Guardar') + '">' +
        (e ? 'Guardar la corrección' : 'Guardar el registro') + '</button>';

    t.pintarItems();
    t.q('Agregar').addEventListener('click', function () {
      t.items.push({ descripcion: '', cantidad: '' });
      t.pintarItems();
      var cajas = t.q('Items').querySelectorAll('[data-desc]');
      if (cajas.length) cajas[cajas.length - 1].focus();
    });
    t.q('Volver').addEventListener('click', function () { t.modo = e ? 'detalle' : 'lista'; t.pintar(); });
    t.q('Guardar').addEventListener('click', function () { t.guardarControl(); });
  };

  Insumos.prototype.guardarControl = function () {
    var t = this, e = t.actual;
    t.limpiaAviso();
    var rev = revisaFormularioControl({
      fecha: t.q('Fecha').value,
      persona: t.q('Persona').value,
      categoria: t.q('Categoria').value,
      ultima_entrega: t.q('Ultima').value,
      estado_inventario: t.q('Estado').value,
      observacion: t.q('Obs').value,
      items: t.items
    }, F().hoyCaracas(), !(e && e.origen === 'excel'));
    if (rev.error) { t.aviso('warn', rev.error); return; }

    var b = t.q('Guardar'), txt = b.textContent;
    b.disabled = true; b.textContent = 'Guardando…';
    t.sb.rpc('insumos_control_guardar', { p_id: e ? e.id : null, p_datos: rev.datos }).then(function (r) {
      if (r.error || !r.data) {
        b.disabled = false; b.textContent = txt;
        t.aviso('bad', 'No se guardó: ' + F().traduceError(r.error || 'el servidor no confirmó'));
        return;
      }
      t.sb.from('v_insumos_control_entregas').select('*').eq('id', r.data).single().then(function (v) {
        if (v.error || !v.data) { t.modo = 'lista'; t.pintar(); t.aviso('ok', 'Guardado.'); return; }
        t.actual = v.data; t.modo = 'detalle'; t.pintar();
        t.aviso('ok', (e ? 'La corrección quedó guardada: ' : 'El registro quedó guardado: ') +
          v.data.insumos + (v.data.insumos === 1 ? ' insumo' : ' insumos') + '.');
      });
    });
  };

  /* ---------------------------------------------------------------
     Balance por trimestre (las dos hojas)
  --------------------------------------------------------------- */
  Insumos.prototype.verBalance = function (hoja) {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('BalanceZona');
    if (!z) return;
    z.innerHTML = '<p class="sub">Preparando el balance…</p>';
    var consulta = hoja === 'control' ? t.consultaControl(false) : t.consulta(false);
    var todas = [];
    (function tanda(desde) {
      consulta.range(desde, desde + 999).then(function (r) {
        if (r.error) { z.innerHTML = ''; t.aviso('bad', 'No se pudo armar el balance: ' + F().traduceError(r.error)); return; }
        todas = todas.concat(r.data || []);
        if ((r.data || []).length === 1000 && todas.length < 20000) return tanda(desde + 1000);
        var bal = armaBalance(todas, hoja);
        t.ultimoBalance = { bal: bal, hoja: hoja, total: todas.length };
        var titulo = hoja === 'control' ? 'CONTROL DE INSUMOS ENTREGADOS' : 'REGISTRO DE ENTREGAS C.D.S';
        z.innerHTML =
          '<div class="aviso"><b>Balance general por trimestre — ' + esc(titulo) + '</b>' +
          '<span>Las «unidades con cantidad» solo suman lo que tiene cantidad por insumo. ' +
          'Los «totales del Excel» son cifras sin desglose y NO se pueden repartir.</span></div>' +
          '<div class="tabla-caja"><table class="tabla"><thead><tr>' +
          '<th>Trimestre</th><th class="num">Entregas</th><th class="num">Personas distintas</th><th class="num">Unidades con cantidad</th>' +
          '<th class="num">Totales Excel (sin desglose)</th><th class="num">Por revisar</th>' +
          '<th>Grupo principal</th><th>Insumo más entregado</th></tr></thead><tbody>' +
          filasBalance(bal, hoja).map(function (f) {
            return '<tr><td>' + esc(f[0]) + '</td><td class="num">' + num(f[1]) + '</td><td class="num">' + num(f[2]) +
              '</td><td class="num">' + num(f[3]) + '</td><td class="num">' + num(f[4]) + '</td><td class="num">' + num(f[5]) +
              '</td><td>' + esc(f[6]) + '</td><td>' + esc(f[7]) + '</td></tr>';
          }).join('') +
          '</tbody></table></div>' +
          '<div class="botonera">' +
          '<button type="button" class="secundario" id="' + i('BalExcel') + '">Informe Excel</button>' +
          '<button type="button" class="secundario" id="' + i('BalPdf') + '">Informe PDF</button>' +
          '<button type="button" class="volver" id="' + i('BalCerrar') + '">Cerrar balance</button></div>';
        t.q('BalCerrar').addEventListener('click', function () { z.innerHTML = ''; });
        t.q('BalExcel').addEventListener('click', function () { t.descargarBalance('excel'); });
        t.q('BalPdf').addEventListener('click', function () { t.descargarBalance('pdf'); });
      });
    })(0);
  };

  Insumos.prototype.descargarBalance = function (cual) {
    var t = this;
    var R = raiz.FARMREP;
    var paquete = t.ultimoBalance;
    if (!R || !paquete) { t.aviso('bad', 'Primero abre el balance.'); return; }
    var bal = paquete.bal, hoja = paquete.hoja;
    var titulo = hoja === 'control' ? 'CONTROL DE INSUMOS ENTREGADOS' : 'REGISTRO DE ENTREGAS C.D.S';
    var sub = 'Balance general por trimestre · ' + paquete.total + ' registro(s)';
    var filas = filasBalance(bal, hoja);

    /* Detalle por trimestre: por grupo y más entregados. */
    var detalle = [];
    (bal.trimestres || []).forEach(function (tr) {
      (tr.porGrupo || []).forEach(function (g) {
        detalle.push([tr.nombre, hoja === 'control' ? 'Categoría' : 'Destino', g.clave, g.veces, '', '']);
      });
      (tr.masEntregados || []).forEach(function (m) {
        detalle.push([tr.nombre, 'Insumo más entregado', m.clave, m.veces, '', '']);
      });
    });
    var encDetalle = ['Trimestre', 'Tipo', 'Detalle', 'Registros', '', ''];
    while (encDetalle.length < ENCABEZADOS_BALANCE.length) encDetalle.push('');
    while (detalle.some(function (f) { return f.length < ENCABEZADOS_BALANCE.length; })) {
      detalle = detalle.map(function (f) {
        while (f.length < ENCABEZADOS_BALANCE.length) f.push('');
        return f;
      });
    }

    if (cual === 'excel') {
      R.excel('Insumos - Balance trimestral ' + titulo, [
        {
          nombre: 'Balance', titulo: 'Balance general — ' + titulo + ' — ' + sub,
          encabezados: ENCABEZADOS_BALANCE, filas: filas,
          anchos: [22, 12, 14, 20, 24, 12, 28, 28]
        },
        {
          nombre: 'Detalle', titulo: 'Detalle del balance — ' + titulo,
          encabezados: encDetalle, filas: detalle,
          anchos: [22, 18, 36, 12, 12, 12, 12, 12]
        }
      ]);
    } else {
      R.pdfInforme({
        titulo: 'Balance general — ' + titulo,
        subtitulo: sub,
        horizontal: true,
        archivo: 'Insumos - Balance trimestral',
        resumen: [
          { k: 'Trimestres con datos', v: String((bal.trimestres || []).length) },
          { k: 'Registros totales', v: num(paquete.total) },
          { k: 'Unidades con cantidad', v: num((bal.trimestres || []).reduce(function (a, t) { return a + t.unidadesConCantidad; }, 0) + (bal.sinFecha ? bal.sinFecha.unidadesConCantidad : 0)) },
          { k: 'Totales Excel (sin desglose)', v: num((bal.trimestres || []).reduce(function (a, t) { return a + t.totalesExcel; }, 0) + (bal.sinFecha ? bal.sinFecha.totalesExcel : 0)) }
        ],
        bloques: [
          {
            titulo: 'Por trimestre',
            nota: 'Las unidades con cantidad no incluyen los totales del Excel sin desglose.',
            encabezados: ENCABEZADOS_BALANCE,
            filas: filas.map(function (f) { return f.map(function (c) { return typeof c === 'number' ? num(c) : c; }); }),
            columnas: {
              0: { cellWidth: 34 }, 1: { cellWidth: 18, halign: 'right' }, 2: { cellWidth: 20, halign: 'right' },
              3: { cellWidth: 26, halign: 'right' }, 4: { cellWidth: 30, halign: 'right' }, 5: { cellWidth: 18, halign: 'right' },
              6: { cellWidth: 52 }, 7: { cellWidth: 52 }
            }
          },
          {
            titulo: 'Detalle por trimestre',
            encabezados: ['Trimestre', 'Tipo', 'Detalle', 'Registros'],
            filas: detalle.filter(function (f) { return f[2]; }).map(function (f) { return [f[0], f[1], f[2], num(f[3])]; }),
            columnas: {
              0: { cellWidth: 36 }, 1: { cellWidth: 32 }, 2: { cellWidth: 90 }, 3: { cellWidth: 24, halign: 'right' }
            }
          }
        ]
      });
    }
  };

  raiz.PANTALLA_INSUMOS = function (cliente, contenedor, opciones) {
    var t = new Insumos(cliente, contenedor, (opciones && opciones.prefijo) || 'in');
    t.trimestre = 'todo';
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
