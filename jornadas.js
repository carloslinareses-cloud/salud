/* JORNADAS: el registro de las jornadas de salud y la ruta materna.

   Es una base APARTE de "Personas": no toca pacientes, ni tratamientos,
   ni patologías del sistema general. Aquí se guarda tal cual lo que
   trae el cuaderno de cada jornada -Items, Fecha, Nombre y apellido,
   Edad, Sexo, Cédula, Teléfono, Dirección y Tratamiento- para poder
   consultarlo, agregarlo y corregirlo desde la página.

   Dos pantallas:
     · Lista  — buscar por nombre o cédula, filtrar por conjunto y estado.
     · Ficha  — agregar una nueva o corregir una ya cargada. */
(function () {
  'use strict';

  var POR_PAGINA = 50;

  var CONJUNTOS = { jornadas: 'Jornada de salud', ruta_materna: 'Ruta materna' };

  /* Las hojas del Excel de donde salió cada registro. "Octubre a diciembre"
     todavía no tiene filas -esa hoja aún no se llenó cuando se cargó la
     base- pero se deja lista para cuando llegue, con el mismo nombre que
     trae la pestaña del Excel. */
  var HOJAS = [
    { v: 'JORNADAS 2026', t: 'Jornadas 2026' },
    { v: 'JULIO A SEPTIEMBRE', t: 'Julio a septiembre' },
    { v: 'OCTUBRE A DICIEMBRE', t: 'Octubre a diciembre' },
    { v: 'RUTA MATERNA MES JULIO', t: 'Ruta materna (julio)' }
  ];
  var HOJAS_TXT = {};
  HOJAS.forEach(function (h) { HOJAS_TXT[h.v] = h.t; });

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function corta(f) {
    if (!f) return '';
    var p = String(f).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(f);
  }
  function retardo(fn, ms) {
    var t; return function () { var a = arguments, s = this;
      clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  }
  function hoyEs() {
    return window.FARM && window.FARM.hoyCaracas
      ? window.FARM.hoyCaracas() : new Date().toISOString().slice(0, 10);
  }
  function estadoChip(e) {
    return e === 'por_revisar'
      ? '<span class="sit ojo">Por revisar</span>'
      : '<span class="sit ok">Activo</span>';
  }

  var CAMPOS = 'id,conjunto,hoja_origen,item,fecha,nombre,edad_texto,sexo,cedula,' +
               'telefono,direccion,tratamiento,estado,motivo_revision';

  /* ================================================================ */
  function Jornadas(sb, raiz, pfx) {
    this.sb = sb; this.raiz = raiz; this.pfx = pfx;
    this.modo = 'lista';           // lista | nuevo | ficha
    this.busca = '';
    this.conjunto = 'todos';       // todos | jornadas | ruta_materna
    this.hoja = 'todos';           // todos | una de HOJAS
    this.estado = 'todos';         // todos | activo | por_revisar
    this.pagina = 0; this.total = 0; this.filas = [];
    this.pedido = 0;
    this.quien = null;             // el registro abierto para corregir
  }

  Jornadas.prototype.id = function (n) { return this.pfx + n; };
  Jornadas.prototype.q = function (n) { return this.raiz.querySelector('#' + this.pfx + n); };
  Jornadas.prototype.aviso = function (clase, txt) {
    var z = this.q('Aviso');
    if (!z) return;
    z.innerHTML = '<div class="aviso ' + clase + '" role="status">' + esc(txt) + '</div>';
    if (z.scrollIntoView) z.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  Jornadas.prototype.limpiaAviso = function () {
    var z = this.q('Aviso'); if (z) z.innerHTML = '';
  };

  Jornadas.prototype.pintar = function () {
    var t = this;
    t.raiz.innerHTML = '<div id="' + t.id('Zona') + '"></div><div id="' + t.id('Aviso') + '"></div>';
    if (t.modo === 'lista') t.verLista();
    else t.verFormulario(t.modo === 'ficha' ? t.quien : null);
  };

  /* ================================================================
     LISTA
  ================================================================ */
  Jornadas.prototype.verLista = function () {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Zona');
    z.innerHTML =
      '<div class="cabecera-prod">' +
        '<h2>Jornadas y ruta materna</h2>' +
        '<button type="button" class="principal" id="' + i('Nueva') + '">+ Registrar</button>' +
      '</div>' +
      '<p class="sub">Lo que trae el cuaderno de cada jornada, aparte del sistema general de pacientes.</p>' +
      '<div class="filtros">' +
        '<input id="' + i('Busca') + '" type="search" ' +
          'placeholder="Buscar por nombre, cédula, teléfono, dirección, comuna o tratamiento…" ' +
          'value="' + esc(t.busca) + '">' +
        '<select id="' + i('Conj') + '">' +
          '<option value="todos">Todos los conjuntos</option>' +
          '<option value="jornadas"' + (t.conjunto === 'jornadas' ? ' selected' : '') + '>Jornada de salud</option>' +
          '<option value="ruta_materna"' + (t.conjunto === 'ruta_materna' ? ' selected' : '') + '>Ruta materna</option>' +
        '</select>' +
        '<select id="' + i('Hoja') + '">' +
          '<option value="todos">Todas las hojas</option>' +
          HOJAS.map(function (h) {
            return '<option value="' + esc(h.v) + '"' + (t.hoja === h.v ? ' selected' : '') + '>' + esc(h.t) + '</option>';
          }).join('') +
        '</select>' +
        '<select id="' + i('Est') + '">' +
          '<option value="todos">Todos los estados</option>' +
          '<option value="activo"' + (t.estado === 'activo' ? ' selected' : '') + '>Activos</option>' +
          '<option value="por_revisar"' + (t.estado === 'por_revisar' ? ' selected' : '') + '>Por revisar</option>' +
        '</select>' +
      '</div>' +
      '<div id="' + i('Res') + '"></div>' +
      '<div id="' + i('Pag') + '" class="paginas"></div>';

    t.q('Nueva').addEventListener('click', function () { t.modo = 'nuevo'; t.quien = null; t.pintar(); });
    t.q('Busca').addEventListener('input', retardo(function () {
      t.busca = t.q('Busca').value.trim(); t.pagina = 0; t.buscar();
    }, 350));
    t.q('Conj').addEventListener('change', function () { t.conjunto = t.q('Conj').value; t.pagina = 0; t.buscar(); });
    t.q('Hoja').addEventListener('change', function () { t.hoja = t.q('Hoja').value; t.pagina = 0; t.buscar(); });
    t.q('Est').addEventListener('change', function () { t.estado = t.q('Est').value; t.pagina = 0; t.buscar(); });

    t.buscar();
  };

  Jornadas.prototype.buscar = function () {
    var t = this;
    var z = t.q('Res');
    z.innerHTML = '<p class="cargando">Buscando…</p>';
    var pedido = ++t.pedido;

    var qy = t.sb.from('jornadas_registros').select(CAMPOS, { count: 'exact' });
    if (t.busca) {
      var b = t.busca.replace(/[%_]/g, '\\$&');
      qy = qy.or(
        'nombre.ilike.%' + b + '%,' +
        'cedula.ilike.%' + b + '%,' +
        'telefono.ilike.%' + b + '%,' +
        'direccion.ilike.%' + b + '%,' +
        'tratamiento.ilike.%' + b + '%,' +
        'item.ilike.%' + b + '%'
      );
    }
    if (t.conjunto !== 'todos') qy = qy.eq('conjunto', t.conjunto);
    if (t.hoja !== 'todos') qy = qy.eq('hoja_origen', t.hoja);
    if (t.estado !== 'todos') qy = qy.eq('estado', t.estado);
    qy = qy.order('nombre').range(t.pagina * POR_PAGINA, t.pagina * POR_PAGINA + POR_PAGINA - 1);

    qy.then(function (r) {
      if (pedido !== t.pedido) return;   // llegó tarde una búsqueda vieja
      if (r.error) { z.innerHTML = '<div class="aviso bad">No se pudo buscar: ' + esc(r.error.message) + '</div>'; return; }
      t.filas = r.data || []; t.total = r.count || 0;
      t.pintarLista();
    });
  };

  /* Una ficha por persona, con TODO lo que trae el cuaderno -no solo
     nombre y cédula- para no tener que abrirla nada más para ver el
     teléfono o la comuna. */
  Jornadas.prototype.pintarLista = function () {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Res');
    if (!t.filas.length) {
      z.innerHTML = '<div class="vacio">' +
        (t.busca || t.conjunto !== 'todos' || t.hoja !== 'todos' || t.estado !== 'todos'
          ? 'Nadie coincide con lo que buscas.' : 'Todavía no hay nada cargado.') +
        '</div>';
      t.q('Pag').innerHTML = '';
      return;
    }
    z.innerHTML =
      '<p class="conteo">' + t.total + (t.total === 1 ? ' registro' : ' registros') + '</p>' +
      '<div class="fichas">' + t.filas.map(function (f) {
        var quien = [];
        quien.push(f.cedula ? 'C.I. ' + f.cedula : 'Sin cédula');
        if (f.edad_texto) quien.push(f.edad_texto);
        if (f.sexo) quien.push(f.sexo === 'F' ? 'Femenino' : 'Masculino');

        var contacto = [];
        if (f.telefono) contacto.push(f.telefono);
        if (f.direccion) contacto.push(f.direccion);

        var cuando = [corta(f.fecha), CONJUNTOS[f.conjunto] || f.conjunto];
        if (f.hoja_origen) cuando.push(HOJAS_TXT[f.hoja_origen] || f.hoja_origen);

        return '<button type="button" class="ficha" data-id="' + esc(f.id) + '">' +
          '<div class="ficha-nom">' +
            '<b>' + esc(f.nombre) + '</b>' +
            '<span class="ficha-pres">' + esc(quien.join(' · ')) + '</span>' +
            (contacto.length ? '<span class="ficha-pres">' + esc(contacto.join(' · ')) + '</span>' : '') +
            (f.item ? '<span class="ficha-pres">' + esc(f.item) + '</span>' : '') +
          '</div>' +
          '<div class="ficha-datos">' +
            '<span class="ficha-lotes">' + esc(f.tratamiento || 'Sin tratamiento anotado') + '</span>' +
            '<span class="ficha-vence">' + esc(cuando.filter(Boolean).join(' · ')) + '</span>' +
          '</div>' +
          estadoChip(f.estado) +
        '</button>';
      }).join('') + '</div>';

    z.querySelectorAll('[data-id]').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = t.filas.filter(function (x) { return x.id === b.dataset.id; })[0];
        if (f) { t.modo = 'ficha'; t.quien = f; t.pintar(); }
      });
    });

    var paginas = Math.max(1, Math.ceil(t.total / POR_PAGINA));
    var pz = t.q('Pag');
    if (paginas <= 1) { pz.innerHTML = ''; return; }
    pz.innerHTML =
      '<div class="paginador">' +
        '<button type="button" id="' + i('Ant') + '"' + (t.pagina === 0 ? ' disabled' : '') + '>Anteriores</button>' +
        '<span>' + (t.pagina * POR_PAGINA + 1) + '–' + Math.min(t.total, (t.pagina + 1) * POR_PAGINA) +
          ' de ' + t.total + '</span>' +
        '<button type="button" id="' + i('Sig') + '"' + (t.pagina >= paginas - 1 ? ' disabled' : '') + '>Siguientes</button>' +
      '</div>';
    var ant = t.q('Ant'), sig = t.q('Sig');
    if (ant) ant.addEventListener('click', function () { t.pagina--; t.buscar(); });
    if (sig) sig.addEventListener('click', function () { t.pagina++; t.buscar(); });
  };

  /* ================================================================
     FORMULARIO — nuevo y corregir comparten los mismos campos
  ================================================================ */
  Jornadas.prototype.verFormulario = function (x) {
    var t = this, i = function (n) { return t.id(n); };
    var z = t.q('Zona');
    x = x || {};
    var conj = x.conjunto || 'jornadas';

    z.innerHTML =
      '<button type="button" class="volver" id="' + i('Volver') + '">← Volver a la lista</button>' +
      '<h2>' + (t.modo === 'ficha' ? 'Corregir registro' : 'Registrar en jornadas') + '</h2>' +

      '<label>Conjunto</label>' +
      '<div class="chips" id="' + i('Conjunto') + '">' +
        '<button type="button" data-v="jornadas"' + (conj === 'jornadas' ? ' class="on"' : '') + '>Jornada de salud</button>' +
        '<button type="button" data-v="ruta_materna"' + (conj === 'ruta_materna' ? ' class="on"' : '') + '>Ruta materna</button>' +
      '</div>' +

      '<div class="dos-columnas">' +
        '<div><label for="' + i('Fecha') + '">Fecha</label>' +
          '<input id="' + i('Fecha') + '" type="date" value="' + esc(x.fecha ? String(x.fecha).slice(0, 10) : '') + '"></div>' +
        '<div><label for="' + i('Item') + '">Comuna / sector <span class="opc">(opcional)</span></label>' +
          '<input id="' + i('Item') + '" type="text" autocomplete="off" value="' + esc(x.item || '') + '"></div>' +
      '</div>' +

      '<label for="' + i('Nombre') + '">Nombre y apellido</label>' +
      '<input id="' + i('Nombre') + '" type="text" autocomplete="off" value="' + esc(x.nombre || '') + '">' +

      '<div class="dos-columnas">' +
        '<div><label for="' + i('Edad') + '">Edad <span class="opc">(tal como se anotó)</span></label>' +
          '<input id="' + i('Edad') + '" type="text" placeholder="Ej: 34, 2 AÑOS, 11 DIAS" ' +
          'value="' + esc(x.edad_texto || '') + '"></div>' +
        '<div><label>Sexo</label>' +
          '<div class="chips" id="' + i('Sexo') + '">' +
            '<button type="button" data-v="F"' + (x.sexo === 'F' ? ' class="on"' : '') + '>Femenino</button>' +
            '<button type="button" data-v="M"' + (x.sexo === 'M' ? ' class="on"' : '') + '>Masculino</button>' +
            '<button type="button" data-v=""' + (!x.sexo ? ' class="on"' : '') + '>No lo dice</button>' +
          '</div></div>' +
      '</div>' +

      '<div class="dos-columnas">' +
        '<div><label for="' + i('Cedula') + '">Cédula <span class="opc">(opcional)</span></label>' +
          '<input id="' + i('Cedula') + '" type="text" inputmode="numeric" autocomplete="off" ' +
          'placeholder="Solo números" value="' + esc(x.cedula || '') + '"></div>' +
        '<div><label for="' + i('Telefono') + '">Teléfono <span class="opc">(opcional)</span></label>' +
          '<input id="' + i('Telefono') + '" type="tel" inputmode="tel" autocomplete="off" ' +
          'value="' + esc(x.telefono || '') + '"></div>' +
      '</div>' +

      '<label for="' + i('Direccion') + '">Dirección <span class="opc">(opcional)</span></label>' +
      '<input id="' + i('Direccion') + '" type="text" autocomplete="off" value="' + esc(x.direccion || '') + '">' +

      '<label for="' + i('Tratamiento') + '">Tratamiento <span class="opc">(opcional)</span></label>' +
      '<input id="' + i('Tratamiento') + '" type="text" autocomplete="off" value="' + esc(x.tratamiento || '') + '">' +

      (t.modo === 'ficha' && x.motivo_revision
        ? '<p class="sub chico ojo">Quedó marcado "por revisar" porque: ' + esc(x.motivo_revision) + '</p>' : '') +

      '<div class="pie-form">' +
        '<button type="button" class="principal" id="' + i('Guardar') + '">' +
          (t.modo === 'ficha' ? 'Guardar los cambios' : 'Registrar') + '</button>' +
        (t.modo === 'ficha'
          ? '<button type="button" class="suave" id="' + i('Borrar') + '">Borrar este registro</button>' : '') +
      '</div>';

    ['Conjunto', 'Sexo'].forEach(function (g) {
      var zz = t.q(g);
      if (!zz) return;
      zz.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          zz.querySelectorAll('button').forEach(function (o) { o.classList.remove('on'); });
          b.classList.add('on');
        });
      });
    });

    t.q('Volver').addEventListener('click', function () { t.modo = 'lista'; t.quien = null; t.pintar(); });
    t.q('Guardar').addEventListener('click', function () { t.guardar(x.id || null); });
    var btnBorrar = t.q('Borrar');
    if (btnBorrar) btnBorrar.addEventListener('click', function () { t.borrar(x.id); });
  };

  Jornadas.prototype.elegido = function (g) {
    var z = this.q(g);
    var b = z && z.querySelector('button.on');
    return b ? b.dataset.v : '';
  };

  Jornadas.prototype.leerCampos = function () {
    var t = this;
    return {
      conjunto: t.elegido('Conjunto') || 'jornadas',
      fecha: t.q('Fecha').value || null,
      item: t.q('Item').value.trim() || null,
      nombre: t.q('Nombre').value.trim().replace(/\s+/g, ' '),
      edad_texto: t.q('Edad').value.trim() || null,
      sexo: t.elegido('Sexo') || null,
      cedula: t.q('Cedula').value.replace(/\D/g, '') || null,
      telefono: t.q('Telefono').value.trim() || null,
      direccion: t.q('Direccion').value.trim() || null,
      tratamiento: t.q('Tratamiento').value.trim() || null
    };
  };

  Jornadas.prototype.valida = function (d) {
    if (!d.nombre || d.nombre.length < 4) return 'Escribe el nombre y el apellido completos.';
    if (d.cedula && !/^\d{6,9}$/.test(d.cedula)) return 'La cédula debe tener entre 6 y 9 números.';
    if (d.fecha && d.fecha > hoyEs()) return 'La fecha no puede ser futura.';
    return null;
  };

  Jornadas.prototype.guardar = function (idExistente) {
    var t = this;
    var d = t.leerCampos();
    var mal = t.valida(d);
    if (mal) { t.aviso('warn', mal); return; }

    var motivos = [];
    if (!d.cedula) motivos.push('cedula vacia');
    if (!d.sexo) motivos.push('sexo vacio');
    d.estado = motivos.length ? 'por_revisar' : 'activo';
    d.motivo_revision = motivos.length ? motivos.join(' | ') + ' (cargado desde la página, no del excel)' : null;

    var btn = t.q('Guardar');
    btn.disabled = true; btn.textContent = 'Guardando…';

    var accion = idExistente
      ? t.sb.from('jornadas_registros').update(d).eq('id', idExistente).select().single()
      : t.sb.from('jornadas_registros').insert(d).select().single();

    accion.then(function (r) {
      btn.disabled = false; btn.textContent = idExistente ? 'Guardar los cambios' : 'Registrar';
      if (r.error) { t.aviso('bad', 'No se pudo guardar: ' + esc(r.error.message)); return; }
      t.modo = 'lista'; t.quien = null;
      t.pintar();
      t.aviso('ok', d.nombre + (idExistente ? ' quedó corregida.' : ' quedó registrada.'));
    });
  };

  Jornadas.prototype.borrar = function (id) {
    var t = this;
    if (!window.confirm('¿Borrar este registro? No se puede deshacer.')) return;
    t.sb.from('jornadas_registros').delete().eq('id', id).then(function (r) {
      if (r.error) { t.aviso('bad', 'No se pudo borrar: ' + esc(r.error.message)); return; }
      t.modo = 'lista'; t.quien = null;
      t.pintar();
      t.aviso('ok', 'Se borró el registro.');
    });
  };

  window.PANTALLA_JORNADAS = function (cliente, contenedor, opciones) {
    var o = opciones || {};
    var t = new Jornadas(cliente, contenedor, o.prefijo || 'jo');
    t.pintar();
    return t;
  };
})();
