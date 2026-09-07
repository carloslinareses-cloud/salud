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

  var sb = null, ancla = null, pestana = 'alertas';
  var POR_PAGINA = 50;

  /* Lo que se está viendo en cada pantalla. Se guarda aquí para que al
     volver de registrar una entrada no se pierda el filtro ni la página. */
  var cat  = { filtro: 'todos', busca: '', pagina: 0, total: 0, filas: [], cargando: false };
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
          '<button type="button" data-p="alertas">Alertas</button>' +
          '<button type="button" data-p="catalogo">Registrar lo que llega</button>' +
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
    if (pestana === 'alertas') verAlertas();
    else if (pestana === 'catalogo') verCatalogo();
    else verConteo();
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
    });
  }

  function tarjeta(n, txt, clase) {
    return '<div class="cifra ' + (clase || '') + '"><b>' + n + '</b><span>' + txt + '</span></div>';
  }

  function bloque(titulo, filas, conBaja) {
    if (!filas.length) return '';
    return '<h3 class="sub-t">' + titulo + '</h3>' +
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
     CATÁLOGO — de aquí sale el registro de lo que llega
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
      '<h3 class="sub-t">Registrar mercancía que llega</h3>' +
      '<p class="sub">Busca el medicamento en el catálogo y verás cuánto hay antes de elegir. ' +
      'Puedes sumar a un lote que ya existe o abrir uno nuevo.</p>' +
      '<div class="chips" id="catFiltros">' + FILTROS_CAT.map(function (f) {
        return '<button type="button" data-f="' + f.id + '">' + f.txt + '</button>';
      }).join('') + '</div>' +
      '<label for="catBusca">Buscar</label>' +
      '<input id="catBusca" type="search" autocomplete="off" placeholder="Nombre del medicamento o insumo…">' +
      '<div id="catLista"></div>' +
      '<div id="catDetalle"></div>';

    var caja = document.getElementById('catBusca');
    caja.value = cat.busca;
    caja.addEventListener('input', retardo(function () {
      cat.busca = caja.value.trim(); cat.pagina = 0; cargarCatalogo();
    }, 300));

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
    document.getElementById('catDetalle').innerHTML = '';
    limpiaAviso();   // cambiar de filtro, buscar o pasar de página: se limpia
    z.innerHTML = '<div class="cargando">Buscando…</div>';
    cat.cargando = true;

    var q = sb.from('v_catalogo')
      .select('producto_id,producto,dosificacion,presentacion,categoria,disponible,vencido,lotes,lotes_con_existencia,vence_primero,situacion',
              { count: 'exact' });

    if (cat.filtro === 'con')     q = q.gt('disponible', 0);
    if (cat.filtro === 'sin')     q = q.lte('disponible', 0);
    if (cat.filtro === 'vence')   q = q.in('situacion', ['por_vencer_30', 'por_vencer_90']);
    if (cat.filtro === 'vencido') q = q.eq('situacion', 'solo_vencido');
    if (cat.busca.length >= 2) q = q.ilike('busqueda', '*' + sinAcentos(cat.busca).replace(/[%,()]/g, '') + '*');

    var desde = cat.pagina * POR_PAGINA;
    q.order('producto').range(desde, desde + POR_PAGINA - 1).then(function (r) {
      cat.cargando = false;
      var zz = document.getElementById('catLista');
      if (!zz) return;   // cambió de pantalla mientras cargaba
      if (r.error) { zz.innerHTML = '<div class="aviso bad">' + esc(r.error.message) + '</div>'; return; }
      cat.filas = r.data || [];
      cat.total = r.count == null ? cat.filas.length : r.count;
      pintarCatalogo();
    });
  }

  function pintarCatalogo() {
    var z = document.getElementById('catLista');
    if (!z) return;

    if (!cat.filas.length) {
      z.innerHTML = '<div class="vacio"><b>No hay nada con ese filtro.</b>' +
        (cat.busca ? '<span>No encontré «' + esc(cat.busca) + '» en el catálogo.</span>' +
          '<button type="button" class="principal" id="catNuevo">Crear «' + esc(cat.busca) + '» en el catálogo</button>'
          : '<span>Prueba con otro filtro.</span>') + '</div>';
      var bn = document.getElementById('catNuevo');
      if (bn) bn.addEventListener('click', function () { crearProducto(cat.busca); });
      return;
    }

    z.innerHTML =
      contador(cat, 'medicamento', 'medicamentos') +
      '<div class="fichas">' + cat.filas.map(function (x, i) {
        var hay = Number(x.disponible) || 0;
        return '<button type="button" class="ficha" data-i="' + i + '">' +
          '<div class="ficha-nom"><b>' + esc(x.producto) + '</b>' +
            (x.dosificacion || x.presentacion
              ? '<span class="ficha-pres">' + esc([x.dosificacion, x.presentacion].filter(Boolean).join(' · ')) + '</span>'
              : '') +
          '</div>' +
          '<div class="ficha-datos">' +
            '<span class="ficha-cant ' + (hay > 0 ? '' : 'cero') + '">' + num(hay) +
              '<em>' + (hay === 1 ? 'unidad' : 'unidades') + '</em></span>' +
            '<span class="ficha-lotes">' + x.lotes + (x.lotes === 1 ? ' lote' : ' lotes') +
              (Number(x.vencido) > 0 ? ' · ' + num(x.vencido) + ' vencidas' : '') + '</span>' +
            (x.vence_primero ? '<span class="ficha-vence">vence ' + fecha(x.vence_primero) + '</span>' : '') +
          '</div>' +
          sit(x.situacion) +
        '</button>';
      }).join('') + '</div>' +
      paginador(cat, 'cat');

    z.querySelectorAll('.ficha').forEach(function (b) {
      b.addEventListener('click', function () { verProducto(cat.filas[+b.dataset.i]); });
    });
    engancharPaginador(z, cat, cargarCatalogo);
  }

  /* ---------- un medicamento y sus lotes ---------- */
  function verProducto(p) {
    var z = document.getElementById('catDetalle');
    document.getElementById('catLista').innerHTML = '';
    z.innerHTML = '<div class="cargando">Buscando sus lotes…</div>';

    sb.from('v_existencia_lote')
      .select('lote_id,lote,vence,existencia,situacion,estado')
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
              '<span><b>' + num(p.disponible) + '</b> disponibles</span>' +
              (Number(p.vencido) > 0 ? '<span class="mal"><b>' + num(p.vencido) + '</b> vencidas</span>' : '') +
              '<span><b>' + lotes.length + '</b> ' + (lotes.length === 1 ? 'lote' : 'lotes') + '</span>' +
            '</div>' +
          '</div>' +

          (lotes.length
            ? '<h3 class="sub-t">Lotes que ya tiene</h3>' +
              '<p class="sub">Si lo que llegó es de un lote que ya está aquí, súmaselo. ' +
              'Así no se parte la existencia en dos.</p>' +
              '<div class="tabla-caja"><table class="tabla"><thead><tr>' +
                '<th>Lote</th><th>Vence</th><th class="der">Existencia</th><th>Situación</th><th></th>' +
              '</tr></thead><tbody>' +
              lotes.map(function (l, i) {
                return '<tr><td><b>' + esc(l.lote || 'sin número') + '</b></td>' +
                  '<td>' + fecha(l.vence) + '</td>' +
                  '<td class="der num">' + num(l.existencia) + '</td>' +
                  '<td>' + sit(l.situacion) + '</td>' +
                  '<td class="der">' + (l.situacion === 'vencido'
                    ? '<span class="sub chico">vencido</span>'
                    : '<button type="button" class="suave" data-suma="' + i + '">Sumar</button>') + '</td></tr>';
              }).join('') +
              '</tbody></table></div>'
            : '<div class="vacio"><b>Todavía no tiene ningún lote.</b>' +
              '<span>Registra el primero abajo.</span></div>') +

          '<h3 class="sub-t">Registrar un lote nuevo</h3>' +
          '<div id="catForm"></div>';

        document.getElementById('catVolver').addEventListener('click', function () {
          document.getElementById('catDetalle').innerHTML = '';
          pintarCatalogo();
        });
        zz.querySelectorAll('[data-suma]').forEach(function (b) {
          b.addEventListener('click', function () { formSumar(p, lotes[+b.dataset.suma]); });
        });
        formLoteNuevo(p, lotes);
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
      '<label for="sCant">Cuántas unidades llegaron</label>' +
      '<input id="sCant" type="number" min="1" inputmode="numeric" autocomplete="off">' +
      '<p class="sub chico" id="sQueda"></p>' +
      '<div class="botonera"><button type="button" class="principal" id="sGuardar">Sumar al lote</button></div>';

    var caja = document.getElementById('sCant');
    caja.focus();
    caja.addEventListener('input', function () {
      var n = parseInt(caja.value, 10);
      document.getElementById('sQueda').textContent = n > 0
        ? 'El lote quedaría con ' + num(Number(l.existencia) + n) + ' unidades.' : '';
    });
    document.getElementById('sCancelar').addEventListener('click', function () { formLoteNuevo(p, null); });

    document.getElementById('sGuardar').addEventListener('click', function () {
      var n = parseInt(caja.value, 10);
      if (!n || n < 1) { aviso('warn', 'Falta cuántas unidades llegaron.'); caja.focus(); return; }
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
      '<label for="lCant">Cuántas unidades llegaron</label>' +
      '<input id="lCant" type="number" min="1" inputmode="numeric" autocomplete="off">' +
      '<div class="botonera">' +
        '<button type="button" class="principal" id="lGuardar">Registrar la entrada</button>' +
      '</div>';

    var iCod = document.getElementById('lCodigo');
    var iVen = document.getElementById('lVence');

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
      var hoy = new Date().toISOString().slice(0, 10);
      av.innerHTML = iVen.value < hoy
        ? '<span class="mal">Esa fecha ya pasó: entraría vencido y no se podrá entregar.</span>'
        : '';
    });

    document.getElementById('lGuardar').addEventListener('click', function () {
      var cod = iCod.value.trim() || null;
      var ven = iVen.value || null;
      var can = parseInt(document.getElementById('lCant').value, 10);
      if (!can || can < 1) { aviso('warn', 'Falta cuántas unidades llegaron.'); return; }
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

  function crearProducto(nombre) {
    sb.from('productos').insert({ nombre: nombre.toUpperCase(), categoria: 'medicamento' })
      .select().single().then(function (r) {
        if (r.error) {
          aviso('bad', r.error.code === '23505'
            ? 'Ese medicamento ya está en el catálogo, búscalo arriba.'
            : 'No se pudo crear: ' + r.error.message);
          return;
        }
        aviso('ok', r.data.nombre + ' quedó en el catálogo. Ahora regístrale su primer lote.');
        verProducto({ producto_id: r.data.id, producto: r.data.nombre,
                      dosificacion: null, presentacion: null, disponible: 0, vencido: 0 });
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
      '<h3 class="sub-t">Corregir existencia tras un conteo</h3>' +
      '<p class="sub">Escribe en la columna <b>Hay de verdad</b> lo que contaste. ' +
      'Puedes corregir muchos de una vez y guardarlos todos juntos. ' +
      'Con <b>Enter</b> pasas al siguiente renglón, como en una hoja de cálculo.</p>' +
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
      .select('lote_id,producto,dosificacion,lote,vence,existencia,situacion', { count: 'exact' })
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
        '<th>Medicamento</th><th>Lote</th><th>Vence</th>' +
        '<th class="der">Sistema dice</th><th class="der">Hay de verdad</th><th class="der">Diferencia</th>' +
      '</tr></thead><tbody>' +
      hoja.filas.map(function (x, i) {
        var sis = Math.round(Number(x.existencia) || 0);
        var c = hoja.cambios[x.lote_id];
        var real = c ? c.real : sis;
        var dif = real - sis;
        return '<tr data-lote="' + x.lote_id + '"' + (dif ? ' class="cambiada"' : '') + '>' +
          '<td class="c-med"><b>' + esc(x.producto) + '</b>' +
            (x.dosificacion ? ' <span class="sub chico">' + esc(x.dosificacion) + '</span>' : '') + '</td>' +
          '<td data-col="Lote">' + esc(x.lote || '—') + '</td>' +
          '<td data-col="Vence">' + fecha(x.vence) + ' ' + sit(x.situacion) + '</td>' +
          '<td class="der num" data-col="Sistema dice">' + num(sis) + '</td>' +
          '<td class="der c-celda" data-col="Hay de verdad">' +
            '<input class="celda" type="number" min="0" inputmode="numeric" ' +
            'data-i="' + i + '" data-sis="' + sis + '" value="' + real + '" aria-label="Hay de verdad"></td>' +
          '<td class="der num dif" data-col="Diferencia">' + (dif ? (dif > 0 ? '+' : '') + num(dif) : '—') + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>' +
      paginador(hoja, 'hoja');

    var celdas = z.querySelectorAll('.celda');
    celdas.forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = +inp.dataset.i, sis = +inp.dataset.sis;
        var fila = hoja.filas[i];
        var real = parseInt(inp.value, 10);
        var tr = inp.closest('tr');
        if (isNaN(real) || real < 0 || real === sis) {
          delete hoja.cambios[fila.lote_id];
          tr.classList.remove('cambiada');
          tr.querySelector('.dif').textContent = '—';
        } else {
          hoja.cambios[fila.lote_id] = { real: real, sis: sis, producto: fila.producto, lote: fila.lote };
          tr.classList.add('cambiada');
          var d = real - sis;
          tr.querySelector('.dif').textContent = (d > 0 ? '+' : '') + num(d);
        }
        pintarGuardar();
      });
      /* Enter baja al siguiente renglón, como en una hoja de cálculo. */
      inp.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        var sig = celdas[+inp.dataset.i + 1];
        if (sig) { sig.focus(); sig.select(); }
        else { var b = document.getElementById('hGuardar'); if (b) b.focus(); }
      });
      inp.addEventListener('focus', function () { inp.select(); });
    });

    engancharPaginador(z, hoja, cargarHoja);
    pintarGuardar();
  }

  function pintarGuardar() {
    var z = document.getElementById('hojaGuardar');
    if (!z) return;
    var claves = Object.keys(hoja.cambios);
    if (!claves.length) { z.innerHTML = ''; return; }

    var suben = claves.filter(function (k) { return hoja.cambios[k].real > hoja.cambios[k].sis; }).length;
    var bajan = claves.length - suben;

    z.innerHTML =
      '<div class="barra-guardar">' +
        '<div class="bg-txt"><b>' + claves.length +
          (claves.length === 1 ? ' renglón cambiado' : ' renglones cambiados') + '</b>' +
          '<span>' + (suben ? suben + ' con más de lo que decía el sistema' : '') +
          (suben && bajan ? ' · ' : '') +
          (bajan ? bajan + ' con menos' : '') + '</span></div>' +
        '<label for="hMotivo">Por qué no cuadra <span class="opc">(queda en la bitácora)</span></label>' +
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
      aviso('warn', 'Escribe por qué no cuadra: queda en la bitácora.');
      document.getElementById('hMotivo').focus();
      return;
    }
    var btn = document.getElementById('hGuardar');
    btn.disabled = true; btn.textContent = 'Guardando…';

    /* Todos los ajustes van en una sola petición: o entran todos o no
       entra ninguno. Así no queda un conteo a medio guardar. */
    var filas = claves.map(function (k) {
      var c = hoja.cambios[k];
      return { lote_id: k, tipo: 'ajuste', cantidad: c.real - c.sis,
               motivo: motivo, origen: 'sistema' };
    });

    sb.from('movimientos').insert(filas).then(function (r) {
      if (r.error) {
        aviso('bad', 'No se guardó nada: ' + r.error.message);
        btn.disabled = false;
        btn.textContent = 'Guardar ' + claves.length + (claves.length === 1 ? ' corrección' : ' correcciones');
        return;
      }
      aviso('ok', 'Guardadas ' + claves.length +
                  (claves.length === 1 ? ' corrección' : ' correcciones') +
                  '. Quedaron registradas con tu nombre y el motivo.');
      hoja.cambios = {};
      cargarHoja();
    });
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
    sb = cliente; ancla = contenedor; pestana = 'alertas';
    cat  = { filtro: 'todos', busca: '', pagina: 0, total: 0, filas: [], cargando: false };
    hoja = { filtro: 'con',   busca: '', pagina: 0, total: 0, filas: [], cambios: {}, cargando: false };
    pintar();
  };
})();
