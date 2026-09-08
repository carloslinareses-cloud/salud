/* CENTROS DE SALUD: los CDI, ambulatorios y consultorios.

   A un centro no se le despacha de uno en uno como a una persona: se le
   manda un pedido de veinte renglones, casi siempre los mismos y casi
   siempre en las mismas cantidades. Aquí cada centro lleva su lista —qué
   insumos necesita y cuánto de cada uno— y al ir a entregarle salen todos
   con su cantidad ya puesta.

   Tres pantallas:
     · Lista  — todos los centros, con lo que piden y lo que ya recibieron.
     · Ficha  — sus datos, su lista de insumos y todo lo que se le ha
                entregado, en Excel y en PDF.
     · Nuevo  — darlo de alta con su lista desde el principio.

   Lo que hay que entender de la cantidad: es la que SUELE necesitar, para
   proponerla al armar la entrega. No descuenta nada del inventario. Lo
   único que descuenta sigue siendo el renglón de la entrega. */
(function () {
  'use strict';

  var POR_PAGINA = 20;

  var TIPOS = ['CDI', 'Ambulatorio', 'Consultorio Popular',
               'Base de Misiones', 'Hospital', 'Otro'];

  var COBERTURA = {
    alcanza:        { txt: 'Alcanza',        cl: 'ok' },
    hay:            { txt: 'Hay existencia', cl: 'ok' },
    no_alcanza:     { txt: 'No alcanza',     cl: 'ojo' },
    sin_existencia: { txt: 'Sin existencia', cl: 'mal' },
    solo_vencido:   { txt: 'Solo vencido',   cl: 'mal' },
    sin_enlazar:    { txt: 'Sin enlazar',    cl: 'gris' }
  };

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return Math.round(Number(n) || 0).toLocaleString('es-VE'); }
  function corta(f) {
    if (!f) return '';
    var p = String(f).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(f);
  }
  function retardo(fn, ms) {
    var t; return function () { var a = arguments, s = this;
      clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  }
  function sit(c) {
    var m = COBERTURA[c] || { txt: c || '', cl: 'gris' };
    return '<span class="sit ' + m.cl + '">' + esc(m.txt) + '</span>';
  }

  var CAMPOS = 'id,nombre,tipo,direccion,responsable,telefono,activo,entregas,' +
               'ultima_entrega,insumos,unidades_recibidas';
  var CAMPOS_REQ = 'requerimiento_id,institucion_id,producto_id,texto_original,cantidad,nota,' +
                   'producto,dosificacion,presentacion,unidad,empaque,unidades_por_empaque,' +
                   'disponible,vencido,vence_primero,situacion,cobertura';

  /* ================================================================ */
  function Centros(sb, raiz, pfx) {
    this.sb = sb; this.raiz = raiz; this.pfx = pfx;
    this.modo = 'lista';
    this.busca = ''; this.pagina = 0; this.total = 0; this.filas = [];
    this.pedido = 0;
    this.quien = null;          // el centro abierto
    this.insumos = null;        // su lista
    this.recibido = null;       // lo que se le ha entregado
    this.pendientes = [];       // lo anotado a un centro que aún no existe
    this.abierto = false;       // el buscador de insumos está desplegado
  }

  Centros.prototype.id = function (n) { return this.pfx + n; };
  Centros.prototype.q = function (n) { return this.raiz.querySelector('#' + this.pfx + n); };
  Centros.prototype.aviso = function (clase, txt) {
    var z = this.q('Aviso');
    if (!z) return;
    z.innerHTML = '<div class="aviso ' + clase + '" role="status">' + esc(txt) + '</div>';
    if (z.scrollIntoView) z.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  Centros.prototype.limpiaAviso = function () {
    var z = this.q('Aviso'); if (z) z.innerHTML = '';
  };

  Centros.prototype.pintar = function () {
    var t = this;
    t.raiz.innerHTML = '<div id="' + t.id('Zona') + '"></div><div id="' + t.id('Aviso') + '"></div>';
    if (t.modo === 'lista') t.verLista();
    else if (t.modo === 'nuevo') t.verFormulario();
    else t.pintarFicha();
  };

  /* ================================================================
     LISTA
  ================================================================ */
  Centros.prototype.verLista = function () {
    var t = this, i = function (n) { return t.id(n); };
    t.q('Zona').innerHTML =
      '<h2 class="sub-t">Centros de salud</h2>' +
      '<p class="sub">Los CDI, ambulatorios y consultorios a los que se despacha. Cada uno ' +
      'lleva su lista de insumos: al ir a entregarle salen todos con su cantidad ya puesta.</p>' +
      '<div class="busca-fila">' +
        '<div class="busca-campo">' +
          '<label for="' + i('Busca') + '">Buscar</label>' +
          '<input id="' + i('Busca') + '" type="search" autocomplete="off" ' +
            'placeholder="Nombre del centro…" value="' + esc(t.busca) + '">' +
        '</div>' +
        '<button type="button" class="secundario" id="' + i('Nuevo') + '">+ Registrar centro</button>' +
      '</div>' +
      '<div id="' + i('Res') + '"><div class="cargando">Cargando…</div></div>';

    var caja = t.q('Busca');
    caja.addEventListener('input', retardo(function () {
      t.busca = caja.value.trim(); t.pagina = 0; t.cargarLista();
    }, 300));
    t.q('Nuevo').addEventListener('click', function () {
      t.modo = 'nuevo'; t.pendientes = []; t.pintar();
    });
    t.cargarLista();
  };

  Centros.prototype.cargarLista = function () {
    var t = this;
    var mio = ++t.pedido;
    var z = t.q('Res');
    if (!z) return;
    z.innerHTML = '<div class="cargando">Cargando…</div>';

    var q = t.busca.replace(/[%,()]/g, '');
    var c = t.sb.from('v_instituciones_ficha').select(CAMPOS, { count: 'exact' });
    if (q) {
      var sa = window.FARM ? window.FARM.sinAcentos(q).toUpperCase() : q.toUpperCase();
      c = c.or('busqueda.ilike.*' + sa + '*,responsable.ilike.*' + q + '*');
    }
    c.order('nombre').range(t.pagina * POR_PAGINA, t.pagina * POR_PAGINA + POR_PAGINA - 1)
      .then(function (r) {
        if (mio !== t.pedido || !t.q('Res')) return;
        if (r.error) { t.q('Res').innerHTML = '<div class="aviso bad">' + esc(r.error.message) + '</div>'; return; }
        t.filas = r.data || [];
        t.total = r.count == null ? t.filas.length : r.count;
        t.pintarLista();
      });
  };

  Centros.prototype.pintarLista = function () {
    var t = this;
    var z = t.q('Res');
    if (!z) return;
    if (!t.filas.length) {
      z.innerHTML = '<div class="vacio"><b>' +
        (t.busca ? 'No hay ningún centro con «' + esc(t.busca) + '»'
                 : 'Todavía no hay centros registrados') + '</b>' +
        '<span>Regístralos con el botón de arriba: el CDI, los ambulatorios y los ' +
        'consultorios populares a los que se les despacha.</span></div>';
      return;
    }
    var paginas = Math.max(1, Math.ceil(t.total / POR_PAGINA));
    z.innerHTML =
      '<p class="conteo">' + num(t.total) + (t.total === 1 ? ' centro' : ' centros') +
        (paginas > 1 ? ' · página ' + (t.pagina + 1) + ' de ' + paginas : '') + '</p>' +
      '<div class="fichas">' + t.filas.map(function (x, n) {
        var sub = [x.tipo];
        if (x.responsable) sub.push(x.responsable);
        if (x.telefono) sub.push(x.telefono);
        return '<button type="button" class="ficha" data-c="' + n + '">' +
          '<div class="ficha-nom"><b>' + esc(x.nombre) + '</b>' +
            '<span class="ficha-pres">' + esc(sub.join(' · ')) + '</span>' +
            (x.direccion ? '<span class="ficha-pres">' + esc(x.direccion) + '</span>' : '') +
          '</div>' +
          '<div class="ficha-datos">' +
            '<span class="ficha-cant' + (x.insumos ? '' : ' cero') + '">' + x.insumos +
              '<em>' + (x.insumos === 1 ? 'insumo' : 'insumos') + '</em></span>' +
            '<span class="ficha-lotes">' + x.entregas +
              (x.entregas === 1 ? ' entrega' : ' entregas') + '</span>' +
            (x.unidades_recibidas
              ? '<span class="ficha-vence">' + num(x.unidades_recibidas) + ' unidades</span>'
              : '') +
          '</div>' +
          (x.activo ? '' : '<span class="sit gris">Inactivo</span>') +
        '</button>';
      }).join('') + '</div>' +
      (paginas > 1
        ? '<div class="paginador">' +
            '<button type="button" data-pag="-1"' + (t.pagina === 0 ? ' disabled' : '') + '>Anteriores</button>' +
            '<span>' + (t.pagina * POR_PAGINA + 1) + '–' +
              Math.min(t.total, (t.pagina + 1) * POR_PAGINA) + ' de ' + num(t.total) + '</span>' +
            '<button type="button" data-pag="1"' + (t.pagina >= paginas - 1 ? ' disabled' : '') + '>Siguientes</button>' +
          '</div>'
        : '');

    z.querySelectorAll('[data-c]').forEach(function (b) {
      b.addEventListener('click', function () { t.abrir(t.filas[+b.dataset.c]); });
    });
    z.querySelectorAll('[data-pag]').forEach(function (b) {
      b.addEventListener('click', function () { t.pagina += Number(b.dataset.pag); t.cargarLista(); });
    });
  };

  /* ================================================================
     FICHA DEL CENTRO
  ================================================================ */
  Centros.prototype.abrir = function (x) {
    var t = this;
    t.quien = x; t.modo = 'ficha'; t.abierto = false;
    t.insumos = null; t.recibido = null; t.fallo = null;
    t.pintar();
    t.cargarAnexos();
  };

  Centros.prototype.cargarAnexos = function () {
    var t = this, cid = t.quien.id;
    Promise.all([
      t.sb.from('v_requerimientos_institucion').select(CAMPOS_REQ)
        .eq('institucion_id', cid).order('producto', { nullsFirst: false }),
      t.sb.from('v_entregas_renglon')
        .select('entrega_id,fecha,cantidad,producto,dosificacion,en_cajas,lote,vence,' +
                'entregado_por,recibe_nombre,anulada')
        .eq('institucion_id', cid).order('fecha', { ascending: false }).limit(1000)
    ]).then(function (r) {
      if (!t.quien || t.quien.id !== cid || t.modo !== 'ficha') return;
      /* Un error NO es "no tiene nada": es "no se pudo preguntar". */
      t.insumos = r[0].error ? null : (r[0].data || []);
      t.recibido = r[1].error ? null : (r[1].data || []).filter(function (y) { return !y.anulada; });
      t.fallo = (r[0].error || r[1].error || {}).message || null;
      t.pintarFicha();
    });
  };

  Centros.prototype.pintarFicha = function () {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Zona');
    if (!z) return;
    var x = t.quien;

    z.innerHTML =
      '<div class="cabecera-prod">' +
        '<button type="button" class="volver" id="' + i('Volver') + '">← Volver a la lista</button>' +
        '<div class="prod-nom"><b>' + esc(x.nombre) + '</b>' +
          '<span>' + esc(x.tipo || 'Centro de salud') +
          (x.direccion ? ' · ' + esc(x.direccion) : '') + '</span></div>' +
        '<div class="prod-cifras">' +
          '<span><b>' + x.entregas + '</b> ' + (x.entregas === 1 ? 'entrega' : 'entregas') + '</span>' +
          '<span><b>' + num(x.unidades_recibidas) + '</b> unidades recibidas</span>' +
          (x.ultima_entrega ? '<span>última: <b>' + corta(x.ultima_entrega) + '</b></span>' : '') +
        '</div>' +
      '</div>' +

      t.bloqueInsumos() +
      t.bloqueRecibido() +

      '<h3 class="sub-t">Sus datos</h3>' +
      t.campos(x) +
      '<div class="botonera">' +
        '<button type="button" class="principal" id="' + i('Guardar') + '">Guardar los cambios</button>' +
      '</div>';

    t.q('Volver').addEventListener('click', function () {
      t.modo = 'lista'; t.quien = null; t.abierto = false; t.limpiaAviso(); t.pintar();
    });
    t.engancharCampos();
    t.q('Guardar').addEventListener('click', function () { t.guardarDatos(); });
    t.engancharInsumos();
    t.engancharRecibido();
  };

  /* ---------------------------------------------------------------- insumos */
  Centros.prototype.bloqueInsumos = function () {
    var t = this, i = function (n) { return t.id(n); };
    var f = t.insumos;

    if (f === null && !t.fallo) {
      return '<h3 class="sub-t">Insumos que necesita</h3>' +
             '<div class="cargando">Buscando…</div>';
    }
    if (f === null) {
      return '<h3 class="sub-t">Insumos que necesita</h3>' +
        '<div class="aviso bad">No se pudo leer su lista' + (t.fallo ? ': ' + esc(t.fallo) : '') +
        '. No quiere decir que no pida nada. Vuelve a abrir su ficha.</div>';
    }

    var faltan = f.filter(function (x) {
      return x.cobertura === 'no_alcanza' || x.cobertura === 'sin_existencia' ||
             x.cobertura === 'solo_vencido';
    }).length;
    /* Lo vencido se cuenta aparte: no es que falte, es que está ahí y
       no sirve. Hay que sacarlo del estante, no salir a comprarlo. */
    var venc = f.filter(function (x) { return x.cobertura === 'solo_vencido'; }).length;

    return '<h3 class="sub-t">Insumos que necesita</h3>' +
      '<p class="sub">Lo que suele pedir y cuánto. Al ir a entregarle, esta lista sale sola ' +
      'con las cantidades puestas. <b>La cantidad no descuenta nada</b>: es lo que suele ' +
      'necesitar, no lo que se le va a dar.</p>' +
      (faltan
        ? '<div class="aviso warn"><b>Hoy no hay con qué cubrir ' + faltan +
          (faltan === 1 ? ' renglón' : ' renglones') + '</b>' +
          'Están marcados abajo. Mejor saberlo antes de salir a repartir.</div>'
        : '') +
      (venc
        ? '<div class="aviso warn"><b>De ' + venc +
          (venc === 1 ? ' renglón solo queda lo vencido' : ' renglones solo queda lo vencido') +
          '</b>No se puede entregar. Hay existencia física, pero hay que darla ' +
          'de baja en Mercancía → Alertas.</div>'
        : '') +
      (f.length
        ? '<div class="tabla-caja"><table class="tabla datos"><thead><tr>' +
            '<th>Insumo</th><th class="der">Cuánto necesita</th>' +
            '<th class="der">Hay hoy</th><th>Situación</th><th></th>' +
          '</tr></thead><tbody>' +
          f.map(function (x, n) {
            var hay = Math.round(Number(x.disponible) || 0);
            return '<tr>' +
              '<td class="c-med" data-col="Insumo"><b>' +
                esc(x.producto || x.texto_original || '') + '</b>' +
                (x.dosificacion || x.presentacion
                  ? '<span class="chico">' +
                    esc([x.dosificacion, x.presentacion].filter(Boolean).join(' · ')) + '</span>'
                  : '') +
                (x.producto_id ? '' : '<span class="chico mal">escrito a mano, sin enlazar al catálogo</span>') +
              '</td>' +
              '<td class="num der" data-col="Cuánto necesita">' +
                '<input class="celda" type="number" min="1" step="1" inputmode="numeric" ' +
                  'aria-label="Cuánto necesita de ' + esc(x.producto || x.texto_original || '') + '" ' +
                  'data-cant="' + esc(x.requerimiento_id) + '" value="' +
                  (x.cantidad == null ? '' : Math.round(x.cantidad)) + '" placeholder="—"></td>' +
              '<td class="num der" data-col="Hay hoy">' +
                (x.producto_id
                  ? '<b' + (hay ? '' : ' class="cero"') + '>' + num(hay) + '</b>' +
                    (!hay && Number(x.vencido) > 0
                      ? '<span class="chico mal">' + num(x.vencido) + ' vencidas</span>' : '')
                  : '—') + '</td>' +
              '<td data-col="Situación">' + sit(x.cobertura) + '</td>' +
              '<td data-col=""><button type="button" class="quitar" data-quita="' +
                esc(x.requerimiento_id) + '">Quitar</button></td>' +
            '</tr>';
          }).join('') +
          '</tbody></table></div>'
        : '<p class="sub chico">Todavía no tiene ningún insumo en su lista.</p>') +
      (t.abierto
        ? window.FARMPICK.caja(i('Ins'), 'Buscar el insumo',
            'Escribe el nombre del insumo o medicamento…', '')
        : '<button type="button" class="trat-mas" id="' + i('MasIns') + '">+ Agregar un insumo a su lista</button>');
  };

  Centros.prototype.engancharInsumos = function () {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Zona');
    if (!z) return;

    var mas = t.q('MasIns');
    if (mas) mas.addEventListener('click', function () {
      t.abierto = true; t.pintarFicha();
      var c = t.q('InsBusca'); if (c) c.focus();
    });
    if (t.abierto) {
      window.FARMPICK.medicinas(t.sb, i('Ins'), function (x) { t.agregarInsumo(x); });
    }
    z.querySelectorAll('[data-quita]').forEach(function (b) {
      b.addEventListener('click', function () { t.quitarInsumo(b.dataset.quita); });
    });
    /* La cantidad se guarda al salir de la casilla. Se hace así y no con
       un botón porque son veinte renglones: obligar a guardar cada uno
       sería insufrible, y guardar todo de golpe esconde cuál falló. */
    z.querySelectorAll('[data-cant]').forEach(function (c) {
      c.addEventListener('change', function () { t.guardarCantidad(c); });
    });
  };

  Centros.prototype.agregarInsumo = function (x) {
    var t = this, cid = t.quien.id;
    var ya = (t.insumos || []).some(function (y) {
      if (x.producto_id && y.producto_id) return y.producto_id === x.producto_id;
      return window.FARMPICK.mismo(y.producto || y.texto_original, x.producto || x.texto_original);
    });
    if (ya) { t.aviso('warn', x.producto + ' ya estaba en su lista.'); return; }

    var fila = { institucion_id: cid, activo: true };
    if (x.producto_id) fila.producto_id = x.producto_id;
    else fila.texto_original = x.texto_original;

    t.sb.from('requerimientos_institucion').insert(fila).then(function (r) {
      if (r.error) {
        t.aviso('bad', r.error.code === '23505'
          ? x.producto + ' ya estaba en su lista.'
          : 'No se pudo agregar: ' + r.error.message);
        return;
      }
      t.recargar(function () {
        t.aviso('ok', x.producto + ' quedó en su lista. Ponle cuánto necesita.');
      });
    });
  };

  Centros.prototype.quitarInsumo = function (id) {
    var t = this, cid = t.quien.id;
    var x = (t.insumos || []).filter(function (y) { return String(y.requerimiento_id) === String(id); })[0];
    var nom = (x && (x.producto || x.texto_original)) || 'este insumo';
    if (!window.confirm('¿Quitar ' + nom + ' de la lista de ' + t.quien.nombre + '?\n\n' +
        'No borra ninguna entrega ya hecha. Queda registrado con tu nombre.')) return;

    t.sb.from('requerimientos_institucion').update({ activo: false }).eq('id', id).then(function (r) {
      if (r.error) { t.aviso('bad', 'No se pudo quitar: ' + r.error.message); return; }
      if (!t.quien || t.quien.id !== cid) return;
      t.recargar(function () { t.aviso('ok', 'Se quitó ' + nom + ' de su lista.'); });
    });
  };

  Centros.prototype.guardarCantidad = function (casilla) {
    var t = this;
    var id = casilla.dataset.cant;
    var v = casilla.value.trim();
    var n = v === '' ? null : Math.round(Number(v));
    if (v !== '' && (!isFinite(n) || n <= 0)) {
      t.aviso('warn', 'La cantidad tiene que ser un número mayor que cero.');
      casilla.focus();
      return;
    }
    casilla.disabled = true;
    t.sb.from('requerimientos_institucion').update({ cantidad: n }).eq('id', id).then(function (r) {
      casilla.disabled = false;
      if (r.error) { t.aviso('bad', 'No se pudo guardar la cantidad: ' + r.error.message); return; }
      /* Se vuelve a leer para que la columna de situación diga la verdad:
         puede haber pasado de "alcanza" a "no alcanza". */
      t.recargar(function () { t.aviso('ok', 'Cantidad guardada.'); });
    });
  };

  Centros.prototype.recargar = function (luego) {
    var t = this, cid = t.quien.id;
    t.abierto = false;
    t.sb.from('v_requerimientos_institucion').select(CAMPOS_REQ)
      .eq('institucion_id', cid).order('producto', { nullsFirst: false })
      .then(function (r) {
        if (!t.quien || t.quien.id !== cid) return;
        if (r.error) {
          t.pintarFicha();
          t.aviso('bad', 'Se guardó, pero no se pudo volver a leer la lista. Ábrela otra vez.');
          return;
        }
        t.insumos = r.data || [];
        t.quien.insumos = t.insumos.length;
        t.pintarFicha();
        if (luego) luego();
      });
  };

  /* ---------------------------------------------------------------- recibido */
  Centros.prototype.bloqueRecibido = function () {
    var t = this, i = function (n) { return t.id(n); };
    var f = t.recibido;

    if (f === null && !t.fallo) {
      return '<h3 class="sub-t">Lo que se le ha entregado</h3><div class="cargando">Buscando…</div>';
    }
    if (f === null) {
      return '<h3 class="sub-t">Lo que se le ha entregado</h3>' +
        '<div class="aviso bad">No se pudo leer su historial. Vuelve a abrir su ficha.</div>';
    }
    if (!f.length) {
      return '<h3 class="sub-t">Lo que se le ha entregado</h3>' +
        '<p class="sub chico">Todavía no se le ha entregado nada.</p>';
    }

    var porMed = {}, total = 0, entregas = {};
    f.forEach(function (x) {
      entregas[x.entrega_id] = 1;
      if (x.cantidad == null) return;
      var c = Number(x.cantidad) || 0;
      total += c;
      var k = x.producto || 'Sin identificar';
      var m = porMed[k] || (porMed[k] = { producto: k, dosificacion: x.dosificacion,
                                          unidades: 0, veces: 0, ultima: null });
      m.unidades += c; m.veces++;
      if (!m.ultima || x.fecha > m.ultima) m.ultima = x.fecha;
    });
    var lista = Object.keys(porMed).map(function (k) { return porMed[k]; })
      .sort(function (a, b) { return b.unidades - a.unidades; });

    t.resumenRecibido = { lista: lista, total: total, entregas: Object.keys(entregas).length };

    return '<h3 class="sub-t">Lo que se le ha entregado</h3>' +
      '<div class="cifras-linea">' +
        '<div class="cifra-linea"><b>' + num(t.resumenRecibido.entregas) + '</b><span>' +
          (t.resumenRecibido.entregas === 1 ? 'entrega' : 'entregas') + '</span></div>' +
        '<div class="cifra-linea"><b>' + num(lista.length) + '</b><span>' +
          (lista.length === 1 ? 'insumo distinto' : 'insumos distintos') + '</span></div>' +
        '<div class="cifra-linea ok"><b>' + num(total) + '</b><span>unidades en total</span></div>' +
      '</div>' +
      '<div class="descargas">' +
        '<button type="button" id="' + i('Excel') + '">Descargar en Excel</button>' +
        '<button type="button" id="' + i('Pdf') + '">Descargar en PDF</button>' +
      '</div>' +
      '<div class="tabla-caja"><table class="tabla datos"><thead><tr>' +
        '<th>Insumo</th><th class="der">Unidades</th><th class="der">Veces</th>' +
        '<th>Última vez</th>' +
      '</tr></thead><tbody>' +
      lista.map(function (m) {
        return '<tr>' +
          '<td class="c-med" data-col="Insumo"><b>' + esc(m.producto) + '</b>' +
            (m.dosificacion ? '<span class="chico">' + esc(m.dosificacion) + '</span>' : '') + '</td>' +
          '<td class="num der" data-col="Unidades"><b>' + num(m.unidades) + '</b></td>' +
          '<td class="num der" data-col="Veces">' + m.veces + '</td>' +
          '<td data-col="Última vez">' + corta(m.ultima) + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  };

  Centros.prototype.engancharRecibido = function () {
    var t = this;
    var e = t.q('Excel'), p = t.q('Pdf');
    if (e) e.addEventListener('click', function () { t.bajar('excel'); });
    if (p) p.addEventListener('click', function () { t.bajar('pdf'); });
  };

  Centros.prototype.bajar = function (formato) {
    var t = this;
    if (!window.FARMREP || !t.resumenRecibido) return;
    var r = t.resumenRecibido;
    var x = t.quien;
    var titulo = 'Entregas a ' + x.nombre;

    var encRes = ['Insumo', 'Unidades', 'Veces', 'Última vez'];
    var filRes = r.lista.map(function (m) {
      return [m.producto, Math.round(m.unidades), m.veces, corta(m.ultima)];
    });
    var encDet = ['Día', 'Insumo', 'Dosificación', 'Lote', 'Vence', 'Cantidad', 'Recibió', 'Despachó'];
    var filDet = (t.recibido || []).filter(function (y) { return y.cantidad != null; })
      .map(function (y) {
        return [corta(y.fecha), y.producto || '', y.dosificacion || '', y.lote || 'sin número',
                corta(y.vence), Math.round(Number(y.cantidad) || 0),
                y.recibe_nombre || '', y.entregado_por || ''];
      });

    if (formato === 'excel') {
      window.FARMREP.excel(titulo, [
        { nombre: 'Por insumo', titulo: titulo + ' · resumen por insumo',
          encabezados: encRes, filas: filRes, anchos: [42, 12, 10, 14] },
        { nombre: 'Detalle', titulo: titulo + ' · renglón por renglón',
          encabezados: encDet, filas: filDet, anchos: [12, 40, 16, 16, 12, 11, 26, 26] }
      ]);
      return;
    }

    /* Los anchos suman 245 mm. En carta horizontal caben 251: si se pasan,
       autoTable no avisa, recorta o desborda la hoja. */
    window.FARMREP.pdfInforme({
      titulo: 'Entregas al Centro de Salud',
      subtitulo: x.nombre + (x.tipo ? ' · ' + x.tipo : ''),
      resumen: [
        { k: r.entregas === 1 ? 'Entrega' : 'Entregas', v: num(r.entregas) },
        { k: 'Insumos distintos', v: num(r.lista.length) },
        { k: 'Unidades en total', v: num(r.total) },
        { k: 'Última entrega', v: corta(x.ultima_entrega) || '—' }
      ],
      bloques: [
        { titulo: 'Por insumo', encabezados: encRes, filas: filRes,
          pie: ['TOTAL', Math.round(r.total), '', ''],
          columnas: { 0: { cellWidth: 120 }, 1: { cellWidth: 30, halign: 'right' },
                      2: { cellWidth: 24, halign: 'right' }, 3: { cellWidth: 30 } } },
        { titulo: 'Renglón por renglón', encabezados: encDet, filas: filDet,
          columnas: { 0: { cellWidth: 20 }, 1: { cellWidth: 58 }, 2: { cellWidth: 24 },
                      3: { cellWidth: 24 }, 4: { cellWidth: 20 },
                      5: { cellWidth: 19, halign: 'right' },
                      6: { cellWidth: 40 }, 7: { cellWidth: 40 } } }
      ],
      horizontal: true, archivo: titulo,
      vacio: 'Todavía no se le ha entregado nada.'
    });
  };

  /* ================================================================
     LOS DATOS DEL CENTRO
  ================================================================ */
  Centros.prototype.campos = function (x) {
    var t = this, i = function (n) { return t.id(n); };
    x = x || {};
    return '' +
      '<label for="' + i('Nombre') + '">Nombre del centro</label>' +
      '<input id="' + i('Nombre') + '" type="text" autocomplete="off" ' +
        'placeholder="CDI Mamá Pancha" value="' + esc(x.nombre || '') + '">' +

      '<div class="dos-columnas">' +
        '<div><label for="' + i('Tipo') + '">Qué tipo de centro es</label>' +
          '<select id="' + i('Tipo') + '">' + TIPOS.map(function (v) {
            return '<option value="' + esc(v) + '"' +
              ((x.tipo || 'CDI') === v ? ' selected' : '') + '>' + esc(v) + '</option>';
          }).join('') + '</select></div>' +
        '<div><label for="' + i('Telefono') + '">Teléfono <span class="opc">(opcional)</span></label>' +
          '<input id="' + i('Telefono') + '" type="tel" inputmode="tel" autocomplete="off" ' +
          'placeholder="0239-1234567" value="' + esc(x.telefono || '') + '"></div>' +
      '</div>' +

      '<label for="' + i('Direccion') + '">Dirección</label>' +
      '<input id="' + i('Direccion') + '" type="text" autocomplete="off" ' +
        'placeholder="Sector, avenida, punto de referencia" value="' + esc(x.direccion || '') + '">' +

      '<label for="' + i('Responsable') + '">Responsable <span class="opc">(quien suele recibir)</span></label>' +
      '<input id="' + i('Responsable') + '" type="text" autocomplete="off" ' +
        'placeholder="Nombre y apellido" value="' + esc(x.responsable || '') + '">';
  };

  Centros.prototype.engancharCampos = function () { /* nada que enganchar por ahora */ };

  Centros.prototype.leerCampos = function () {
    var t = this;
    return {
      nombre: t.q('Nombre').value.trim().replace(/\s+/g, ' '),
      tipo: t.q('Tipo').value,
      direccion: t.q('Direccion').value.trim() || null,
      responsable: t.q('Responsable').value.trim() || null,
      telefono: t.q('Telefono').value.trim() || null
    };
  };

  Centros.prototype.guardarDatos = function () {
    var t = this;
    var d = t.leerCampos();
    if (d.nombre.length < 4) { t.aviso('warn', 'Escribe el nombre completo del centro.'); return; }

    var btn = t.q('Guardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    t.sb.from('instituciones').update(d).eq('id', t.quien.id).then(function (r) {
      btn.disabled = false; btn.textContent = 'Guardar los cambios';
      if (r.error) {
        t.aviso('bad', r.error.code === '23505'
          ? 'Ya hay otro centro registrado con ese nombre.'
          : 'No se pudo guardar: ' + r.error.message);
        return;
      }
      t.sb.from('v_instituciones_ficha').select(CAMPOS).eq('id', t.quien.id).single()
        .then(function (f) {
          if (f.data) t.quien = f.data;
          t.pintarFicha();
          t.aviso('ok', 'Los datos de ' + t.quien.nombre + ' quedaron guardados.');
        });
    });
  };

  /* ================================================================
     REGISTRAR UN CENTRO NUEVO
  ================================================================ */
  Centros.prototype.verFormulario = function () {
    var t = this, i = function (n) { return t.id(n); };
    t.q('Zona').innerHTML =
      '<div class="cabecera-prod">' +
        '<button type="button" class="volver" id="' + i('Volver') + '">← Volver a la lista</button>' +
        '<div class="prod-nom"><b>Registrar un centro de salud</b>' +
          '<span>Los CDI, ambulatorios y consultorios populares a los que se despacha. ' +
          'Se registran una vez y quedan para las siguientes entregas.</span></div>' +
      '</div>' +
      t.campos(null) +

      '<h3 class="sub-t">Insumos que necesita <span class="opc">(opcional)</span></h3>' +
      '<p class="sub">Su lista habitual. Las cantidades se ponen después, en su ficha.</p>' +
      '<div id="' + i('ListaPend') + '"></div>' +
      window.FARMPICK.caja(i('Ins'), 'Buscar el insumo',
        'Escribe el nombre del insumo o medicamento…', '') +

      '<div class="botonera">' +
        '<button type="button" class="principal" id="' + i('Crear') + '">Registrar el centro</button>' +
        '<button type="button" class="secundario" id="' + i('Cancelar') + '">Cancelar</button>' +
      '</div>';

    t.q('Volver').addEventListener('click', function () { t.aLaLista(); });
    t.q('Cancelar').addEventListener('click', function () { t.aLaLista(); });
    t.pintarPendientes();
    window.FARMPICK.medicinas(t.sb, i('Ins'), function (x) {
      if (t.pendientes.some(function (y) {
        if (x.producto_id && y.producto_id) return y.producto_id === x.producto_id;
        return window.FARMPICK.mismo(y.producto, x.producto);
      })) return;
      t.pendientes.push(x);
      t.pintarPendientes();
    });
    t.q('Crear').addEventListener('click', function () { t.crear(); });
  };

  Centros.prototype.aLaLista = function () {
    this.modo = 'lista'; this.quien = null; this.abierto = false;
    this.pendientes = []; this.limpiaAviso(); this.pintar();
  };

  Centros.prototype.pintarPendientes = function () {
    var t = this;
    var z = t.q('ListaPend');
    if (!z) return;
    if (!t.pendientes.length) {
      z.innerHTML = '<p class="sub chico">Todavía no has agregado ninguno. ' +
        'Se puede registrar el centro sin esto y armarle la lista después.</p>';
      return;
    }
    z.innerHTML = '<div class="trat-lista">' + t.pendientes.map(function (x, n) {
      return '<span class="trat-par"><span class="trat-texto del-catalogo">' +
        esc(x.producto) + (x.producto_id ? '' : ' <em class="a-mano">a mano</em>') + '</span>' +
        '<button type="button" class="trat-quita" data-n="' + n + '" ' +
        'aria-label="Quitar ' + esc(x.producto) + '">&#10005;</button></span>';
    }).join('') + '</div>' +
    '<p class="sub chico">' + t.pendientes.length +
      (t.pendientes.length === 1 ? ' insumo anotado' : ' insumos anotados') + '.</p>';
    z.querySelectorAll('[data-n]').forEach(function (b) {
      b.addEventListener('click', function () {
        t.pendientes.splice(+b.dataset.n, 1); t.pintarPendientes();
      });
    });
  };

  Centros.prototype.crear = function () {
    var t = this;
    var d = t.leerCampos();
    if (d.nombre.length < 4) { t.aviso('warn', 'Escribe el nombre completo del centro.'); return; }

    var btn = t.q('Crear');
    btn.disabled = true; btn.textContent = 'Registrando…';
    d.activo = true;

    t.sb.from('instituciones').insert(d).select().single().then(function (r) {
      if (r.error) {
        btn.disabled = false; btn.textContent = 'Registrar el centro';
        t.aviso(r.error.code === '23505' ? 'warn' : 'bad',
          r.error.code === '23505'
            ? 'Ya hay un centro registrado con ese nombre. Búscalo en la lista.'
            : 'No se pudo registrar: ' + r.error.message);
        return;
      }
      var cid = r.data.id;
      var reqs = t.pendientes.map(function (x) {
        var fila = { institucion_id: cid, activo: true };
        if (x.producto_id) fila.producto_id = x.producto_id;
        else fila.texto_original = x.texto_original;
        return fila;
      });
      var guarda = reqs.length
        ? t.sb.from('requerimientos_institucion').insert(reqs)
        : Promise.resolve({});

      guarda.then(function (rr) {
        btn.disabled = false; btn.textContent = 'Registrar el centro';
        /* Nunca se dice "guardado" de lo que el servidor no confirmó. */
        var fallo = rr && rr.error ? rr.error.message : null;
        var n = reqs.length;
        t.pendientes = [];
        t.sb.from('v_instituciones_ficha').select(CAMPOS).eq('id', cid).single().then(function (f) {
          t.quien = f.data || r.data;
          t.modo = 'ficha'; t.abierto = false;
          t.insumos = null; t.recibido = null; t.fallo = null;
          t.pintar();
          t.cargarAnexos();
          if (fallo) {
            t.aviso('warn', 'El centro quedó registrado, pero NO se guardó su lista de ' +
              'insumos (' + fallo + '). Agrégalos otra vez aquí abajo.');
          } else {
            t.aviso('ok', d.nombre + ' quedó registrado' +
              (n ? ' con ' + n + (n === 1 ? ' insumo' : ' insumos') + ' en su lista. ' +
                   'Ponles cuánto necesita.' : '.'));
          }
        });
      });
    });
  };

  /* ---------------------------------------------------------------- entrada */
  window.PANTALLA_CENTROS = function (cliente, contenedor, opciones) {
    var o = opciones || {};
    var t = new Centros(cliente, contenedor, o.prefijo || 'ce');
    t.pintar();
    return t;
  };
})();
