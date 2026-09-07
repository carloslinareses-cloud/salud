/* MERCANCÍA: lo que llega, las alertas y el conteo físico.

   Tres pantallas:
     · Alertas        — qué está vencido o por vencerse.
     · Catálogo       — todo el catálogo, con su existencia a la vista.
                        Desde aquí se registra lo que llega, sumando a un
                        lote que ya existe o abriendo uno nuevo.
     · Conteo         — una hoja tipo Excel para corregir muchas
                        existencias de una vez.

   Todo se lee por la API REST y se pagina de 50 en 50: el catálogo tiene
   441 medicamentos y 472 lotes, y traerlos todos de golpe hace lenta la
   pantalla en un teléfono. */
(function () {
  'use strict';

  var sb = null, ancla = null, pestana = 'cargar';
  var POR_PAGINA = 50;

  /* Lo que se está viendo en cada pantalla. Se guarda aquí para que al
     volver de registrar una entrada no se pierda el filtro ni la página. */
  /* `modo` dice si se está viendo la lista o la ficha de un medicamento.
     Sin esto, una carga de la lista que llegaba tarde repintaba los 50
     renglones encima del formulario que la persona acababa de abrir. */
  var cat  = { filtro: 'todos', busca: '', pagina: 0, total: 0, filas: [],
               cargando: false, modo: 'lista' };
  var hoja = { filtro: 'con',   busca: '', pagina: 0, total: 0, filas: [], cambios: {}, cargando: false };

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fecha(f) {
    if (!f) return 'sin fecha';
    var p = String(f).slice(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  function num(n) {
    var v = Math.round(Number(n) || 0);
    return v.toLocaleString('es-VE');
  }
  function retardo(fn, ms) {
    var t; return function () { var a = arguments, s = this;
      clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  }
  function sinAcentos(t) {
    return window.FARM && window.FARM.sinAcentos
      ? window.FARM.sinAcentos(t)
      : String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  }
  function aviso(clase, texto) {
    var z = document.getElementById('avisoInv');
    if (z) z.innerHTML = '<div class="aviso ' + clase + '">' + esc(texto) + '</div>';
  }
  function limpiaAviso() {
    var z = document.getElementById('avisoInv');
    if (z) z.innerHTML = '';
  }

  /* Cada situación con su palabra y su color. Se usa igual en las tres
     pantallas para que el mismo color signifique siempre lo mismo. */
  var SITUACION = {
    vencido:        { txt: 'Vencido',        cl: 'mal' },
    solo_vencido:   { txt: 'Solo vencido',   cl: 'mal' },
    por_vencer_30:  { txt: 'Vence en 30 días', cl: 'ojo' },
    por_vencer_90:  { txt: 'Vence en 90 días', cl: 'ojo' },
    bajo_minimo:    { txt: 'Bajo el mínimo', cl: 'ojo' },
    sin_existencia: { txt: 'Sin existencia', cl: 'gris' },
    sin_fecha:      { txt: 'Sin vencimiento', cl: 'gris' },
    vigente:        { txt: 'Vigente',        cl: 'ok' },
    bien:           { txt: 'Con existencia', cl: 'ok' }
  };
  function sit(s) {
    var m = SITUACION[s] || { txt: s || '', cl: 'gris' };
    return '<span class="sit ' + m.cl + '">' + esc(m.txt) + '</span>';
  }

  /* ================================================================ */
  function pintar() {
    ancla.innerHTML =
      '<div class="tarjeta">' +
        '<div class="conmuta">' +
          '<button type="button" data-p="cargar">Registrar lo que llega</button>' +
          '<button type="button" data-p="catalogo">Catálogo</button>' +
          '<button type="button" data-p="alertas">Alertas</button>' +
          '<button type="button" data-p="personas">Personas</button>' +
          '<button type="button" data-p="centros">Centros</button>' +
          '<button type="button" data-p="entregas">Lo entregado</button>' +
          '<button type="button" data-p="conteo">Corregir existencia</button>' +
        '</div>' +
        '<div id="zonaInv"></div>' +
        '<div id="avisoInv"></div>' +
      '</div>';
    ancla.querySelectorAll('.conmuta button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.p === pestana);
      b.addEventListener('click', function () {
        if (pestana === b.dataset.p) return;
        pestana = b.dataset.p; pintar();
      });
    });
    if (pestana === 'cargar') verCargar();
    else if (pestana === 'alertas') verAlertas();
    else if (pestana === 'catalogo') verCatalogo();
    else if (pestana === 'entregas') verEntregas();
    else if (pestana === 'personas') verPersonas();
    else if (pestana === 'centros') verCentros();
    else verConteo();
  }

  /* El tablero de lo que salió. Es el mismo módulo que usa el panel del
     administrador; aquí se monta con su propio prefijo porque las dos
     copias conviven en la página y los identificadores chocarían. */
  /* Las fichas de la gente: sus datos, sus patologias y lo que necesita.
     Esta aqui, al lado de lo que se carga a mano, porque es trabajo de la
     misma clase: pasar el cuaderno al sistema. */
  function verPersonas() {
    var z = document.getElementById('zonaInv');
    if (typeof window.PANTALLA_PERSONAS !== 'function') {
      z.innerHTML = '<div class="aviso warn">La pantalla de personas todavía se está ' +
                    'cargando. Vuelve a entrar en unos segundos.</div>';
      return;
    }
    window.PANTALLA_PERSONAS(sb, z, { prefijo: 'pe' });
  }

  /* Los CDI, ambulatorios y consultorios: sus datos, la lista de insumos
     que necesitan y todo lo que se les ha entregado. */
  function verCentros() {
    var z = document.getElementById('zonaInv');
    if (typeof window.PANTALLA_CENTROS !== 'function') {
      z.innerHTML = '<div class="aviso warn">La pantalla de centros todavía se está ' +
                    'cargando. Vuelve a entrar en unos segundos.</div>';
      return;
    }
    window.PANTALLA_CENTROS(sb, z, { prefijo: 'ce' });
  }

  function verEntregas() {
    var z = document.getElementById('zonaInv');
    if (typeof window.TABLERO_ENTREGAS !== 'function') {
      z.innerHTML = '<div class="aviso warn">El tablero de entregas todavía se está cargando. ' +
                    'Vuelve a entrar en unos segundos.</div>';
      return;
    }
    window.TABLERO_ENTREGAS(sb, z, { prefijo: 'inv' });
  }

  /* ================================================================
     ALERTAS
  ================================================================ */
  function verAlertas() {
    var z = document.getElementById('zonaInv');
    z.innerHTML = '<div class="cargando">Revisando el inventario…</div>';

    sb.from('v_alertas').select('*').order('vence').limit(500).then(function (r) {
      if (!document.getElementById('zonaInv')) return;
      if (r.error) { z.innerHTML = '<div class="aviso bad">' + esc(r.error.message) + '</div>'; return; }
      var f = r.data || [];
      var venc = f.filter(function (x) { return x.tipo === 'vencido'; });
      var p30  = f.filter(function (x) { return x.tipo === 'por_vencer_30'; });
      var p90  = f.filter(function (x) { return x.tipo === 'por_vencer_90'; });
      var suma = function (a) { return a.reduce(function (s, x) { return s + Number(x.existencia || 0); }, 0); };

      z.innerHTML =
        (f.length ? '<div class="descargas">' +
          '<button type="button" id="alExcel">Descargar las alertas en Excel</button>' +
          '<button type="button" id="alPdf">Descargar en PDF</button></div>' : '') +
        '<div class="cifras">' +
          tarjeta(venc.length, 'Lotes vencidos', 'alerta') +
          tarjeta(num(suma(venc)), 'Unidades vencidas', 'alerta') +
          tarjeta(p30.length, 'Lotes que vencen en 30 días', p30.length ? 'alerta' : '') +
          tarjeta(p90.length, 'Lotes que vencen en 90 días', '') +
        '</div>' +
        bloque('Vencidos — no se pueden entregar', venc, true) +
        bloque('Vencen dentro de 30 días', p30, false) +
        bloque('Vencen dentro de 90 días', p90, false);

      z.querySelectorAll('[data-baja]').forEach(function (b) {
        b.addEventListener('click', function () {
          darDeBaja(b.dataset.baja, b.dataset.nombre, b.dataset.cant);
        });
      });

      var comoEs = { vencido: 'Vencido', por_vencer_30: 'Vence en 30 días',
                     por_vencer_90: 'Vence en 90 días' };
      var enc = ['Situación', 'Medicamento', 'Dosificación', 'Lote', 'Vence', 'Unidades'];
      var filas = f.map(function (x) {
        return [comoEs[x.tipo] || x.tipo, x.producto, x.dosificacion || '',
                x.lote || 'sin número', window.FARMREP.fechaCorta(x.vence),
                Math.round(Number(x.existencia) || 0)];
      });
      var bE = document.getElementById('alExcel');
      if (bE) bE.addEventListener('click', function () {
        window.FARMREP.excel('Alertas de vencimiento - Farmacia Municipal',
          [{ nombre: 'Alertas', titulo: 'Alertas de vencimiento · Farmacia Municipal',
             encabezados: enc, filas: filas, anchos: [18, 40, 16, 16, 14, 12] }]);
      });
      var bP = document.getElementById('alPdf');
      if (bP) bP.addEventListener('click', function () {
        window.FARMREP.pdfTabla({
          titulo: 'Alertas de Vencimiento',
          subtitulo: venc.length + ' lotes vencidos · ' + p30.length + ' vencen en 30 días · ' +
                     p90.length + ' vencen en 90 días',
          encabezados: enc, filas: filas, horizontal: false,
          archivo: 'Alertas de vencimiento - Farmacia Municipal',
          columnas: { 0: { cellWidth: 26 }, 1: { cellWidth: 64 }, 2: { cellWidth: 24 },
                      3: { cellWidth: 26 }, 4: { cellWidth: 22, halign: 'center' },
                      5: { cellWidth: 20, halign: 'right' } }
        });
      });
    });
  }

  function tarjeta(n, txt, clase) {
    return '<div class="cifra ' + (clase || '') + '"><b>' + n + '</b><span>' + txt + '</span></div>';
  }

  function bloque(titulo, filas, conBaja) {
    if (!filas.length) return '';
    return '<h2 class="sub-t">' + titulo + '</h2>' +
      '<div class="renglones">' + filas.map(function (x) {
        return '<div class="renglon">' +
          '<div class="que"><b>' + esc(x.producto) + (x.dosificacion ? ' ' + esc(x.dosificacion) : '') + '</b>' +
          '<span>lote ' + esc(x.lote || 'sin número') + ' · vence ' + fecha(x.vence) +
          ' · ' + num(x.existencia) + ' unidades</span></div>' +
          (conBaja ? '<button type="button" class="quitar" data-baja="' + x.lote_id + '" ' +
            'data-nombre="' + esc(x.producto) + '" data-cant="' + Math.round(x.existencia) + '">Dar de baja</button>' : '') +
        '</div>';
      }).join('') + '</div>';
  }

  function darDeBaja(loteId, nombre, cant) {
    if (!window.confirm('¿Dar de baja ' + cant + ' unidades de ' + nombre + '?\n\n' +
        'Se descuentan del inventario y queda registrado con tu nombre. No se puede deshacer.')) return;
    sb.from('movimientos').insert({
      lote_id: loteId, tipo: 'baja', cantidad: -Math.abs(Number(cant)),
      motivo: 'Baja por vencimiento', origen: 'sistema'
    }).then(function (r) {
      if (r.error) { aviso('bad', 'No se pudo: ' + r.error.message); return; }
      return sb.from('lotes').update({ estado: 'dado_de_baja' }).eq('id', loteId).then(function () {
        aviso('ok', 'Dadas de baja ' + cant + ' unidades de ' + nombre + '. Quedó registrado.');
        verAlertas();
      });
    });
  }

  /* ================================================================
     CARGAR — una sola pantalla, cinco datos

     Es la pantalla que más se usa cuando se está montando el inventario:
     se escribe lo que hay en la caja y se guarda. El sistema hace solo lo
     demás: si el insumo no está en el catálogo lo crea, si el lote es
     nuevo lo abre, y si ese lote ya existía le suma.
  ================================================================ */
  var ultimo = null;   // lo último que se cargó, para poder repetirlo

  function verCargar() {
    var z = document.getElementById('zonaInv');
    z.innerHTML =
      '<h2 class="sub-t">Registrar lo que llega</h2>' +
      '<p class="sub">Escribe lo que dice la caja y guarda. Si el insumo no está en el ' +
      'catálogo se crea solo; si el lote ya existía, se le suma.</p>' +

      '<label for="rInsumo">Insumo</label>' +
      '<input id="rInsumo" type="text" autocomplete="off" ' +
        'placeholder="LOSARTAN POTÁSICO">' +
      '<div id="rParecidos"></div>' +

      '<label for="rPres">Presentación y componentes</label>' +
      '<input id="rPres" type="text" autocomplete="off" ' +
        'placeholder="Caja de 30 tabletas de 50 mg">' +

      '<div class="dos-columnas">' +
        '<div>' +
          '<label for="rLote">Lote</label>' +
          '<input id="rLote" type="text" autocomplete="off" ' +
            'placeholder="Como viene impreso">' +
        '</div>' +
        '<div>' +
          '<label for="rVence">Fecha de vencimiento</label>' +
          '<input id="rVence" type="date">' +
        '</div>' +
      '</div>' +
      '<p class="sub chico" id="rAvisoV"></p>' +

      '<label for="rCant">Cantidad</label>' +
      '<input id="rCant" type="number" min="1" inputmode="numeric" autocomplete="off" ' +
        'placeholder="Cuántas unidades llegaron">' +

      '<div class="botonera">' +
        '<button type="button" class="principal" id="rGuardar">Registrar</button>' +
      '</div>' +
      '<div id="rUltimo"></div>';

    var iIns = document.getElementById('rInsumo');
    var iVen = document.getElementById('rVence');
    iIns.focus();

    /* Mientras se escribe el nombre, se avisa si ya está en el catálogo:
       así no se carga el mismo insumo dos veces con nombres parecidos, que
       es lo que parte la existencia en dos. */
    iIns.addEventListener('input', retardo(function () {
      var z2 = document.getElementById('rParecidos');
      if (!z2) return;
      var v = iIns.value.trim();
      if (v.length < 3) { z2.innerHTML = ''; return; }
      sb.from('v_catalogo')
        .select('producto_id,producto,presentacion,disponible,en_cajas')
        .ilike('busqueda', '*' + sinAcentos(v) + '*').limit(4)
        .then(function (r) {
          var z3 = document.getElementById('rParecidos');
          if (!z3) return;
          var f = r.data || [];
          if (!f.length) {
            z3.innerHTML = '<p class="sub chico"><span class="ok-txt">Es nuevo: se va a crear ' +
              'en el catálogo.</span></p>';
            return;
          }
          z3.innerHTML = '<p class="sub chico"><span class="ojo">Ya está en el catálogo:</span> ' +
            f.map(function (x, i) {
              return '<button type="button" class="enlace" data-usa="' + i + '">' +
                     esc(x.producto) + '</button>';
            }).join(' · ') + ' — tócalo para usarlo tal cual.</p>';
          z3.querySelectorAll('[data-usa]').forEach(function (b) {
            b.addEventListener('click', function () {
              var x = f[+b.dataset.usa];
              iIns.value = x.producto;
              if (x.presentacion) document.getElementById('rPres').value = x.presentacion;
              document.getElementById('rParecidos').innerHTML =
                '<p class="sub chico"><span class="ok-txt">Se le sumará a «' + esc(x.producto) +
                '», que ya tiene ' + num(x.disponible) + ' unidades.</span></p>';
              document.getElementById('rLote').focus();
            });
          });
        });
    }, 350));

    iVen.addEventListener('change', function () {
      var av = document.getElementById('rAvisoV');
      if (!iVen.value) { av.innerHTML = ''; return; }
      av.innerHTML = iVen.value < (window.FARM && window.FARM.hoyCaracas ? window.FARM.hoyCaracas() : new Date().toISOString().slice(0, 10))
        ? '<span class="mal">Esa fecha ya pasó: entraría vencido y no se podrá entregar.</span>'
        : '';
    });

    /* Enter pasa al siguiente campo, para cargar sin soltar el teclado. */
    ['rInsumo', 'rPres', 'rLote', 'rVence', 'rCant'].forEach(function (id, i, todos) {
      var e = document.getElementById(id);
      e.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        if (i + 1 < todos.length) document.getElementById(todos[i + 1]).focus();
        else document.getElementById('rGuardar').click();
      });
    });

    document.getElementById('rGuardar').addEventListener('click', guardarRapido);
    pintarUltimo();
  }

  function pintarUltimo() {
    var z = document.getElementById('rUltimo');
    if (!z || !ultimo) return;
    z.innerHTML =
      '<div class="ultimo-cargado">' +
        '<span class="lbl">Lo último que cargaste</span>' +
        '<b>' + esc(ultimo.insumo) + '</b>' +
        '<span>' + (ultimo.pres ? esc(ultimo.pres) + ' · ' : '') +
          'lote ' + esc(ultimo.lote || 'sin número') + ' · vence ' + fecha(ultimo.vence) +
          ' · ' + num(ultimo.cantidad) + ' unidades</span>' +
        '<button type="button" class="suave" id="rOtroIgual">Cargar otro lote de este mismo</button>' +
      '</div>';
    document.getElementById('rOtroIgual').addEventListener('click', function () {
      document.getElementById('rInsumo').value = ultimo.insumo;
      document.getElementById('rPres').value = ultimo.pres || '';
      document.getElementById('rLote').value = '';
      document.getElementById('rVence').value = '';
      document.getElementById('rCant').value = '';
      document.getElementById('rParecidos').innerHTML = '';
      document.getElementById('rLote').focus();
    });
  }

  function guardarRapido() {
    var insumo = document.getElementById('rInsumo').value.trim().replace(/\s+/g, ' ');
    var pres   = document.getElementById('rPres').value.trim() || null;
    var lote   = document.getElementById('rLote').value.trim() || null;
    var vence  = document.getElementById('rVence').value || null;
    var cant   = parseInt(document.getElementById('rCant').value, 10);

    if (insumo.length < 3) {
      aviso('warn', 'Escribe el nombre del insumo.');
      document.getElementById('rInsumo').focus(); return;
    }
    if (!cant || cant < 1) {
      aviso('warn', 'Falta la cantidad.');
      document.getElementById('rCant').focus(); return;
    }
    if (!vence && !window.confirm('No pusiste fecha de vencimiento.\n\n' +
        'Sin ella el sistema no puede avisar cuándo se vence ni sacar primero el que ' +
        'vence antes. ¿Registrar igual?')) return;

    var btn = document.getElementById('rGuardar');
    btn.disabled = true; btn.textContent = 'Registrando…';
    function falla(msg) {
      aviso('bad', msg);
      btn.disabled = false; btn.textContent = 'Registrar';
    }

    /* 1. El insumo: se busca por nombre exacto; si no está, se crea. */
    sb.from('productos').select('id,nombre,presentacion').ilike('nombre', insumo).limit(1)
      .then(function (r) {
        if (r.error) throw r.error;
        if (r.data && r.data.length) return r.data[0];
        return sb.from('productos').insert({
          nombre: insumo, presentacion: pres, categoria: 'medicamento',
          unidad: 'unidad', stock_minimo: 0, activo: true
        }).select().single().then(function (rr) {
          if (rr.error) throw rr.error;
          return rr.data;
        });
      })
      /* 2. El lote: si ese producto ya tiene ese lote con esa fecha, se
            reutiliza en vez de abrir otro igual. */
      .then(function (prod) {
        var q = sb.from('lotes').select('id').eq('producto_id', prod.id);
        q = lote ? q.ilike('codigo', lote) : q.is('codigo', null);
        q = vence ? q.eq('vence', vence) : q.is('vence', null);
        return q.limit(1).then(function (r) {
          if (r.error) throw r.error;
          if (r.data && r.data.length) return { prod: prod, lote: r.data[0], nuevo: false };
          return sb.from('lotes').insert({ producto_id: prod.id, codigo: lote, vence: vence })
            .select().single().then(function (rr) {
              if (rr.error) throw rr.error;
              return { prod: prod, lote: rr.data, nuevo: true };
            });
        });
      })
      /* 3. La entrada. */
      .then(function (x) {
        return sb.from('movimientos').insert({
          lote_id: x.lote.id, tipo: 'entrada', cantidad: cant,
          motivo: 'Carga de inventario', origen: 'sistema'
        }).then(function (r) {
          if (r.error) throw r.error;
          return x;
        });
      })
      .then(function (x) {
        aviso('ok', 'Registradas ' + num(cant) + ' unidades de ' + x.prod.nombre +
                    (lote ? ' (lote ' + lote + ')' : '') +
                    (x.nuevo ? '.' : '. Se le sumaron a un lote que ya existía.'));
        ultimo = { insumo: x.prod.nombre, pres: pres, lote: lote, vence: vence, cantidad: cant };
        verCargar();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
      .catch(function (e) {
        falla('No se pudo registrar: ' + (e.message || e));
      });
  }

  /* ================================================================
     CATÁLOGO — para consultar lo que hay
  ================================================================ */
  var FILTROS_CAT = [
    { id: 'todos',    txt: 'Todos' },
    { id: 'con',      txt: 'Con existencia' },
    { id: 'sin',      txt: 'Sin existencia' },
    { id: 'vence',    txt: 'Por vencerse' },
    { id: 'vencido',  txt: 'Solo vencido' }
  ];

  function verCatalogo() {
    var z = document.getElementById('zonaInv');
    z.innerHTML =
      '<div id="catCifras" class="cifras-linea"></div>' +
      '<div class="herr-der">' +
        '<input id="catBusca" type="search" autocomplete="off" aria-label="Buscar en el catálogo" ' +
          'placeholder="Buscar medicamento o insumo…">' +
        '<button type="button" class="secundario" id="catCrear">+ Registrar medicamento</button>' +
      '</div>' +
      '<div class="chips" id="catFiltros">' + FILTROS_CAT.map(function (f) {
        return '<button type="button" data-f="' + f.id + '">' + f.txt + '</button>';
      }).join('') + '</div>' +
      '<div id="catLista"></div>' +
      '<div id="catDetalle"></div>';

    var caja = document.getElementById('catBusca');
    caja.value = cat.busca;
    caja.addEventListener('input', retardo(function () {
      cat.busca = caja.value.trim(); cat.pagina = 0; cargarCatalogo();
    }, 300));

    document.getElementById('catCrear').addEventListener('click', function () {
      formProducto(cat.busca);
    });

    z.querySelectorAll('#catFiltros button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.f === cat.filtro);
      b.addEventListener('click', function () {
        cat.filtro = b.dataset.f; cat.pagina = 0;
        z.querySelectorAll('#catFiltros button').forEach(function (x) {
          x.classList.toggle('on', x === b);
        });
        cargarCatalogo();
      });
    });

    cargarCatalogo();
  }

  function cargarCatalogo() {
    var z = document.getElementById('catLista');
    if (!z) return;
    cat.modo = 'lista';
    document.getElementById('catDetalle').innerHTML = '';
    limpiaAviso();   // cambiar de filtro, buscar o pasar de página: se limpia
    z.innerHTML = '<div class="cargando">Buscando…</div>';
    cat.cargando = true;

    var q = sb.from('v_catalogo')
      .select('producto_id,producto,dosificacion,presentacion,categoria,unidad,empaque,' +
              'unidades_por_empaque,disponible,vencido,lotes,lotes_con_existencia,' +
              'vence_primero,en_cajas,situacion', { count: 'exact' });

    if (cat.filtro === 'con')     q = q.gt('disponible', 0);
    if (cat.filtro === 'sin')     q = q.lte('disponible', 0);
    if (cat.filtro === 'vence')   q = q.in('situacion', ['por_vencer_30', 'por_vencer_90']);
    if (cat.filtro === 'vencido') q = q.eq('situacion', 'solo_vencido');
    if (cat.busca.length >= 2) q = q.ilike('busqueda', '*' + sinAcentos(cat.busca).replace(/[%,()]/g, '') + '*');

    var desde = cat.pagina * POR_PAGINA;
    q.order('producto').range(desde, desde + POR_PAGINA - 1).then(function (r) {
      cat.cargando = false;
      var zz = document.getElementById('catLista');
      if (!zz) return;              // cambió de pantalla mientras cargaba
      if (cat.modo !== 'lista') return;   // se abrió una ficha: no pisarla
      if (r.error) { zz.innerHTML = '<div class="aviso bad">' + esc(r.error.message) + '</div>'; return; }
      cat.filas = r.data || [];
      cat.total = r.count == null ? cat.filas.length : r.count;
      pintarCatalogo();
    });
  }

  function pintarCatalogo() {
    var z = document.getElementById('catLista');
    if (!z || cat.modo !== 'lista') return;

    if (!cat.filas.length) {
      z.innerHTML = '<div class="vacio"><b>No hay nada con ese filtro.</b>' +
        (cat.busca ? '<span>No encontré «' + esc(cat.busca) + '» en el catálogo.</span>' +
          '<button type="button" class="principal" id="catNuevo">Crear «' + esc(cat.busca) + '» en el catálogo</button>'
          : '<span>Prueba con otro filtro.</span>') + '</div>';
      var bn = document.getElementById('catNuevo');
      if (bn) bn.addEventListener('click', function () { formProducto(cat.busca); });
      return;
    }

    z.innerHTML =
      '<div class="barra-lista">' +
        contador(cat, 'medicamento', 'medicamentos') +
        '<div class="descargas">' +
          '<button type="button" id="catExcel">Excel</button>' +
          '<button type="button" id="catPdf">PDF</button>' +
        '</div>' +
      '</div>' +
      '<div class="tabla-caja"><table class="tabla datos"><thead><tr>' +
        '<th>Medicamento</th><th>Presentación</th>' +
        '<th class="der">Existencia</th><th class="der">Lotes</th>' +
        '<th>Vence primero</th><th>Situación</th>' +
      '</tr></thead><tbody>' +
      cat.filas.map(function (x, i) {
        var hay = Number(x.disponible) || 0;
        return '<tr class="clic" data-i="' + i + '" tabindex="0" role="button" ' +
            'aria-label="Abrir ' + esc(x.producto) + '">' +
          '<td class="c-med" data-col="Medicamento"><b>' + esc(x.producto) + '</b>' +
            (x.categoria === 'insumo' ? ' <span class="sit gris">insumo</span>' : '') + '</td>' +
          '<td data-col="Presentación"><span class="sub chico">' +
            esc([x.dosificacion, x.presentacion].filter(Boolean).join(' · ') || '—') + '</span></td>' +
          '<td class="der num" data-col="Existencia">' +
            '<b class="' + (hay > 0 ? '' : 'cero') + '">' + num(hay) + '</b>' +
            (x.en_cajas ? '<span class="chico">' + esc(x.en_cajas) + '</span>' : '') +
            (Number(x.vencido) > 0 ? '<span class="chico mal">' + num(x.vencido) + ' vencidas</span>' : '') +
          '</td>' +
          '<td class="der num" data-col="Lotes">' + x.lotes + '</td>' +
          '<td data-col="Vence primero">' + (x.vence_primero ? fecha(x.vence_primero) : '—') + '</td>' +
          '<td data-col="Situación">' + sit(x.situacion) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>' +
      paginador(cat, 'cat');

    function abrir(tr) { verProducto(cat.filas[+tr.dataset.i]); }
    z.querySelectorAll('tr.clic').forEach(function (tr) {
      tr.addEventListener('click', function () { abrir(tr); });
      tr.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(tr); }
      });
    });
    pintarCifras();
    document.getElementById('catExcel').addEventListener('click', function () {
      bajarCatalogo(this, 'excel');
    });
    document.getElementById('catPdf').addEventListener('click', function () {
      bajarCatalogo(this, 'pdf');
    });
    engancharPaginador(z, cat, cargarCatalogo);
  }

  /* Se descarga TODO lo que cumple el filtro, no solo la página que se ve:
     cuando se pide un listado se quiere completo. Se trae de 1000 en 1000
     porque el servidor no manda más de mil por vez. */
  function bajarCatalogo(btn, formato) {
    var texto = btn.textContent;
    btn.disabled = true; btn.textContent = 'Preparando…';

    var todo = [];
    function trae(desde) {
      var q = sb.from('v_catalogo')
        .select('producto,dosificacion,presentacion,categoria,unidad,empaque,unidades_por_empaque,' +
                'disponible,vencido,lotes,vence_primero,en_cajas,situacion');
      if (cat.filtro === 'con')     q = q.gt('disponible', 0);
      if (cat.filtro === 'sin')     q = q.lte('disponible', 0);
      if (cat.filtro === 'vence')   q = q.in('situacion', ['por_vencer_30', 'por_vencer_90']);
      if (cat.filtro === 'vencido') q = q.eq('situacion', 'solo_vencido');
      if (cat.busca.length >= 2) q = q.ilike('busqueda', '*' + sinAcentos(cat.busca).replace(/[%,()]/g, '') + '*');
      return q.order('producto').range(desde, desde + 999).then(function (r) {
        if (r.error) throw r.error;
        todo = todo.concat(r.data || []);
        if ((r.data || []).length === 1000) return trae(desde + 1000);
      });
    }

    trae(0).then(function () {
      var comoEsta = { bien: 'Con existencia', sin_existencia: 'Sin existencia',
                       solo_vencido: 'Solo vencido', por_vencer_30: 'Vence en 30 días',
                       por_vencer_90: 'Vence en 90 días', bajo_minimo: 'Bajo el mínimo' };
      var filas = todo.map(function (x) {
        return [x.producto, x.dosificacion || '', x.presentacion || '', x.categoria,
                x.unidad || '', x.empaque || '', x.unidades_por_empaque || '',
                Math.round(Number(x.disponible) || 0), x.en_cajas || '',
                Math.round(Number(x.vencido) || 0), x.lotes,
                x.vence_primero ? window.FARMREP.fechaCorta(x.vence_primero) : '',
                comoEsta[x.situacion] || x.situacion];
      });
      var enc = ['Medicamento o insumo', 'Dosificación', 'Presentación', 'Qué es', 'Se cuenta en',
                 'Empaque', 'Trae', 'Disponibles', 'Eso es', 'Vencidas', 'Lotes',
                 'Vence primero', 'Situación'];
      var cual = FILTROS_CAT.filter(function (f) { return f.id === cat.filtro; })[0];
      var titulo = 'Catálogo de la Farmacia Municipal' +
                   (cat.filtro !== 'todos' ? ' · ' + cual.txt : '') +
                   (cat.busca ? ' · «' + cat.busca + '»' : '');

      if (formato === 'excel') {
        window.FARMREP.excel(titulo, [{ nombre: 'Catálogo', titulo: titulo,
          encabezados: enc, filas: filas,
          anchos: [38, 16, 20, 14, 12, 11, 7, 12, 20, 10, 8, 14, 18] }]);
      } else {
        window.FARMREP.pdfTabla({
          titulo: 'Catálogo de la Farmacia Municipal',
          subtitulo: (cat.filtro !== 'todos' ? cual.txt + ' · ' : '') + todo.length + ' renglones',
          encabezados: enc, filas: filas, horizontal: true, archivo: titulo,
          columnas: { 0: { cellWidth: 52 }, 1: { cellWidth: 20 }, 2: { cellWidth: 24 },
                      3: { cellWidth: 17 }, 4: { cellWidth: 15 }, 5: { cellWidth: 15 },
                      6: { cellWidth: 11, halign: 'right' },
                      7: { cellWidth: 17, halign: 'right' }, 8: { cellWidth: 26 },
                      9: { cellWidth: 15, halign: 'right' }, 10: { cellWidth: 11, halign: 'right' },
                      11: { cellWidth: 18, halign: 'center' }, 12: { cellWidth: 20 } }
        });
      }
      btn.disabled = false; btn.textContent = texto;
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = texto;
      aviso('bad', 'No se pudo preparar la descarga: ' + (e.message || e));
    });
  }

  /* Las cifras de arriba: de un vistazo, cómo está el inventario.
     Se piden una sola vez y no dependen del filtro que esté puesto. */
  function pintarCifras() {
    var z = document.getElementById('catCifras');
    if (!z || z.dataset.listo) return;
    z.dataset.listo = '1';

    var partes = [
      { id: 'todos',   txt: 'en el catálogo' },
      { id: 'con',     txt: 'con existencia', cl: 'ok' },
      { id: 'sin',     txt: 'sin existencia', cl: 'gris' },
      { id: 'vencido', txt: 'solo vencido',   cl: 'mal' },
      { id: 'vence',   txt: 'por vencerse',   cl: 'ojo' }
    ];
    Promise.all(partes.map(function (f) {
      var q = sb.from('v_catalogo').select('producto_id', { count: 'exact', head: true });
      if (f.id === 'con')     q = q.gt('disponible', 0);
      if (f.id === 'sin')     q = q.lte('disponible', 0);
      if (f.id === 'vence')   q = q.in('situacion', ['por_vencer_30', 'por_vencer_90']);
      if (f.id === 'vencido') q = q.eq('situacion', 'solo_vencido');
      return q;
    })).then(function (r) {
      var zz = document.getElementById('catCifras');
      if (!zz) return;
      zz.innerHTML = partes.map(function (f, i) {
        return '<button type="button" class="cifra-linea ' + (f.cl || '') + '" data-f="' + f.id + '">' +
          '<b>' + num(r[i].count || 0) + '</b><span>' + f.txt + '</span></button>';
      }).join('');
      /* Cada cifra es también un filtro: se toca y la lista se acota. */
      zz.querySelectorAll('[data-f]').forEach(function (b) {
        b.addEventListener('click', function () {
          cat.filtro = b.dataset.f; cat.pagina = 0;
          document.querySelectorAll('#catFiltros button').forEach(function (x) {
            x.classList.toggle('on', x.dataset.f === b.dataset.f);
          });
          cargarCatalogo();
        });
      });
    });
  }

  /* ---------- un medicamento y sus lotes ---------- */
  function verProducto(p) {
    var z = document.getElementById('catDetalle');
    cat.modo = 'detalle';
    document.getElementById('catLista').innerHTML = '';
    z.innerHTML = '<div class="cargando">Buscando sus lotes…</div>';

    /* Si el objeto llegó sin el empaque (viene de otra pantalla), se lee
       antes de dibujar: de eso depende si el formulario pide cajas o
       unidades sueltas. */
    if (p.unidades_por_empaque === undefined) {
      sb.from('v_catalogo')
        .select('producto_id,producto,dosificacion,presentacion,unidad,empaque,' +
                'unidades_por_empaque,disponible,vencido,en_cajas')
        .eq('producto_id', p.producto_id).single()
        .then(function (r) { verProducto(r.data || Object.assign({ unidades_por_empaque: null }, p)); });
      return;
    }

    sb.from('v_existencia_lote')
      .select('lote_id,lote,vence,existencia,en_cajas,situacion,estado')
      .eq('producto_id', p.producto_id)
      .order('vence', { nullsFirst: false })
      .then(function (r) {
        var zz = document.getElementById('catDetalle');
        if (!zz) return;
        var lotes = (r.data || []).filter(function (l) { return l.estado === 'disponible'; });

        zz.innerHTML =
          '<div class="cabecera-prod">' +
            '<button type="button" class="volver" id="catVolver">← Volver al catálogo</button>' +
            '<div class="prod-nom"><b>' + esc(p.producto) + '</b>' +
              (p.dosificacion || p.presentacion
                ? '<span>' + esc([p.dosificacion, p.presentacion].filter(Boolean).join(' · ')) + '</span>' : '') +
            '</div>' +
            '<div class="prod-cifras">' +
              '<span><b>' + num(p.disponible) + '</b> disponibles' +
                (p.en_cajas ? ' <em class="pc-cajas">' + esc(p.en_cajas) + '</em>' : '') + '</span>' +
              (Number(p.vencido) > 0 ? '<span class="mal"><b>' + num(p.vencido) + '</b> vencidas</span>' : '') +
              '<span><b>' + lotes.length + '</b> ' + (lotes.length === 1 ? 'lote' : 'lotes') + '</span>' +
            '</div>' +
          '</div>' +

          (lotes.length
            ? '<h2 class="sub-t">Lotes que ya tiene</h2>' +
              '<p class="sub">Si lo que llegó es de un lote que ya está aquí, súmaselo. ' +
              'Así no se parte la existencia en dos.</p>' +
              '<div class="tabla-caja"><table class="tabla"><thead><tr>' +
                '<th>Lote</th><th>Vence</th><th class="der">Existencia</th>' +
                '<th>Situación</th><th></th>' +
              '</tr></thead><tbody>' +
              lotes.map(function (l, i) {
                return '<tr><td><b>' + esc(l.lote || 'sin número') + '</b></td>' +
                  '<td>' + fecha(l.vence) + '</td>' +
                  '<td class="der num">' + num(l.existencia) +
                    (l.en_cajas ? '<span class="sub chico">' + esc(l.en_cajas) + '</span>' : '') + '</td>' +
                  '<td>' + sit(l.situacion) + '</td>' +
                  '<td class="der">' + (l.situacion === 'vencido'
                    ? '<span class="sub chico">vencido</span>'
                    : '<button type="button" class="suave" data-suma="' + i + '">Sumar</button>') + '</td></tr>';
              }).join('') +
              '</tbody></table></div>'
            : '<div class="vacio"><b>Todavía no tiene ningún lote.</b>' +
              '<span>Registra el primero abajo.</span></div>') +

          '<h2 class="sub-t">Registrar un lote nuevo</h2>' +
          '<div id="catForm"></div>';

        document.getElementById('catVolver').addEventListener('click', function () {
          document.getElementById('catDetalle').innerHTML = '';
          cat.modo = 'lista';
          pintarCatalogo();
        });
        zz.querySelectorAll('[data-suma]').forEach(function (b) {
          b.addEventListener('click', function () { formSumar(p, lotes[+b.dataset.suma]); });
        });
        formLoteNuevo(p, lotes);

        /* La vista sube a la ficha y el cursor se pone en el número de
           lote: si no, la persona guarda el medicamento y no ve que el
           sistema le está pidiendo el lote justo debajo. */
        if (zz.scrollIntoView) zz.scrollIntoView({ behavior: 'smooth', block: 'start' });
        var primero = document.getElementById('lCodigo');
        if (primero) primero.focus({ preventScroll: true });
      });
  }

  /* ---------- sumar a un lote que ya existe ---------- */
  function formSumar(p, l) {
    var z = document.getElementById('catForm');
    z.innerHTML =
      '<div class="elegido"><div><b>Sumar al lote ' + esc(l.lote || 'sin número') + '</b>' +
      '<span>' + esc(p.producto) + ' · vence ' + fecha(l.vence) +
      ' · ahora hay ' + num(l.existencia) + '</span></div>' +
      '<button type="button" class="quitar" id="sCancelar">Cancelar</button></div>' +
      cuantoLlego(p, 's') +
      '<p class="sub chico" id="sQueda"></p>' +
      '<div class="botonera"><button type="button" class="principal" id="sGuardar">Sumar al lote</button></div>';

    engancharCuanto(p, 's');
    var caja = document.getElementById('sCant');
    caja.focus();
    function alSumar() {
      var n = unidadesEscritas(p, 's');
      document.getElementById('sQueda').textContent = n > 0
        ? 'El lote quedaría con ' + num(Number(l.existencia) + n) + ' unidades' +
          (comoCajas(Number(l.existencia) + n, p) ? ' (' + comoCajas(Number(l.existencia) + n, p) + ')' : '') + '.'
        : '';
    }
    caja.addEventListener('input', alSumar);
    var cj = document.getElementById('sCajas');
    if (cj) cj.addEventListener('input', alSumar);
    document.getElementById('sCancelar').addEventListener('click', function () { formLoteNuevo(p, null); });

    document.getElementById('sGuardar').addEventListener('click', function () {
      var n = unidadesEscritas(p, 's');
      if (!n || n < 1) { aviso('warn', 'Falta cuánto llegó.'); caja.focus(); return; }
      var btn = this; btn.disabled = true; btn.textContent = 'Registrando…';
      sb.from('movimientos').insert({
        lote_id: l.lote_id, tipo: 'entrada', cantidad: n,
        motivo: 'Entrada de mercancía', origen: 'sistema'
      }).then(function (r) {
        if (r.error) throw r.error;
        aviso('ok', 'Sumadas ' + num(n) + ' unidades al lote ' + (l.lote || 'sin número') +
                    ' de ' + p.producto + '. Ahora hay ' + num(Number(l.existencia) + n) + '.');
        verProducto(p);
      }).catch(function (e) {
        aviso('bad', 'No se pudo registrar: ' + (e.message || e));
        btn.disabled = false; btn.textContent = 'Sumar al lote';
      });
    });
  }

  /* ---------- abrir un lote nuevo ---------- */
  function formLoteNuevo(p, lotes) {
    var z = document.getElementById('catForm');
    if (!z) return;
    z.innerHTML =
      '<label for="lCodigo">Número de lote <span class="opc">(como viene en la caja)</span></label>' +
      '<input id="lCodigo" type="text" autocomplete="off" placeholder="Si la caja no lo trae, déjalo vacío">' +
      '<p class="sub chico" id="lAviso"></p>' +
      '<label for="lVence">Fecha de vencimiento</label>' +
      '<input id="lVence" type="date">' +
      '<p class="sub chico" id="lAvisoV"></p>' +
      cuantoLlego(p) +
      '<div class="botonera">' +
        '<button type="button" class="principal" id="lGuardar">Registrar la entrada</button>' +
      '</div>';

    var iCod = document.getElementById('lCodigo');
    var iVen = document.getElementById('lVence');
    engancharCuanto(p);

    /* Si escribe un número de lote que ya existe, se le dice antes de
       guardar: casi siempre lo que quiere es sumarle, no crear otro. */
    iCod.addEventListener('input', function () {
      var av = document.getElementById('lAviso');
      var v = iCod.value.trim().toUpperCase();
      var ya = (lotes || []).filter(function (l) {
        return String(l.lote || '').toUpperCase() === v && v;
      })[0];
      av.innerHTML = ya
        ? '<span class="ojo">Ese lote ya existe con ' + num(ya.existencia) +
          ' unidades. Mejor súmale arriba, para no partir la existencia.</span>'
        : '';
    });

    iVen.addEventListener('change', function () {
      var av = document.getElementById('lAvisoV');
      if (!iVen.value) { av.innerHTML = ''; return; }
      var hoy = (window.FARM && window.FARM.hoyCaracas ? window.FARM.hoyCaracas() : new Date().toISOString().slice(0, 10));
      av.innerHTML = iVen.value < hoy
        ? '<span class="mal">Esa fecha ya pasó: entraría vencido y no se podrá entregar.</span>'
        : '';
    });

    document.getElementById('lGuardar').addEventListener('click', function () {
      var cod = iCod.value.trim() || null;
      var ven = iVen.value || null;
      var can = unidadesEscritas(p);
      if (!can || can < 1) { aviso('warn', 'Falta cuánto llegó.'); return; }
      if (!ven && !window.confirm('No pusiste fecha de vencimiento.\n\n' +
          'Sin ella el sistema no puede avisar cuándo se vence ni ordenar por el que vence primero. ' +
          '¿Registrar igual?')) return;

      var btn = this; btn.disabled = true; btn.textContent = 'Registrando…';
      sb.from('lotes').insert({ producto_id: p.producto_id, codigo: cod, vence: ven })
        .select().single().then(function (r) {
          // si ese lote ya existía, se reutiliza en vez de fallar
          if (r.error && r.error.code === '23505') {
            var q = sb.from('lotes').select('id').eq('producto_id', p.producto_id);
            q = cod ? q.eq('codigo', cod) : q.is('codigo', null);
            q = ven ? q.eq('vence', ven) : q.is('vence', null);
            return q.single();
          }
          if (r.error) throw r.error;
          return r;
        }).then(function (r) {
          if (r.error) throw r.error;
          return sb.from('movimientos').insert({
            lote_id: r.data.id, tipo: 'entrada', cantidad: can,
            motivo: 'Entrada de mercancía', origen: 'sistema'
          });
        }).then(function (r) {
          if (r && r.error) throw r.error;
          aviso('ok', 'Registradas ' + num(can) + ' unidades de ' + p.producto +
                      (cod ? ' (lote ' + cod + ')' : '') + '. Ya están disponibles.');
          verProducto(p);
        }).catch(function (e) {
          aviso('bad', 'No se pudo registrar: ' + (e.message || e));
          btn.disabled = false; btn.textContent = 'Registrar la entrada';
        });
    });
  }

  /* ---------- cuánto llegó: en cajas o en unidades ----------
     La farmacia recibe cajas pero entrega unidades. Se deja escribir en lo
     que sea más natural y el sistema hace la cuenta a la vista, para que
     nadie tenga que multiplicar de cabeza. */
  function tieneEmpaque(p) {
    return p && p.unidades_por_empaque > 1;
  }
  function comoCajas(unidades, p) {
    if (!tieneEmpaque(p) || !(unidades > 0)) return '';
    var n = p.unidades_por_empaque, emp = p.empaque || 'caja';
    var cajas = Math.floor(unidades / n), sueltas = unidades % n;
    var t = [];
    if (cajas) t.push(cajas + ' ' + emp + (cajas === 1 ? '' : 's'));
    if (sueltas) t.push(sueltas + ' suelta' + (sueltas === 1 ? '' : 's'));
    return t.join(' y ');
  }

  function cuantoLlego(p, pre) {
    pre = pre || 'l';
    if (!tieneEmpaque(p)) {
      return '<label for="' + pre + 'Cant">Cuántas unidades llegaron</label>' +
             '<input id="' + pre + 'Cant" type="number" min="1" inputmode="numeric" autocomplete="off">';
    }
    var emp = p.empaque || 'caja';
    return '<label for="' + pre + 'Cajas">Cuántos ' + esc(emp) + 's llegaron ' +
             '<span class="opc">(cada uno trae ' + p.unidades_por_empaque + ')</span></label>' +
           '<input id="' + pre + 'Cajas" type="number" min="0" inputmode="numeric" autocomplete="off">' +
           '<label for="' + pre + 'Cant">Y cuántas unidades sueltas <span class="opc">(opcional)</span></label>' +
           '<input id="' + pre + 'Cant" type="number" min="0" inputmode="numeric" autocomplete="off">' +
           '<p class="sub chico" id="' + pre + 'Total"></p>';
  }

  function unidadesEscritas(p, pre) {
    pre = pre || 'l';
    var sueltas = parseInt((document.getElementById(pre + 'Cant') || {}).value, 10) || 0;
    if (!tieneEmpaque(p)) return sueltas;
    var cajas = parseInt((document.getElementById(pre + 'Cajas') || {}).value, 10) || 0;
    return cajas * p.unidades_por_empaque + sueltas;
  }

  function engancharCuanto(p, pre) {
    pre = pre || 'l';
    if (!tieneEmpaque(p)) return;
    function total() {
      var z = document.getElementById(pre + 'Total');
      if (!z) return;
      var n = unidadesEscritas(p, pre);
      z.innerHTML = n > 0
        ? 'Entran <b>' + num(n) + ' unidades</b> en total (' + esc(comoCajas(n, p)) + ').'
        : '';
    }
    ['Cajas', 'Cant'].forEach(function (q) {
      var e = document.getElementById(pre + q);
      if (e) e.addEventListener('input', total);
    });
  }

  /* ---------- registrar un medicamento o insumo nuevo ----------
     Con todos sus campos, no solo el nombre: la dosificación y la
     presentación son lo que distingue un LOSARTAN 50mg de uno de 100mg,
     y confundirlos es un error de medicación. */
  var UNIDADES = ['unidad', 'tableta', 'cápsula', 'ampolla', 'frasco', 'sobre',
                  'tubo', 'bolsa', 'ml', 'gramo'];

  /* Cómo viene empacado de la droguería. La existencia se sigue contando en
     UNIDADES, que es lo que se entrega; el empaque solo sirve para poder
     decir el mismo número en cajas y que cuadre con lo que se ve en el
     anaquel. */
  var EMPAQUES = ['caja', 'frasco', 'blíster', 'sobre', 'bolsa', 'paquete'];

  function formProducto(nombre) {
    var z = document.getElementById('catDetalle');
    cat.modo = 'detalle';
    document.getElementById('catLista').innerHTML = '';
    limpiaAviso();

    z.innerHTML =
      '<h2 class="sub-t">Registrar un medicamento o insumo</h2>' +
      '<p class="sub">Lo que se escriba aquí es lo que verá quien despacha. ' +
      'La dosificación es lo que distingue una presentación de otra.</p>' +

      '<label>Qué es</label>' +
      '<div class="chips" id="pCat">' +
        '<button type="button" data-c="medicamento" class="on">Medicamento</button>' +
        '<button type="button" data-c="insumo">Insumo</button>' +
      '</div>' +

      '<label for="pNombre">Nombre</label>' +
      '<input id="pNombre" type="text" autocomplete="off" value="' + esc(nombre || '') + '" ' +
        'placeholder="LOSARTAN POTASICO">' +
      '<p class="sub chico" id="pAviso"></p>' +

      '<label for="pDosis">Dosificación <span class="opc">(la fuerza: 50mg, 500mg/5ml…)</span></label>' +
      '<input id="pDosis" type="text" autocomplete="off" placeholder="50mg">' +

      '<label for="pPres">Presentación <span class="opc">(cómo viene: caja de 30, jarabe…)</span></label>' +
      '<input id="pPres" type="text" autocomplete="off" placeholder="Caja de 30 tabletas">' +

      '<label for="pUnidad">Cómo se cuenta cada unidad</label>' +
      '<select id="pUnidad">' + UNIDADES.map(function (u) {
        return '<option value="' + esc(u) + '"' + (u === 'unidad' ? ' selected' : '') + '>' +
               esc(u.charAt(0).toUpperCase() + u.slice(1)) + '</option>';
      }).join('') + '</select>' +

      '<label for="pEmpaque">Cómo viene empacado</label>' +
      '<select id="pEmpaque">' +
        '<option value="">Suelto, sin empaque</option>' +
        EMPAQUES.map(function (u) {
          return '<option value="' + esc(u) + '">' +
                 esc(u.charAt(0).toUpperCase() + u.slice(1)) + '</option>';
        }).join('') + '</select>' +

      '<label for="pPorEmpaque">Cuántas unidades trae cada uno</label>' +
      '<input id="pPorEmpaque" type="number" min="2" inputmode="numeric" ' +
        'placeholder="30" disabled>' +
      '<p class="sub chico" id="pEjemplo">Si viene suelto, se cuenta de una en una.</p>' +

      '<label for="pMinimo">Avisar cuando queden menos de <span class="opc">(0 = sin aviso)</span></label>' +
      '<input id="pMinimo" type="number" min="0" inputmode="numeric" value="0">' +

      '<div class="botonera">' +
        '<button type="button" class="principal" id="pGuardar">Registrar y cargarle un lote</button>' +
        '<button type="button" class="secundario" id="pCancelar">Cancelar</button>' +
      '</div>';

    var caja = document.getElementById('pNombre');
    caja.focus();

    document.getElementById('pCat').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.getElementById('pCat').querySelectorAll('button').forEach(function (x) {
          x.classList.toggle('on', x === b);
        });
      });
    });

    /* El "cuántas trae" solo tiene sentido si viene empacado. */
    var selEmp = document.getElementById('pEmpaque');
    var porEmp = document.getElementById('pPorEmpaque');
    function refrescaEmpaque() {
      porEmp.disabled = !selEmp.value;
      if (!selEmp.value) porEmp.value = '';
      pintaEjemplo();
    }
    function pintaEjemplo() {
      var ej = document.getElementById('pEjemplo');
      if (!ej) return;
      var n = parseInt(porEmp.value, 10);
      var u = document.getElementById('pUnidad').value;
      if (!selEmp.value || !n || n < 2) {
        ej.textContent = 'Si viene suelto, se cuenta de una en una.';
        return;
      }
      ej.innerHTML = 'Cada <b>' + esc(selEmp.value) + '</b> trae <b>' + n + ' ' +
        esc(u) + (n === 1 ? '' : 's') + '</b>. ' +
        'Así el sistema puede decir «' + Math.floor((n * 4 + 5) / n) + ' ' +
        esc(selEmp.value) + 's y 5 sueltas» en vez de solo «' + (n * 4 + 5) + '».';
    }
    selEmp.addEventListener('change', refrescaEmpaque);
    porEmp.addEventListener('input', pintaEjemplo);
    document.getElementById('pUnidad').addEventListener('change', pintaEjemplo);

    /* Mientras escribe se le avisa si ya hay uno parecido, para no repetirlo:
       tener el mismo medicamento dos veces parte la existencia en dos. */
    caja.addEventListener('input', retardo(function () {
      var av = document.getElementById('pAviso');
      if (!av) return;
      var v = caja.value.trim();
      if (v.length < 3) { av.innerHTML = ''; return; }
      sb.from('v_catalogo')
        .select('producto_id,producto,dosificacion,presentacion,disponible,vencido,lotes')
        .ilike('busqueda', '*' + sinAcentos(v) + '*').limit(3)
        .then(function (r) {
          var av2 = document.getElementById('pAviso');
          if (!av2) return;
          var f = r.data || [];
          if (!f.length) { av2.innerHTML = ''; return; }
          av2.innerHTML = '<span class="ojo">Ya están en el catálogo:</span> ' +
            f.map(function (x, i) {
              return '<button type="button" class="enlace" data-ya="' + i + '">' +
                     esc(x.producto) + '</button>';
            }).join(' · ');
          av2.querySelectorAll('[data-ya]').forEach(function (b) {
            b.addEventListener('click', function () { verProducto(f[+b.dataset.ya]); });
          });
        });
    }, 350));

    document.getElementById('pCancelar').addEventListener('click', function () {
      document.getElementById('catDetalle').innerHTML = '';
      cargarCatalogo();
    });

    document.getElementById('pGuardar').addEventListener('click', function () {
      var nom = caja.value.trim().replace(/\s+/g, ' ');
      if (nom.length < 3) { aviso('warn', 'Escribe el nombre del medicamento.'); caja.focus(); return; }
      var elegida = document.querySelector('#pCat button.on');
      var btn = this; btn.disabled = true; btn.textContent = 'Registrando…';

      sb.from('productos').insert({
        nombre: nom,
        dosificacion: document.getElementById('pDosis').value.trim() || null,
        presentacion: document.getElementById('pPres').value.trim() || null,
        categoria: elegida ? elegida.dataset.c : 'medicamento',
        unidad: document.getElementById('pUnidad').value,
        empaque: document.getElementById('pEmpaque').value || null,
        unidades_por_empaque: (function () {
          var n = parseInt(document.getElementById('pPorEmpaque').value, 10);
          return document.getElementById('pEmpaque').value && n > 1 ? n : null;
        })(),
        stock_minimo: parseInt(document.getElementById('pMinimo').value, 10) || 0,
        activo: true
      }).select().single().then(function (r) {
        if (r.error) {
          btn.disabled = false; btn.textContent = 'Registrar y cargarle un lote';
          if (r.error.code === '23505') {
            aviso('warn', 'Ya hay uno con ese nombre exacto. Búscalo arriba y cárgale el lote ahí, ' +
                          'para no tener el mismo medicamento dos veces.');
            return;
          }
          aviso('bad', 'No se pudo crear: ' + r.error.message);
          return;
        }
        aviso('ok', r.data.nombre + ' quedó en el catálogo. Ahora regístrale su primer lote.');
        verProducto({ producto_id: r.data.id, producto: r.data.nombre,
                      dosificacion: r.data.dosificacion, presentacion: r.data.presentacion,
                      unidad: r.data.unidad,
                      empaque: r.data.empaque,
                      unidades_por_empaque: r.data.unidades_por_empaque,
                      disponible: 0, vencido: 0, en_cajas: null });
      });
    });
  }

  /* ================================================================
     CONTEO FÍSICO — la hoja tipo Excel
  ================================================================ */
  var FILTROS_HOJA = [
    { id: 'con',   txt: 'Con existencia' },
    { id: 'todos', txt: 'Todos los lotes' },
    { id: 'cero',  txt: 'En cero' }
  ];

  function verConteo() {
    var z = document.getElementById('zonaInv');
    z.innerHTML =
      '<h2 class="sub-t">Corregir existencia tras un conteo</h2>' +
      '<p class="sub">Se puede corregir <b>todo</b>: el nombre del medicamento, su ' +
      'presentación, el número de lote, la fecha de vencimiento y lo que contaste. ' +
      'Corrige los que hagan falta y guárdalos todos juntos. Con <b>Enter</b> bajas al ' +
      'siguiente renglón, como en una hoja de cálculo.</p>' +
      '<div class="aviso warn">' +
        '<b>El nombre es del medicamento, no del lote</b>' +
        'Si un medicamento tiene tres lotes, cambiarle el nombre en un renglón lo cambia ' +
        'en los tres. La cantidad y el número de lote sí son de cada lote por separado.' +
      '</div>' +
      '<div class="chips" id="hojaFiltros">' + FILTROS_HOJA.map(function (f) {
        return '<button type="button" data-f="' + f.id + '">' + f.txt + '</button>';
      }).join('') + '</div>' +
      '<label for="hojaBusca">Buscar</label>' +
      '<input id="hojaBusca" type="search" autocomplete="off" placeholder="Nombre del medicamento…">' +
      '<div id="hojaLista"></div>' +
      '<div id="hojaGuardar"></div>';

    var caja = document.getElementById('hojaBusca');
    caja.value = hoja.busca;
    caja.addEventListener('input', retardo(function () {
      hoja.busca = caja.value.trim(); hoja.pagina = 0; cargarHoja();
    }, 300));

    z.querySelectorAll('#hojaFiltros button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.f === hoja.filtro);
      b.addEventListener('click', function () {
        hoja.filtro = b.dataset.f; hoja.pagina = 0;
        z.querySelectorAll('#hojaFiltros button').forEach(function (x) {
          x.classList.toggle('on', x === b);
        });
        cargarHoja();
      });
    });

    cargarHoja();
  }

  function cargarHoja() {
    var z = document.getElementById('hojaLista');
    if (!z) return;
    z.innerHTML = '<div class="cargando">Cargando los lotes…</div>';

    var q = sb.from('v_existencia_lote')
      .select('lote_id,producto_id,producto,dosificacion,presentacion,lote,vence,' +
              'existencia,en_cajas,situacion', { count: 'exact' })
      .eq('estado', 'disponible');

    if (hoja.filtro === 'con')  q = q.gt('existencia', 0);
    if (hoja.filtro === 'cero') q = q.lte('existencia', 0);
    if (hoja.busca.length >= 2) q = q.ilike('producto', '*' + hoja.busca.replace(/[%,()]/g, '') + '*');

    var desde = hoja.pagina * POR_PAGINA;
    q.order('producto').order('vence', { nullsFirst: false })
     .range(desde, desde + POR_PAGINA - 1).then(function (r) {
      var zz = document.getElementById('hojaLista');
      if (!zz) return;
      if (r.error) { zz.innerHTML = '<div class="aviso bad">' + esc(r.error.message) + '</div>'; return; }
      hoja.filas = r.data || [];
      hoja.total = r.count == null ? hoja.filas.length : r.count;
      pintarHoja();
    });
  }

  function pintarHoja() {
    var z = document.getElementById('hojaLista');
    if (!z) return;

    if (!hoja.filas.length) {
      z.innerHTML = '<div class="vacio"><b>No hay lotes con ese filtro.</b></div>';
      pintarGuardar();
      return;
    }

    z.innerHTML =
      contador(hoja, 'lote', 'lotes') +
      '<div class="tabla-caja"><table class="tabla hoja"><thead><tr>' +
        '<th>Medicamento</th><th>Presentación</th><th>Número de lote</th><th>Vence</th>' +
        '<th class="der">Sistema dice</th><th class="der">Hay de verdad</th><th class="der">Diferencia</th>' +
      '</tr></thead><tbody>' +
      hoja.filas.map(function (x, i) {
        var sis = Math.round(Number(x.existencia) || 0);
        var c = hoja.cambios[x.lote_id];
        var real = c ? c.real : sis;
        var dif = real - sis;
        var nombreAhora = c && c.producto !== undefined ? c.producto : (x.producto || '');
        var presAhora = c && c.presentacion !== undefined ? c.presentacion : (x.presentacion || '');
        var loteAhora = c && c.lote !== undefined ? c.lote : (x.lote || '');
        var venceAhora = c && c.vence !== undefined ? c.vence : (x.vence ? String(x.vence).slice(0, 10) : '');
        return '<tr data-lote="' + x.lote_id + '"' + (c ? ' class="cambiada"' : '') + '>' +
          '<td class="c-med" data-col="Medicamento">' +
            '<input class="celda celda-nom" type="text" autocomplete="off" data-campo="producto" ' +
            'data-i="' + i + '" value="' + esc(nombreAhora) + '" ' +
            'aria-label="Nombre del medicamento"></td>' +
          '<td data-col="Presentación">' +
            '<input class="celda celda-txt" type="text" autocomplete="off" data-campo="presentacion" ' +
            'data-i="' + i + '" value="' + esc(presAhora) + '" placeholder="—" ' +
            'aria-label="Presentación y componentes"></td>' +
          '<td data-col="Número de lote">' +
            '<input class="celda celda-txt" type="text" autocomplete="off" data-campo="lote" ' +
            'data-i="' + i + '" value="' + esc(loteAhora) + '" placeholder="sin número" ' +
            'aria-label="Número de lote"></td>' +
          '<td data-col="Vence">' +
            '<input class="celda celda-fecha" type="date" data-campo="vence" ' +
            'data-i="' + i + '" value="' + esc(venceAhora) + '" aria-label="Vence"> ' +
            sit(x.situacion) + '</td>' +
          '<td class="der num" data-col="Sistema dice">' + num(sis) +
            (x.en_cajas ? '<span class="sub chico">' + esc(x.en_cajas) + '</span>' : '') + '</td>' +
          '<td class="der c-celda" data-col="Hay de verdad">' +
            '<input class="celda" type="number" min="0" inputmode="numeric" data-campo="cantidad" ' +
            'data-i="' + i + '" data-sis="' + sis + '" value="' + real + '" aria-label="Hay de verdad"></td>' +
          '<td class="der num dif" data-col="Diferencia">' + (dif ? (dif > 0 ? '+' : '') + num(dif) : '—') + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>' +
      paginador(hoja, 'hoja');

    /* Cualquiera de las tres casillas de un renglón cuenta como un cambio:
       la cantidad contada, el número de lote y la fecha de vencimiento. */
    var celdas = z.querySelectorAll('.celda');
    celdas.forEach(function (inp) {
      inp.addEventListener('input', anotaCambio);
      inp.addEventListener('change', anotaCambio);

      function anotaCambio() {
        var i = +inp.dataset.i;
        var fila = hoja.filas[i];
        var tr = inp.closest('tr');
        var previo = hoja.cambios[fila.lote_id] || {};

        var sis = Math.round(Number(fila.existencia) || 0);
        var cRe = tr.querySelector('[data-campo="cantidad"]');
        var cLo = tr.querySelector('[data-campo="lote"]');
        var cVe = tr.querySelector('[data-campo="vence"]');
        var cNo = tr.querySelector('[data-campo="producto"]');
        var cPr = tr.querySelector('[data-campo="presentacion"]');

        var real = parseInt(cRe.value, 10);
        var loteNuevo = cLo.value.trim();
        var venceNuevo = cVe.value || '';
        var nombreNuevo = cNo.value.trim().replace(/\s+/g, ' ');
        var presNuevo = cPr.value.trim();
        var loteViejo = fila.lote || '';
        var venceViejo = fila.vence ? String(fila.vence).slice(0, 10) : '';
        var nombreViejo = fila.producto || '';
        var presViejo = fila.presentacion || '';

        var cambio = {};
        if (!isNaN(real) && real >= 0 && real !== sis) { cambio.real = real; cambio.sis = sis; }
        if (loteNuevo !== loteViejo)  cambio.lote = loteNuevo;
        if (venceNuevo !== venceViejo) cambio.vence = venceNuevo;
        if (nombreNuevo && nombreNuevo !== nombreViejo) {
          cambio.producto = nombreNuevo;
          cambio.productoId = fila.producto_id;
          cambio.productoViejo = nombreViejo;
        }
        if (presNuevo !== presViejo) {
          cambio.presentacion = presNuevo;
          cambio.productoId = fila.producto_id;
        }

        if (!Object.keys(cambio).length) {
          delete hoja.cambios[fila.lote_id];
          tr.classList.remove('cambiada');
          tr.querySelector('.dif').textContent = '—';
        } else {
          /* Ojo: `producto` es el nombre NUEVO que se escribió. Para saber de
             qué medicamento es el renglón se usa `deQuien`, que es otra cosa.
             Tenerlos con el mismo nombre hacía que el viejo pisara al nuevo. */
          cambio.deQuien = fila.producto;
          cambio.loteViejo = loteViejo;
          cambio.venceViejo = venceViejo;
          hoja.cambios[fila.lote_id] = cambio;
          tr.classList.add('cambiada');
          var d = cambio.real !== undefined ? cambio.real - sis : 0;
          tr.querySelector('.dif').textContent = d ? (d > 0 ? '+' : '') + num(d) : '—';
        }
        if (previo && !hoja.cambios[fila.lote_id]) { /* dejó de estar cambiado */ }
        pintarGuardar();
      }

      /* Enter baja a la misma casilla del renglón siguiente, como en una
         hoja de cálculo. */
      inp.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        var campo = inp.dataset.campo;
        var sig = z.querySelector('tr:nth-child(' + (+inp.dataset.i + 2) + ') [data-campo="' + campo + '"]');
        if (sig) { sig.focus(); if (sig.select) sig.select(); }
        else { var b = document.getElementById('hGuardar'); if (b) b.focus(); }
      });
      if (inp.type !== 'date') {
        inp.addEventListener('focus', function () { inp.select(); });
      }
    });

    engancharPaginador(z, hoja, cargarHoja);
    pintarGuardar();
  }

  function pintarGuardar() {
    var z = document.getElementById('hojaGuardar');
    if (!z) return;
    var claves = Object.keys(hoja.cambios);
    if (!claves.length) { z.innerHTML = ''; return; }

    var cuenta = { cant: 0, lote: 0, vence: 0, nombre: 0, pres: 0 };
    var productosTocados = {};
    claves.forEach(function (k) {
      var c = hoja.cambios[k];
      if (c.real !== undefined)   cuenta.cant++;
      if (c.lote !== undefined)   cuenta.lote++;
      if (c.vence !== undefined)  cuenta.vence++;
      if (c.producto !== undefined)     { cuenta.nombre++; productosTocados[c.productoId] = c.producto; }
      if (c.presentacion !== undefined) cuenta.pres++;
    });
    var detalle = [];
    if (cuenta.cant)   detalle.push(cuenta.cant + (cuenta.cant === 1 ? ' cantidad' : ' cantidades'));
    if (cuenta.nombre) detalle.push(cuenta.nombre + (cuenta.nombre === 1 ? ' nombre' : ' nombres'));
    if (cuenta.pres)   detalle.push(cuenta.pres + (cuenta.pres === 1 ? ' presentación' : ' presentaciones'));
    if (cuenta.lote)   detalle.push(cuenta.lote + (cuenta.lote === 1 ? ' número de lote' : ' números de lote'));
    if (cuenta.vence)  detalle.push(cuenta.vence + (cuenta.vence === 1 ? ' vencimiento' : ' vencimientos'));

    z.innerHTML =
      '<div class="barra-guardar">' +
        '<div class="bg-txt"><b>' + claves.length +
          (claves.length === 1 ? ' renglón cambiado' : ' renglones cambiados') + '</b>' +
          '<span>' + esc(detalle.join(' · ')) + '</span></div>' +
        (cuenta.nombre
          ? '<p class="sub chico"><span class="ojo">El nombre es del medicamento, no del lote:</span> ' +
            'cambiarlo aquí lo cambia en <b>todos sus lotes</b>.</p>'
          : '') +
        '<label for="hMotivo">Por qué se corrige <span class="opc">(queda en la bitácora)</span></label>' +
        '<input id="hMotivo" type="text" placeholder="Conteo físico de septiembre, rotura, derrame…">' +
        '<div class="botonera">' +
          '<button type="button" class="principal" id="hGuardar">Guardar ' + claves.length +
            (claves.length === 1 ? ' corrección' : ' correcciones') + '</button>' +
          '<button type="button" class="secundario" id="hDescartar">Descartar</button>' +
        '</div>' +
      '</div>';

    document.getElementById('hDescartar').addEventListener('click', function () {
      if (!window.confirm('¿Descartar los ' + claves.length + ' cambios sin guardar?')) return;
      hoja.cambios = {}; pintarHoja();
    });
    document.getElementById('hGuardar').addEventListener('click', guardarConteo);
  }

  function guardarConteo() {
    var claves = Object.keys(hoja.cambios);
    var motivo = document.getElementById('hMotivo').value.trim();
    if (motivo.length < 4) {
      aviso('warn', 'Escribe por qué se corrige: queda en la bitácora.');
      document.getElementById('hMotivo').focus();
      return;
    }
    var btn = document.getElementById('hGuardar');
    btn.disabled = true; btn.textContent = 'Guardando…';

    function falla(msg) {
      aviso('bad', msg);
      btn.disabled = false;
      btn.textContent = 'Guardar ' + claves.length + (claves.length === 1 ? ' corrección' : ' correcciones');
    }

    /* Primero los medicamentos: el nombre y la presentación son suyos, no
       del lote. Si el mismo medicamento se editó en dos renglones con
       nombres distintos, no se guarda nada: hay que decidir cuál es. */
    var porProducto = {};
    var choque = null;
    claves.forEach(function (k) {
      var c = hoja.cambios[k];
      if (c.producto === undefined && c.presentacion === undefined) return;
      var id = c.productoId;
      if (!id) { choque = 'no se pudo saber a qué medicamento pertenece el renglón'; return; }
      var ya = porProducto[id];
      if (ya) {
        if (c.producto !== undefined && ya.nombre !== undefined && ya.nombre !== c.producto) {
          choque = '«' + ya.nombre + '» y «' + c.producto + '»';
        }
        if (c.presentacion !== undefined && ya.pres !== undefined && ya.pres !== c.presentacion) {
          choque = choque || 'dos presentaciones distintas para el mismo medicamento';
        }
      }
      porProducto[id] = porProducto[id] || {};
      if (c.producto !== undefined)     porProducto[id].nombre = c.producto;
      if (c.presentacion !== undefined) porProducto[id].pres = c.presentacion;
    });

    if (choque && /^no se pudo/.test(choque)) {
      aviso('bad', 'No se guardó nada: ' + choque + '. Vuelve a cargar la hoja e inténtalo.');
      btn.disabled = false;
      btn.textContent = 'Guardar ' + claves.length + (claves.length === 1 ? ' corrección' : ' correcciones');
      return;
    }
    if (choque) {
      aviso('warn', 'Le pusiste dos nombres distintos al mismo medicamento: ' + choque + '. ' +
                    'Como el nombre es del medicamento y no del lote, hay que decidir cuál es. ' +
                    'No se guardó nada.');
      btn.disabled = false;
      btn.textContent = 'Guardar ' + claves.length + (claves.length === 1 ? ' corrección' : ' correcciones');
      return;
    }

    /* Después los datos del lote (número y vencimiento), uno por uno porque
       cada lote es una fila distinta. Si alguno choca con otro lote que ya
       tiene ese mismo número y esa misma fecha, se dice cuál y no se sigue. */
    var cambiosLote = claves.filter(function (k) {
      return hoja.cambios[k].lote !== undefined || hoja.cambios[k].vence !== undefined;
    });

    var cadena = Promise.resolve();

    Object.keys(porProducto).forEach(function (id) {
      cadena = cadena.then(function () {
        var campos = {};
        if (porProducto[id].nombre !== undefined) campos.nombre = porProducto[id].nombre;
        if (porProducto[id].pres !== undefined)   campos.presentacion = porProducto[id].pres || null;
        return sb.from('productos').update(campos).eq('id', id).then(function (r) {
          if (r.error) {
            throw new Error(r.error.code === '23505'
              ? 'Ya hay otro medicamento con el nombre «' + campos.nombre + '». ' +
                'No se guardó nada: si son el mismo, cárgalo en el que ya existe.'
              : 'Al cambiar el medicamento: ' + r.error.message);
          }
        });
      });
    });
    cambiosLote.forEach(function (k) {
      cadena = cadena.then(function () {
        var c = hoja.cambios[k];
        var campos = { };
        if (c.lote !== undefined)  campos.codigo = c.lote || null;
        if (c.vence !== undefined) campos.vence = c.vence || null;
        return sb.from('lotes').update(campos).eq('id', k).then(function (r) {
          if (r.error) {
            throw new Error(r.error.code === '23505'
              ? 'En ' + (c.deQuien || 'ese medicamento') + ' ya hay otro lote con ese mismo ' +
                'número y esa misma fecha. No se guardó nada: revisa ese renglón.'
              : 'En ' + (c.deQuien || 'ese medicamento') + ': ' + r.error.message);
          }
        });
      });
    });

    /* Después las cantidades, todas en una sola petición: o entran todas o
       no entra ninguna, para no dejar un conteo a medias. */
    cadena.then(function () {
      var filas = claves.filter(function (k) { return hoja.cambios[k].real !== undefined; })
        .map(function (k) {
          var c = hoja.cambios[k];
          return { lote_id: k, tipo: 'ajuste', cantidad: c.real - c.sis,
                   motivo: motivo, origen: 'sistema' };
        });
      if (!filas.length) return { error: null };
      return sb.from('movimientos').insert(filas);
    }).then(function (r) {
      if (r && r.error) { falla('No se guardaron las cantidades: ' + r.error.message); return; }
      aviso('ok', 'Guardadas ' + claves.length +
                  (claves.length === 1 ? ' corrección' : ' correcciones') +
                  '. Quedaron registradas con tu nombre y el motivo.');
      hoja.cambios = {};
      cargarHoja();
    }).catch(function (e) { falla(e.message || String(e)); });
  }

  /* ================================================================
     Piezas que usan las dos listas
  ================================================================ */
  function contador(estado, sing, plur) {
    var desde = estado.pagina * POR_PAGINA + 1;
    var hasta = Math.min(desde + POR_PAGINA - 1, estado.total);
    if (!estado.total) return '';
    return '<p class="conteo">' +
      (estado.total <= POR_PAGINA
        ? estado.total + ' ' + (estado.total === 1 ? sing : plur)
        : 'Del ' + desde + ' al ' + hasta + ' de ' + estado.total + ' ' + plur) +
      '</p>';
  }

  function paginador(estado, pre) {
    var paginas = Math.ceil(estado.total / POR_PAGINA);
    if (paginas <= 1) return '';
    return '<div class="paginador">' +
      '<button type="button" data-pag="ant"' + (estado.pagina === 0 ? ' disabled' : '') + '>← Anteriores</button>' +
      '<span>Página ' + (estado.pagina + 1) + ' de ' + paginas + '</span>' +
      '<button type="button" data-pag="sig"' + (estado.pagina + 1 >= paginas ? ' disabled' : '') + '>Siguientes →</button>' +
    '</div>';
  }

  function engancharPaginador(z, estado, recargar) {
    z.querySelectorAll('[data-pag]').forEach(function (b) {
      b.addEventListener('click', function () {
        estado.pagina += b.dataset.pag === 'sig' ? 1 : -1;
        if (estado.pagina < 0) estado.pagina = 0;
        recargar();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  window.PANTALLA_INVENTARIO = function (cliente, contenedor) {
    sb = cliente; ancla = contenedor; pestana = 'cargar';
    cat  = { filtro: 'todos', busca: '', pagina: 0, total: 0, filas: [],
             cargando: false, modo: 'lista' };
    hoja = { filtro: 'con',   busca: '', pagina: 0, total: 0, filas: [], cambios: {}, cargando: false };
    pintar();
  };
})();
