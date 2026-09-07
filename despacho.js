/* Pantalla de ENTREGA de medicamentos.
   La usan los despachadores todo el día, casi siempre desde el teléfono.
   Objetivo: de que llega la persona a que queda registrada la entrega,
   en el menor número de toques posible. */
(function () {
  'use strict';

  var sb = null, ancla = null, cesta = [], destino = null, modo = 'paciente', yo = null;

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fecha(f) {
    if (!f) return '—';
    var p = String(f).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : f;
  }
  function sinAcentos(t) {
    return window.FARM && window.FARM.sinAcentos
      ? window.FARM.sinAcentos(t)
      : String(t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
  }
  function retardo(fn, ms) {
    var t; return function () {
      var a = arguments, s = this;
      clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms);
    };
  }

  /* ---------------------------------------------------------------- armazón */
  function pintar() {
    ancla.innerHTML =
      '<div class="tarjeta">' +
        '<div class="conmuta">' +
          '<button type="button" class="on" data-modo="paciente">A una persona</button>' +
          '<button type="button" data-modo="institucion">A un centro (CDI)</button>' +
        '</div>' +
        '<div id="zonaDestino"></div>' +
      '</div>' +
      '<div class="tarjeta" id="zonaCesta"></div>' +
      '<div id="zonaAviso"></div>';

    ancla.querySelectorAll('.conmuta button').forEach(function (b) {
      b.addEventListener('click', function () {
        modo = b.dataset.modo; destino = null; cesta = [];
        bus = { busca: '', pagina: 0, total: 0, filas: [], cargando: false };
        ancla.querySelectorAll('.conmuta button').forEach(function (x) {
          x.classList.toggle('on', x === b);
        });
        pintarDestino(); pintarCesta();
      });
    });
    pintarDestino(); pintarCesta();
  }

  /* ================================================================
     A QUIÉN SE LE ENTREGA

     Se puede ver la lista completa sin escribir nada, y cada renglón
     dice lo suficiente para reconocer a la persona: su edad, su
     teléfono, cuántos medicamentos toma y cuándo retiró por última vez.
     Con dos personas del mismo nombre, eso es lo que las distingue.
  ================================================================ */
  var POR_PAGINA = 20;
  var bus = { busca: '', pagina: 0, total: 0, filas: [], cargando: false };

  var TIPOS_CENTRO = ['CDI', 'Ambulatorio', 'Consultorio Popular',
                      'Base de Misiones', 'Hospital', 'Otro'];

  function pintarDestino() {
    var z = document.getElementById('zonaDestino');
    if (!z) return;

    /* ---- ya está elegido: su ficha y su tratamiento ---- */
    if (destino) {
      z.innerHTML =
        '<div class="elegido">' +
          '<div><b>' + esc(destino.titulo) + '</b><span>' + esc(destino.sub) + '</span></div>' +
          '<button type="button" class="quitar" id="cambiarDestino">Cambiar</button>' +
        '</div>' +
        (destino.detalle ? '<p class="sub chico">' + esc(destino.detalle) + '</p>' : '') +
        pintarTratamiento() +
        (modo === 'institucion' ?
          '<h2 class="sub-t">Quién recibe</h2>' +
          '<p class="sub">Hace falta para el acta de entrega-recepción.</p>' +
          '<label for="recibeNombre">Nombre y apellido de quien firma</label>' +
          '<input id="recibeNombre" type="text" autocomplete="off"' +
            (destino.responsable ? ' value="' + esc(destino.responsable) + '"' : '') + '>' +
          '<label for="recibeCedula">Su cédula</label>' +
          '<input id="recibeCedula" type="text" inputmode="numeric" placeholder="Solo números">' : '');

      document.getElementById('cambiarDestino').addEventListener('click', function () {
        destino = null; bus.pagina = 0; pintarDestino();
      });
      var conProd = (destino.tratamiento || []).filter(function (x) { return x.producto_id; });
      z.querySelectorAll('[data-trat]').forEach(function (b) {
        b.addEventListener('click', function () { agregarDelTratamiento(conProd[+b.dataset.trat]); });
      });
      return;
    }

    /* ---- todavía no: buscar o crear ---- */
    var esPac = modo === 'paciente';
    z.innerHTML =
      '<div class="busca-fila">' +
        '<div class="busca-campo">' +
          '<label for="buscaDestino">' + (esPac ? 'Buscar a la persona' : 'Buscar el centro de salud') + '</label>' +
          '<input id="buscaDestino" type="search" autocomplete="off" ' +
            'placeholder="' + (esPac ? 'Cédula o nombre…' : 'Nombre del centro…') + '">' +
        '</div>' +
        '<button type="button" class="secundario" id="btnNuevoDestino">+ ' +
          (esPac ? 'Registrar persona' : 'Registrar centro') + '</button>' +
      '</div>' +
      '<div id="resultados"></div>' +
      '<div id="formDestino"></div>';

    var caja = document.getElementById('buscaDestino');
    caja.value = bus.busca;
    caja.addEventListener('input', retardo(function () {
      bus.busca = caja.value.trim(); bus.pagina = 0; cargarDestinos();
    }, 300));
    document.getElementById('btnNuevoDestino').addEventListener('click', function () {
      if (esPac) formNuevoPaciente(bus.busca); else formNuevoCentro(bus.busca);
    });
    cargarDestinos();
  }

  function cargarDestinos() {
    var z = document.getElementById('resultados');
    if (!z) return;
    var f = document.getElementById('formDestino');
    if (f) f.innerHTML = '';
    z.innerHTML = '<div class="cargando">Buscando…</div>';

    var q, esPac = modo === 'paciente';
    if (esPac) {
      q = sb.from('v_pacientes_ficha')
        .select('id,nombre,nacionalidad,cedula,cedula_cruda,sexo,edad,telefono,direccion,' +
                'estado,medicamentos,entregas,ultima_entrega', { count: 'exact' });
      if (bus.busca.length >= 2) {
        var t = bus.busca.replace(/[%,()]/g, '');
        var soloNum = t.replace(/\D/g, '');
        q = soloNum.length >= 4 && /^\D*\d[\d.\s-]*$/.test(t)
          ? q.ilike('cedula', '*' + soloNum + '*')
          : q.ilike('busqueda', '*' + sinAcentos(t) + '*');
      }
      q = q.order('nombre');
    } else {
      q = sb.from('v_instituciones_ficha')
        .select('id,nombre,tipo,direccion,responsable,telefono,entregas,ultima_entrega', { count: 'exact' })
        .eq('activo', true);
      if (bus.busca.length >= 2) {
        q = q.ilike('busqueda', '*' + sinAcentos(bus.busca).replace(/[%,()]/g, '') + '*');
      }
      q = q.order('nombre');
    }

    var desde = bus.pagina * POR_PAGINA;
    q.range(desde, desde + POR_PAGINA - 1).then(function (r) {
      var zz = document.getElementById('resultados');
      if (!zz) return;
      if (r.error) { zz.innerHTML = '<div class="aviso bad">' + esc(r.error.message) + '</div>'; return; }
      bus.filas = r.data || [];
      bus.total = r.count == null ? bus.filas.length : r.count;
      pintarLista();
    });
  }

  function pintarLista() {
    var z = document.getElementById('resultados');
    if (!z) return;
    var esPac = modo === 'paciente';

    if (!bus.filas.length) {
      z.innerHTML = '<div class="vacio"><b>' +
        (bus.busca ? 'No aparece nadie con «' + esc(bus.busca) + '».'
                   : (esPac ? 'Todavía no hay personas registradas.'
                            : 'Todavía no hay ningún centro de salud registrado.')) + '</b>' +
        '<span>' + (esPac ? 'Regístrala con el botón de arriba.'
                          : 'Regístralo con el botón de arriba.') + '</span></div>';
      return;
    }

    var desdeN = bus.pagina * POR_PAGINA + 1;
    var hastaN = Math.min(desdeN + POR_PAGINA - 1, bus.total);
    z.innerHTML =
      '<p class="conteo">' + (bus.total <= POR_PAGINA
        ? bus.total + (esPac ? (bus.total === 1 ? ' persona' : ' personas')
                             : (bus.total === 1 ? ' centro' : ' centros'))
        : 'Del ' + desdeN + ' al ' + hastaN + ' de ' + bus.total +
          (esPac ? ' personas' : ' centros')) + '</p>' +
      '<div class="fichas">' + bus.filas.map(function (x, i) {
        return esPac ? fichaPersona(x, i) : fichaCentro(x, i);
      }).join('') + '</div>' +
      paginador();

    z.querySelectorAll('.ficha').forEach(function (b) {
      b.addEventListener('click', function () { elegirDestino(bus.filas[+b.dataset.i]); });
    });
    z.querySelectorAll('[data-pag]').forEach(function (b) {
      b.addEventListener('click', function () {
        bus.pagina += b.dataset.pag === 'sig' ? 1 : -1;
        if (bus.pagina < 0) bus.pagina = 0;
        cargarDestinos();
      });
    });
  }

  function paginador() {
    var paginas = Math.ceil(bus.total / POR_PAGINA);
    if (paginas <= 1) return '';
    return '<div class="paginador">' +
      '<button type="button" data-pag="ant"' + (bus.pagina === 0 ? ' disabled' : '') + '>← Anteriores</button>' +
      '<span>Página ' + (bus.pagina + 1) + ' de ' + paginas + '</span>' +
      '<button type="button" data-pag="sig"' + (bus.pagina + 1 >= paginas ? ' disabled' : '') + '>Siguientes →</button>' +
    '</div>';
  }

  function fichaPersona(x, i) {
    /* Algunos pacientes traen en la celda de la cedula lo que se colo del
       Excel: a veces la lista de medicamentos entera. Se muestra recortado
       y completo en el title, para que no empuje la pantalla. */
    var crudo = x.cedula_cruda || '';
    var ced = x.cedula
      ? (x.nacionalidad || 'V') + '-' + x.cedula
      : (crudo ? esc(crudo.length > 22 ? crudo.slice(0, 20) + '…' : crudo) : 'sin cédula');
    var tituloCed = !x.cedula && crudo.length > 22 ? ' title="' + esc(crudo) + '"' : '';
    var linea2 = [];
    if (x.edad != null) linea2.push(x.edad + ' años');
    if (x.sexo) linea2.push(x.sexo === 'F' ? 'Femenino' : x.sexo === 'M' ? 'Masculino' : x.sexo);
    if (x.telefono) linea2.push(x.telefono);
    var linea3 = [];
    if (x.medicamentos) linea3.push(x.medicamentos + (x.medicamentos === 1 ? ' medicamento' : ' medicamentos'));
    if (x.entregas) linea3.push(x.entregas + (x.entregas === 1 ? ' entrega' : ' entregas'));
    if (x.ultima_entrega) linea3.push('última ' + fecha(x.ultima_entrega));

    return '<button type="button" class="ficha" data-i="' + i + '">' +
      '<div class="ficha-nom"><b>' + esc(x.nombre) + '</b>' +
        (linea2.length ? '<span class="ficha-pres">' + esc(linea2.join(' · ')) + '</span>' : '') +
        (linea3.length ? '<span class="ficha-pres">' + esc(linea3.join(' · ')) + '</span>' : '') +
      '</div>' +
      '<div class="ficha-datos"><span class="ficha-ced"' + tituloCed + '>' + ced + '</span></div>' +
      (x.estado === 'por_revisar' ? '<span class="sit ojo">Revisar sus datos</span>' : '') +
    '</button>';
  }

  function fichaCentro(x, i) {
    var linea2 = [x.direccion, x.responsable, x.telefono].filter(Boolean).join(' · ');
    var linea3 = x.entregas
      ? x.entregas + (x.entregas === 1 ? ' entrega' : ' entregas') +
        (x.ultima_entrega ? ' · última ' + fecha(x.ultima_entrega) : '')
      : 'Todavía no ha recibido nada';
    return '<button type="button" class="ficha" data-i="' + i + '">' +
      '<div class="ficha-nom"><b>' + esc(x.nombre) + '</b>' +
        (linea2 ? '<span class="ficha-pres">' + esc(linea2) + '</span>' : '') +
        '<span class="ficha-pres">' + esc(linea3) + '</span>' +
      '</div>' +
      '<span class="sit gris">' + esc(x.tipo || '') + '</span>' +
    '</button>';
  }

  function elegirDestino(x) {
    if (modo === 'paciente') {
      var ced = x.cedula ? (x.nacionalidad || 'V') + '-' + x.cedula
                         : (x.cedula_cruda || 'sin cédula válida');
      var det = [];
      if (x.edad != null) det.push(x.edad + ' años');
      if (x.telefono) det.push(x.telefono);
      if (x.direccion) det.push(x.direccion);
      destino = { tipo: 'paciente', id: x.id, titulo: x.nombre, sub: ced,
                  detalle: det.join(' · ') || null };
      pintarDestino(); pintarRenglones();
      sb.from('v_tratamiento_paciente')
        .select('producto_id,producto,dosificacion,texto_original,disponible,situacion')
        .eq('paciente_id', x.id)
        .then(function (r) {
          if (!destino || destino.id !== x.id) return;   // ya cambió de paciente
          destino.tratamiento = r.data || [];
          pintarDestino();
        });
    } else {
      destino = { tipo: 'institucion', id: x.id, titulo: x.nombre,
                  sub: (x.tipo || 'Centro de salud') + (x.direccion ? ' · ' + x.direccion : ''),
                  detalle: x.telefono || null, responsable: x.responsable || '' };
      pintarDestino(); pintarRenglones();
    }
  }

  /* ================================================================
     REGISTRAR UNA PERSONA NUEVA
     Todos los campos de la ficha, no solo tres. La cédula se puede
     consultar en el registro electoral para traer el nombre: se teclea
     menos y se evitan las erratas.
  ================================================================ */
  function formNuevoPaciente(texto) {
    var soloNum = String(texto || '').replace(/\D/g, '');
    var esCedula = /^\d{6,9}$/.test(soloNum);
    var z = document.getElementById('formDestino');
    document.getElementById('resultados').innerHTML = '';

    z.innerHTML =
      '<h2 class="sub-t">Registrar una persona nueva</h2>' +
      '<p class="sub">Escribe la cédula y pulsa <b>Buscar en el registro</b>: trae el nombre y la ' +
      'fecha de nacimiento. Lo demás se completa a mano.</p>' +

      '<label>Nacionalidad</label>' +
      '<div class="chips" id="nNac">' +
        '<button type="button" data-n="V" class="on">V · Venezolana</button>' +
        '<button type="button" data-n="E">E · Extranjera</button>' +
      '</div>' +

      '<label for="nCedula">Cédula</label>' +
      '<div class="fila-clave">' +
        '<input id="nCedula" type="text" inputmode="numeric" autocomplete="off" ' +
          'value="' + esc(esCedula ? soloNum : '') + '" placeholder="Solo números">' +
        '<button type="button" class="suave" id="nBuscarCne">Buscar en el registro</button>' +
      '</div>' +
      '<p class="sub chico" id="nAvisoCne"></p>' +

      '<label for="nNombre">Nombre y apellido</label>' +
      '<input id="nNombre" type="text" autocomplete="off" ' +
        'value="' + esc(esCedula ? '' : (texto || '')) + '">' +

      '<label>Sexo</label>' +
      '<div class="chips" id="nSexo">' +
        '<button type="button" data-s="F">Femenino</button>' +
        '<button type="button" data-s="M">Masculino</button>' +
        '<button type="button" data-s="" class="on">No lo dice</button>' +
      '</div>' +

      '<label for="nFecha">Fecha de nacimiento <span class="opc">(opcional)</span></label>' +
      '<input id="nFecha" type="date">' +

      '<label for="nTelefono">Teléfono <span class="opc">(opcional)</span></label>' +
      '<input id="nTelefono" type="tel" inputmode="tel" autocomplete="off" placeholder="0424-1234567">' +

      '<label for="nDireccion">Dirección <span class="opc">(opcional)</span></label>' +
      '<input id="nDireccion" type="text" autocomplete="off" placeholder="Sector, calle, casa…">' +

      '<div class="botonera">' +
        '<button type="button" class="principal" id="guardarPac">Registrar y continuar</button>' +
        '<button type="button" class="secundario" id="cancelarPac">Cancelar</button>' +
      '</div>' +
      '<div id="errPac" class="aviso bad" hidden></div>';

    chips('nNac'); chips('nSexo');
    document.getElementById('cancelarPac').addEventListener('click', function () {
      pintarDestino();
    });
    document.getElementById('nBuscarCne').addEventListener('click', consultarCne);
    document.getElementById('nCedula').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); consultarCne(); }
    });
    document.getElementById('guardarPac').addEventListener('click', guardarPaciente);
  }

  /* Marca el botón elegido dentro de un grupo de opciones. */
  function chips(id) {
    var g = document.getElementById(id);
    if (!g) return;
    g.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        g.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
  }
  function elegido(id, attr) {
    var b = document.querySelector('#' + id + ' button.on');
    return b ? b.dataset[attr] : '';
  }

  /* Consulta el registro electoral: de ahí se toman SOLO el nombre y la
     fecha de nacimiento. Dónde vota no se usa: no dice dónde vive. */
  function consultarCne() {
    var ced = document.getElementById('nCedula').value.replace(/\D/g, '');
    var av = document.getElementById('nAvisoCne');
    var btn = document.getElementById('nBuscarCne');
    if (!/^\d{6,9}$/.test(ced)) {
      av.innerHTML = '<span class="ojo">Escribe una cédula de 6 a 9 números.</span>';
      return;
    }
    av.innerHTML = 'Consultando…';
    btn.disabled = true;

    /* Primero: ¿ya está registrada aquí? Si sí, no se crea otra vez. */
    sb.from('v_pacientes_ficha')
      .select('id,nombre,nacionalidad,cedula,cedula_cruda,sexo,edad,telefono,direccion,estado,medicamentos,entregas,ultima_entrega')
      .eq('cedula', ced).eq('nacionalidad', elegido('nNac', 'n') || 'V').limit(1)
      .then(function (r) {
        var ya = r.data && r.data[0];
        if (ya) {
          btn.disabled = false;
          av.innerHTML = '<span class="ojo">Esa cédula ya está registrada: <b>' + esc(ya.nombre) +
            '</b>. </span><button type="button" class="enlace" id="usarYa">Usar esa ficha</button>';
          document.getElementById('usarYa').addEventListener('click', function () {
            elegirDestino(ya);
          });
          return;
        }
        return fetch(window.CONFIG.SUPABASE_URL + '/functions/v1/consultar-cedula', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: window.CONFIG.SUPABASE_ANON_KEY },
          body: JSON.stringify({ cedula: ced, nacionalidad: elegido('nNac', 'n') || 'V' })
        }).then(function (rr) { return rr.json(); }).then(function (d) {
          btn.disabled = false;
          var x = d && d.data;
          if (!x || d.error) {
            av.innerHTML = '<span class="ojo">No aparece en el registro. Escribe el nombre a mano.</span>';
            document.getElementById('nNombre').focus();
            return;
          }
          var nom = [x.primer_nombre, x.segundo_nombre, x.primer_apellido, x.segundo_apellido]
            .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
          if (nom) document.getElementById('nNombre').value = nom;
          if (x.fecha_nac) document.getElementById('nFecha').value = String(x.fecha_nac).slice(0, 10);
          av.innerHTML = '<span class="ok-txt">Encontrada en el registro. Revisa que esté bien y ' +
            'completa lo demás.</span>';
        });
      })
      .catch(function () {
        btn.disabled = false;
        av.innerHTML = '<span class="ojo">No se pudo consultar. Escribe el nombre a mano.</span>';
      });
  }

  function guardarPaciente() {
    var err = document.getElementById('errPac');
    var nom = document.getElementById('nNombre').value.trim().replace(/\s+/g, ' ');
    var ced = document.getElementById('nCedula').value.replace(/\D/g, '');
    var nac = elegido('nNac', 'n') || 'V';
    var sex = elegido('nSexo', 's') || null;
    var fnac = document.getElementById('nFecha').value || null;
    var tel = document.getElementById('nTelefono').value.trim() || null;
    var dir = document.getElementById('nDireccion').value.trim() || null;

    if (nom.length < 4) { err.textContent = 'Escribe el nombre y el apellido completos.'; err.hidden = false; return; }
    if (!/^\d{6,9}$/.test(ced)) { err.textContent = 'La cédula debe tener entre 6 y 9 números.'; err.hidden = false; return; }
    if (fnac && fnac > new Date().toISOString().slice(0, 10)) {
      err.textContent = 'La fecha de nacimiento no puede ser futura.'; err.hidden = false; return;
    }
    err.hidden = true;

    var btn = document.getElementById('guardarPac');
    btn.disabled = true; btn.textContent = 'Registrando…';

    sb.from('pacientes').insert({
      nombre: nom, cedula: ced, nacionalidad: nac, cedula_cruda: ced,
      sexo: sex, fecha_nac: fnac, telefono: tel, direccion: dir, estado: 'activo'
    }).select().single().then(function (r) {
      if (r.error) {
        btn.disabled = false; btn.textContent = 'Registrar y continuar';
        if (r.error.code === '23505') {
          err.innerHTML = 'Esa cédula ya está registrada. ' +
            '<button type="button" class="enlace" id="verYa">Buscarla en la lista</button>';
          err.hidden = false;
          document.getElementById('verYa').addEventListener('click', function () {
            bus.busca = ced; bus.pagina = 0; pintarDestino();
          });
          return;
        }
        err.textContent = 'No se pudo guardar. ' + r.error.message; err.hidden = false;
        return;
      }
      /* Se vuelve a leer de la ficha, para que traiga la edad calculada. */
      sb.from('v_pacientes_ficha')
        .select('id,nombre,nacionalidad,cedula,cedula_cruda,sexo,edad,telefono,direccion,estado,medicamentos,entregas,ultima_entrega')
        .eq('id', r.data.id).single()
        .then(function (f) { elegirDestino(f.data || r.data); });
    });
  }

  /* ================================================================
     REGISTRAR UN CENTRO DE SALUD NUEVO
  ================================================================ */
  function formNuevoCentro(texto) {
    var z = document.getElementById('formDestino');
    document.getElementById('resultados').innerHTML = '';

    z.innerHTML =
      '<h2 class="sub-t">Registrar un centro de salud</h2>' +
      '<p class="sub">Los centros a los que se despacha: CDI, ambulatorios, consultorios ' +
      'populares. Se registran una vez y quedan para las siguientes entregas.</p>' +

      '<label for="cNombre">Nombre del centro</label>' +
      '<input id="cNombre" type="text" autocomplete="off" value="' + esc(texto || '') + '" ' +
        'placeholder="CDI Mamá Pancha">' +

      '<label for="cTipo">Qué tipo de centro es</label>' +
      '<select id="cTipo">' + TIPOS_CENTRO.map(function (t) {
        return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
      }).join('') + '</select>' +

      '<label for="cDireccion">Dirección</label>' +
      '<input id="cDireccion" type="text" autocomplete="off" placeholder="Sector, avenida, punto de referencia">' +

      '<label for="cResponsable">Responsable <span class="opc">(quien suele recibir)</span></label>' +
      '<input id="cResponsable" type="text" autocomplete="off" placeholder="Nombre y apellido">' +

      '<label for="cTelefono">Teléfono <span class="opc">(opcional)</span></label>' +
      '<input id="cTelefono" type="tel" inputmode="tel" autocomplete="off" placeholder="0239-1234567">' +

      '<div class="botonera">' +
        '<button type="button" class="principal" id="guardarCen">Registrar y continuar</button>' +
        '<button type="button" class="secundario" id="cancelarCen">Cancelar</button>' +
      '</div>' +
      '<div id="errCen" class="aviso bad" hidden></div>';

    document.getElementById('cancelarCen').addEventListener('click', function () { pintarDestino(); });
    document.getElementById('guardarCen').addEventListener('click', function () {
      var err = document.getElementById('errCen');
      var nom = document.getElementById('cNombre').value.trim().replace(/\s+/g, ' ');
      if (nom.length < 4) { err.textContent = 'Escribe el nombre completo del centro.'; err.hidden = false; return; }
      err.hidden = true;
      var btn = this; btn.disabled = true; btn.textContent = 'Registrando…';

      /* Si ya existe uno con ese nombre, se usa ese en vez de repetirlo. */
      sb.from('v_instituciones_ficha')
        .select('id,nombre,tipo,direccion,responsable,telefono,entregas,ultima_entrega')
        .ilike('nombre', nom).limit(1)
        .then(function (r) {
          var ya = r.data && r.data[0];
          if (ya) {
            btn.disabled = false; btn.textContent = 'Registrar y continuar';
            err.innerHTML = 'Ese centro ya está registrado. ' +
              '<button type="button" class="enlace" id="usarCen">Usarlo</button>';
            err.hidden = false;
            document.getElementById('usarCen').addEventListener('click', function () { elegirDestino(ya); });
            return;
          }
          return sb.from('instituciones').insert({
            nombre: nom,
            tipo: document.getElementById('cTipo').value,
            direccion: document.getElementById('cDireccion').value.trim() || null,
            responsable: document.getElementById('cResponsable').value.trim() || null,
            telefono: document.getElementById('cTelefono').value.trim() || null,
            activo: true
          }).select().single().then(function (rr) {
            if (rr.error) {
              btn.disabled = false; btn.textContent = 'Registrar y continuar';
              err.textContent = 'No se pudo guardar. ' + rr.error.message; err.hidden = false;
              return;
            }
            elegirDestino(Object.assign({ entregas: 0 }, rr.data));
          });
        });
    });
  }

  /* El tratamiento del paciente: cada medicamento con su existencia y un
     botón para agregarlo de una vez. Los que no tienen se ven apagados y
     dicen por qué, en vez de dejar buscar en vano. */
  function pintarTratamiento() {
    if (destino.tipo !== 'paciente') return '';
    var t = destino.tratamiento;
    if (t === undefined) return '<div class="trat"><span class="lbl">Su tratamiento</span>' +
      '<span class="sub chico">Buscando…</span></div>';
    if (!t || !t.length) return '';

    /* Los renglones que no se pudieron enlazar con un medicamento del
       catálogo se muestran como vinieron del Excel: son un dato real. */
    var conProd = t.filter(function (x) { return x.producto_id; });
    var sueltos = t.filter(function (x) { return !x.producto_id && x.texto_original; });

    return '<div class="trat">' +
      '<span class="lbl">Su tratamiento · ' + t.length +
        (t.length === 1 ? ' medicamento' : ' medicamentos') + '</span>' +
      (conProd.length
        ? '<div class="trat-lista">' + conProd.map(function (x, i) {
            var hay = Number(x.disponible) || 0;
            return '<button type="button" class="trat-med' + (hay > 0 ? '' : ' sin') + '" ' +
              'data-trat="' + i + '"' + (hay > 0 ? '' : ' disabled') + '>' +
              '<span class="tm-nom">' + esc(x.producto) +
                (x.dosificacion ? ' <em>' + esc(x.dosificacion) + '</em>' : '') + '</span>' +
              '<span class="tm-hay">' + (hay > 0
                ? hay + ' disponibles'
                : (x.situacion === 'solo_vencido' ? 'solo vencido' : 'sin existencia')) + '</span>' +
            '</button>';
          }).join('') + '</div>'
        : '') +
      (sueltos.length
        ? '<span class="sub chico">Además, del Excel: ' +
          esc(sueltos.map(function (x) { return x.texto_original; }).join(' · ')) + '</span>'
        : '') +
    '</div>';
  }

  /* Al tocar un medicamento del tratamiento se busca su lote: el que vence
     primero, que es el que hay que sacar. */
  function agregarDelTratamiento(x) {
    var av = document.getElementById('zonaAviso');
    sb.from('v_lotes_para_despachar')
      .select('lote_id,producto_id,producto,lote,vence,existencia,situacion')
      .eq('producto_id', x.producto_id).limit(1)
      .then(function (r) {
        var l = r.data && r.data[0];
        if (!l) {
          if (av) av.innerHTML = '<div class="aviso warn">De ' + esc(x.producto) +
            ' no queda nada que se pueda entregar.</div>';
          return;
        }
        agregar(l);
      });
  }

  /* ---------------------------------------------------------------- renglones */
  function pintarCesta() {
    var z = document.getElementById('zonaCesta');
    z.innerHTML =
      '<h2>Qué se entrega</h2>' +
      /* Lo que llevas va PRIMERO, con el botón pegado: antes estaba
         debajo de la lista de treinta lotes y había que bajar hasta
         el fondo para ver lo que habías agregado. */
      '<div id="renglones"></div>' +
      '<h2 class="sub-t">Agregar un medicamento</h2>' +
      '<input id="buscaMed" type="search" autocomplete="off" ' +
        'aria-label="Buscar el medicamento" placeholder="Escribe para acotar la lista…">' +
      '<div id="resMed"></div>';

    var caja = document.getElementById('buscaMed');
    caja.addEventListener('input', retardo(function () { buscarMed(caja.value.trim()); }, 280));
    pintarRenglones();
    /* Se muestra de entrada lo que hay, sin obligar a escribir: así se ve
       qué se puede entregar hoy en vez de adivinar nombres. */
    buscarMed('');
  }

  var SIT_TXT = {
    por_vencer_30: { t: 'Vence en 30 días', c: 'ojo' },
    por_vencer_90: { t: 'Vence en 90 días', c: 'ojo' },
    sin_fecha:     { t: 'Sin vencimiento',  c: 'gris' },
    vigente:       { t: 'Vigente',          c: 'ok' }
  };

  function buscarMed(q) {
    var lista = document.getElementById('resMed');
    if (!lista) return;
    lista.innerHTML = '<div class="cargando">Buscando…</div>';

    /* La vista ya viene ordenada por el que vence primero (FEFO) y sin
       vencidos: lo primero de la lista es lo que hay que sacar. */
    var p = sb.from('v_lotes_para_despachar')
      .select('lote_id,producto_id,producto,dosificacion,lote,vence,existencia,situacion',
              { count: 'exact' });
    if (q.length >= 2) p = p.ilike('producto', '*' + q.replace(/[%,()]/g, '') + '*');

    p.limit(30).then(function (r) {
      var zz = document.getElementById('resMed');
      if (!zz) return;
      if (r.error) { zz.innerHTML = '<div class="cargando">' + esc(r.error.message) + '</div>'; return; }
      var f = r.data || [];
      if (!f.length) {
        zz.innerHTML = '<div class="vacio"><b>' +
          (q ? 'No hay existencia de «' + esc(q) + '».' : 'No hay nada disponible para entregar.') +
          '</b><span>Puede estar agotado o vencido. Míralo en Mercancía.</span></div>';
        return;
      }
      var total = r.count == null ? f.length : r.count;
      zz.innerHTML =
        '<p class="conteo">' + (total > f.length
          ? 'Los ' + f.length + ' primeros de ' + total + ' lotes disponibles. Escribe para acotar.'
          : total + (total === 1 ? ' lote disponible' : ' lotes disponibles')) + '</p>' +
        '<div class="fichas">' + f.map(function (x, i) {
          var m = SIT_TXT[x.situacion] || { t: '', c: 'gris' };
          var yaEsta = cesta.some(function (c) { return c.lote_id === x.lote_id; });
          return '<button type="button" class="ficha" data-i="' + i + '"' +
            (yaEsta ? ' disabled' : '') + '>' +
            '<div class="ficha-nom"><b>' + esc(x.producto) + '</b>' +
              '<span class="ficha-pres">lote ' + esc(x.lote || 'sin número') +
              ' · vence ' + fecha(x.vence) + '</span></div>' +
            '<div class="ficha-datos">' +
              '<span class="ficha-cant">' + Math.round(x.existencia) + '<em>quedan</em></span>' +
            '</div>' +
            (yaEsta ? '<span class="sit ok">Ya está</span>'
                    : '<span class="sit ' + m.c + '">' + m.t + '</span>') +
          '</button>';
        }).join('') + '</div>';

      zz.querySelectorAll('.ficha').forEach(function (b) {
        b.addEventListener('click', function () { agregar(f[+b.dataset.i]); });
      });
    });
  }

  function agregar(l) {
    if (cesta.some(function (c) { return c.lote_id === l.lote_id; })) return;
    cesta.push({ lote_id: l.lote_id, producto: l.producto, lote: l.lote,
                 vence: l.vence, disponible: l.existencia, cantidad: 1 });
    pintarRenglones(); refrescarBoton();
    var caja = document.getElementById('buscaMed');
    buscarMed(caja ? caja.value.trim() : '');
    /* Se lleva la vista a lo que acaba de agregarse: si no, en el teléfono
       queda abajo en la lista y no se ve que pasó nada. */
    var cst = document.getElementById('renglones');
    if (cst && cst.scrollIntoView) cst.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function pintarRenglones() {
    var z = document.getElementById('renglones');
    if (!z) return;

    if (!cesta.length) {
      z.innerHTML =
        '<div class="vacio"><b>Todavía no has agregado nada.</b>' +
        '<span>' + (destino && destino.tipo === 'paciente'
          ? 'Toca un medicamento de su tratamiento, arriba, o búscalo en la lista de abajo.'
          : 'Búscalo en la lista de abajo.') + '</span></div>';
      return;
    }

    var unidades = cesta.reduce(function (s, c) { return s + Number(c.cantidad || 0); }, 0);

    z.innerHTML =
      '<p class="conteo">' + cesta.length +
        (cesta.length === 1 ? ' medicamento' : ' medicamentos') + ' · ' +
        unidades + (unidades === 1 ? ' unidad' : ' unidades') + '</p>' +
      '<div class="cesta">' + cesta.map(function (c, i) {
        var max = Math.round(c.disponible);
        return '<div class="cesta-item">' +
          '<div class="ci-nom"><b>' + esc(c.producto) + '</b>' +
            '<span>lote ' + esc(c.lote || 'sin número') + ' · vence ' + fecha(c.vence) + '</span>' +
          '</div>' +
          '<div class="ci-cant">' +
            '<button type="button" class="paso" data-menos="' + i + '" aria-label="Una menos"' +
              (c.cantidad <= 1 ? ' disabled' : '') + '>−</button>' +
            '<input class="cant" type="number" min="1" max="' + max + '" value="' + c.cantidad + '" ' +
              'data-i="' + i + '" inputmode="numeric" aria-label="Cuántas unidades de ' +
              esc(c.producto) + '">' +
            '<button type="button" class="paso" data-mas="' + i + '" aria-label="Una más"' +
              (c.cantidad >= max ? ' disabled' : '') + '>+</button>' +
            '<span class="ci-tope">de ' + max + '</span>' +
          '</div>' +
          '<button type="button" class="ci-quitar" data-q="' + i + '" ' +
            'aria-label="Quitar ' + esc(c.producto) + ' de la entrega">✕</button>' +
        '</div>';
      }).join('') + '</div>' +
      '<div class="botonera">' +
        '<button type="button" class="principal" id="btnRegistrar"' +
        (destino ? '' : ' disabled') + '>Registrar la entrega' +
        (destino ? ' · ' + unidades + (unidades === 1 ? ' unidad' : ' unidades') : '') +
        '</button>' +
      '</div>' +
      (destino ? '' : '<p class="sub chico">Falta elegir a quién se le entrega, arriba.</p>');

    document.getElementById('btnRegistrar').addEventListener('click', registrar);

    function pon(i, valor) {
      var max = Math.round(cesta[i].disponible);
      cesta[i].cantidad = Math.max(1, Math.min(valor, max));
      pintarRenglones();
      /* La lista de abajo marca lo que ya está en la entrega. */
      var caja = document.getElementById('buscaMed');
      if (caja) buscarMed(caja.value.trim());
    }

    z.querySelectorAll('[data-menos]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.dataset.menos; pon(i, cesta[i].cantidad - 1);
      });
    });
    z.querySelectorAll('[data-mas]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.dataset.mas; pon(i, cesta[i].cantidad + 1);
      });
    });
    z.querySelectorAll('.cant').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = +inp.dataset.i, v = parseInt(inp.value, 10);
        cesta[i].cantidad = isNaN(v) || v < 1 ? 1 : Math.min(v, Math.round(cesta[i].disponible));
        refrescarBoton();
      });
      inp.addEventListener('blur', function () { pintarRenglones(); });
      inp.addEventListener('focus', function () { inp.select(); });
    });
    z.querySelectorAll('.ci-quitar').forEach(function (b) {
      b.addEventListener('click', function () {
        cesta.splice(+b.dataset.q, 1);
        pintarRenglones();
        var caja = document.getElementById('buscaMed');
        if (caja) buscarMed(caja.value.trim());
      });
    });
  }

  /* Se llama desde fuera cuando cambia el destino: el botón depende de que
     haya alguien a quien entregarle. */
  function refrescarBoton() {
    var b = document.getElementById('btnRegistrar');
    if (b) b.disabled = !(cesta.length && destino);
  }

  /* ---------------------------------------------------------------- registrar */
  function registrar() {
    var btn = document.getElementById('btnRegistrar');
    var av = document.getElementById('zonaAviso');
    av.innerHTML = '';

    if (!destino) { aviso('warn', 'Falta elegir a quién se le entrega.'); return; }
    if (!cesta.length) { aviso('warn', 'No has agregado ningún medicamento.'); return; }

    var cab = { tipo_destinatario: destino.tipo, origen: 'sistema',
                clave_idempotencia: 'e-' + destino.id + '-' + Date.now() };
    if (destino.tipo === 'paciente') {
      cab.paciente_id = destino.id;
    } else {
      cab.institucion_id = destino.id;
      var rn = document.getElementById('recibeNombre');
      var rc = document.getElementById('recibeCedula');
      cab.recibe_nombre = rn ? rn.value.trim() : '';
      cab.recibe_cedula = rc ? rc.value.replace(/\D/g, '') || null : null;
      if (cab.recibe_nombre.length < 3) {
        aviso('warn', 'Para entregar a un centro hay que anotar quién recibe.');
        if (rn) rn.focus();
        return;
      }
    }

    btn.disabled = true; btn.textContent = 'Registrando…';

    sb.from('entregas').insert(cab).select().single().then(function (r) {
      if (r.error) throw r.error;
      var idEnt = r.data.id;
      return sb.from('entrega_detalle').insert(cesta.map(function (c) {
        return { entrega_id: idEnt, lote_id: c.lote_id, cantidad: c.cantidad };
      })).select().then(function (d) {
        if (d.error) throw d.error;
        return { id: idEnt, n: (d.data || []).length };
      });
    }).then(function (res) {
      /* Se guarda copia de lo entregado ANTES de vaciar la cesta, para
         poder imprimir el acta o el comprobante después. */
      var papel = {
        fecha: new Date().toISOString().slice(0, 10),
        tipo: destino.tipo,
        centro: destino.titulo,
        centroTipo: (destino.sub || '').split(' · ')[0],
        paciente: destino.titulo,
        cedula: destino.sub,
        recibeNombre: cab.recibe_nombre || '',
        recibeCedula: cab.recibe_cedula || '',
        entregaNombre: (yo && yo.nombre) || '',
        entregaCedula: '',
        renglones: cesta.map(function (c) {
          return { producto: c.producto, lote: c.lote, vence: c.vence, cantidad: c.cantidad };
        })
      };

      aviso('ok', 'Entrega registrada para ' + destino.titulo + ': ' +
                  res.n + (res.n === 1 ? ' medicamento' : ' medicamentos') +
                  '. Ya quedó descontado del inventario.');
      destino = null; cesta = [];
      pintarDestino(); pintarCesta();
      ofrecerPapel(papel);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }).catch(function (err) {
      // Nunca decimos "guardado" si el servidor no confirmó.
      aviso('bad', traducir(err));
      btn.disabled = false; btn.textContent = 'Registrar la entrega';
    });
  }

  function traducir(err) {
    var m = (err && err.message ? err.message : String(err));
    if (/venci/i.test(m)) return 'Ese lote está vencido: el sistema no permite entregarlo. ' + m;
    if (/No hay suficiente/i.test(m)) return m;
    if (/dado de baja/i.test(m)) return m;
    if (/duplicate key|23505/i.test(m)) return 'Esa entrega ya se había registrado. Revisa antes de repetirla.';
    if (/Failed to fetch|NetworkError/i.test(m))
      return 'Se cayó la conexión y NO se registró la entrega. Vuelve a intentar cuando tengas internet.';
    return 'No se pudo registrar: ' + m;
  }

  /* Al terminar una entrega se ofrece el documento: el acta que firma el
     centro de salud, o el comprobante de la persona. Se ofrece, no se
     descarga solo: no siempre hace falta imprimirlo. */
  function ofrecerPapel(papel) {
    var z = document.getElementById('zonaAviso');
    if (!z || !window.FARMREP) return;
    var esCentro = papel.tipo === 'institucion';
    var caja = document.createElement('div');
    caja.className = 'descargas';
    caja.innerHTML = '<button type="button" id="btnPapel">' +
      (esCentro ? 'Descargar el acta de entrega-recepción' : 'Descargar el comprobante') +
      '</button>';
    z.appendChild(caja);
    document.getElementById('btnPapel').addEventListener('click', function () {
      if (esCentro) window.FARMREP.acta(papel);
      else window.FARMREP.comprobante(papel);
    });
  }

  function aviso(clase, texto) {
    document.getElementById('zonaAviso').innerHTML =
      '<div class="aviso ' + clase + '">' + esc(texto) + '</div>';
  }

  /* ---------------------------------------------------------------- entrada */
  window.PANTALLA_DESPACHO = function (cliente, contenedor, usuario) {
    sb = cliente; ancla = contenedor; yo = usuario || null;
    cesta = []; destino = null; modo = 'paciente';
    bus = { busca: '', pagina: 0, total: 0, filas: [], cargando: false };
    pintar();
  };
})();
