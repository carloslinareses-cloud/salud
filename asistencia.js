/* CONTROL DE ASISTENCIA · Dirección de Salud
   ==========================================
   Sistema aparte del panel de la farmacia: el administrador lo elige
   arriba, no es una pestaña más del panel.

   QUIÉN MARCA. El personal de la Dirección de Salud, desde la app del
   teléfono. Entra SOLO con su cédula y una clave que se le pone desde
   esta pantalla. NO usa la cuenta de Despacho ni la de Inventario, ni
   ninguna cuenta de correo: por dentro todo pasa por las funciones
   asis_* de la base (ver sql/25-asistencia.sql).

   QUIÉN ADMINISTRA. El administrador de la farmacia, con su cuenta de
   siempre. Es el único que ve esta pantalla y el único que puede
   corregir una hora ya marcada (y la corrección queda anotada).

   EL GPS ES OBLIGATORIO. La base rechaza el marcaje de quien no está
   en la sede: eso no se decide aquí, se decide en
   farmacia.asis_verificar_sitio, así que da igual que alguien toque la
   app. Desde aquí se administra ese candado (sede, radio, tolerancia)
   y se audita a cuántos metros marcó cada quien.

   Los identificadores de esta pantalla llevan nombre propio (zonaAsis,
   avisoAsis, asXxx): el panel de administración sigue vivo en la misma
   página y dos elementos con el mismo id se pisan.
--------------------------------------------------------------------- */
(function () {
  'use strict';

  var sb = null, ancla = null, yo = null, sub = 'hoy';

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function aviso(clase, texto) {
    var z = document.getElementById('avisoAsis');
    if (z) z.innerHTML = '<div class="aviso ' + clase + '">' + esc(texto) + '</div>';
  }

  /* Los errores que devuelve la base vienen en inglés y con palabras que
     no le dicen nada a nadie. Aquí se traducen los que pueden salir de
     verdad; el resto se muestra tal cual, que es mejor que esconderlo. */
  function enCristiano(error) {
    var m = (error && (error.message || error.hint || error.details)) || 'Error desconocido';
    if (/schema cache|does not exist|relation .* does not exist|Could not find the (table|function)/i.test(m)) {
      return 'El control de asistencia todavía no está instalado en la base de datos. ' +
             'Hay que aplicar sql/25-asistencia.sql antes de poder usar esta pantalla.';
    }
    if (/permission denied|row-level security|not authorized/i.test(m)) {
      return 'Tu cuenta no tiene permiso para esto. Solo el administrador puede administrar la asistencia.';
    }
    if (/duplicate key|already exists|unique constraint/i.test(m)) {
      return 'Esa cédula ya está cargada.';
    }
    if (/asis_personal_cedula_formato/i.test(m)) {
      return 'La cédula tiene que ser solo números, entre 6 y 9 dígitos.';
    }
    if (/Failed to fetch|NetworkError|network/i.test(m)) {
      return 'No se pudo hablar con el servidor. Revisa la conexión e intenta otra vez.';
    }
    return m;
  }

  /* Clave inicial sugerida. Se genera al azar en el momento y NO se
     escribe ninguna fija en el código: este repositorio es público, y
     una clave escrita aquí la sabría cualquiera que mire el archivo.
     Se le dicta a la persona y ella la cambia al entrar. */
  function claveSugerida() {
    var n = new Uint32Array(1);
    (window.crypto || window.msCrypto).getRandomValues(n);
    return 'Salud' + (n[0] % 9000 + 1000);
  }

  /* El día que cuenta es el de Venezuela, que es el que guarda la base. */
  function hoyVzla() {
    return (window.FARM && window.FARM.hoyCaracas)
      ? window.FARM.hoyCaracas()
      : new Date().toISOString().slice(0, 10);
  }
  function fechaCorta(f) { return window.FARMREP ? window.FARMREP.fechaCorta(f) : String(f || ''); }
  function fechaLarga(f) { return window.FARMREP ? window.FARMREP.fechaLarga(f) : String(f || ''); }

  function cif(n, txt, clase) {
    return '<div class="cifra ' + clase + '"><b>' + n + '</b><span>' + txt + '</span></div>';
  }

  /* La hora SIEMPRE en la de Venezuela, no en la del aparato: si el
     administrador abre esto desde una computadora con otra zona horaria,
     "marcó a las 7:58" se convertiría en otra hora distinta y el reporte
     mentiría. FARM.horaCaracas es la misma que usa el resto del sistema. */
  function horaCorta(iso) {
    if (!iso) return null;
    if (window.FARM && window.FARM.horaCaracas) return window.FARM.horaCaracas(iso);
    return new Date(iso).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  }

  function metros(v) {
    if (v == null || v === '' || isNaN(Number(v))) return null;
    return Math.round(Number(v));
  }

  function pillDentro(v) {
    if (v === true)  return '<span class="pill" style="background:var(--ok-bg);color:var(--ok-ink)">dentro del sitio</span>';
    if (v === false) return '<span class="pill" style="background:var(--bad-bg);color:var(--bad-ink)">fuera del sitio</span>';
    return '<span class="pill" style="background:var(--rail);color:var(--ink-soft)">sin GPS</span>';
  }

  /* Dentro/fuera Y a cuántos metros. Los metros son lo que de verdad se
     audita: "marcó a 8 m, con el GPS acertando a ±12" se lee muy distinto
     de "marcó a 400 m". */
  function marca(hora, dentro, distancia, precision) {
    if (!hora) return '<em class="ojo">sin marcar</em>';
    var d = metros(distancia), p = metros(precision);
    var detalle = '';
    if (d != null) {
      detalle = ' <span class="cuando">a ' + d + ' m del sitio' +
                (p != null ? ' · el GPS acertaba a ±' + p + ' m' : '') + '</span>';
    }
    return horaCorta(hora) + ' ' + pillDentro(dentro) + detalle;
  }

  /* Se trae TODO lo que cumple el filtro, no solo lo que se ve: el
     servidor no manda más de mil filas por vez, así que se pide por
     tandas. */
  function porTandas(hazConsulta, tope) {
    var todo = [];
    function tanda(desde) {
      return hazConsulta(desde).then(function (r) {
        if (r.error) throw r.error;
        var f = r.data || [];
        todo = todo.concat(f);
        if (f.length === 1000 && todo.length < (tope || 20000)) return tanda(desde + 1000);
      });
    }
    return tanda(0).then(function () { return todo; });
  }

  /* ------------------------------------------------------------ armazón */
  function pintar() {
    ancla.innerHTML =
      '<div class="tarjeta">' +
        '<div class="aviso ok" style="margin-bottom:14px">📲 <b>App para marcar entrada y salida:</b> ' +
          'compártele al personal ' +
          '<a href="app-asistencia.html" target="_blank" rel="noopener" style="color:inherit;font-weight:800">' +
          'salud.alcaldiadecharallave.com/app-asistencia.html</a> — ' +
          '<b>entran solo con su cédula y la clave que les pongas aquí.</b> ' +
          'No es la cuenta de Despacho ni la de Inventario: eso es de la farmacia, esto es aparte.</div>' +
        '<div class="conmuta">' +
          '<button type="button" data-sa="hoy">Hoy</button>' +
          '<button type="button" data-sa="historial">Historial</button>' +
          '<button type="button" data-sa="personal">Personal</button>' +
          '<button type="button" data-sa="sedes">Sedes (GPS)</button>' +
          '<button type="button" data-sa="horario">Horario</button>' +
        '</div>' +
        '<div id="zonaAsis"><div class="cargando">Cargando…</div></div>' +
        '<div id="avisoAsis"></div>' +
      '</div>';

    ancla.querySelectorAll('[data-sa]').forEach(function (b) {
      b.addEventListener('click', function () { sub = b.dataset.sa; pintar(); });
      b.classList.toggle('on', b.dataset.sa === sub);
    });

    ({ hoy: verHoy, historial: verHistorial, personal: verPersonal,
       sedes: verSedes, horario: verHorario })[sub]();
  }

  /* ---------------------------------------------------------------- hoy */
  function verHoy() {
    var z = document.getElementById('zonaAsis');
    z.innerHTML = '<div class="cargando">Cargando…</div>';
    var hoy = hoyVzla();

    Promise.all([
      sb.from('asistencia_personal').select('cedula,nombre,telefono').eq('activo', true).order('nombre'),
      sb.from('v_asistencia')
        .select('id,cedula,hora_entrada,dentro_sede_entrada,sede_entrada_nombre,' +
                'distancia_entrada_m,precision_entrada_m,' +
                'hora_salida,dentro_sede_salida,sede_salida_nombre,' +
                'distancia_salida_m,precision_salida_m,nota_correccion')
        .eq('fecha', hoy)
    ]).then(function (r) {
      if (r[0].error) { z.innerHTML = '<div class="aviso bad">' + esc(enCristiano(r[0].error)) + '</div>'; return; }
      if (r[1].error) { z.innerHTML = '<div class="aviso bad">' + esc(enCristiano(r[1].error)) + '</div>'; return; }
      var personal = r[0].data || [];
      var porPersona = {};
      (r[1].data || []).forEach(function (m) { porPersona[m.cedula] = m; });

      var entraron = 0, salieron = 0;
      personal.forEach(function (p) {
        var m = porPersona[p.cedula];
        if (m && m.hora_entrada) entraron++;
        if (m && m.hora_salida) salieron++;
      });

      z.innerHTML =
        '<div class="cifras">' +
          cif(entraron, 'marcaron entrada', '') +
          cif(personal.length - entraron, 'sin marcar entrada', (personal.length - entraron) ? 'alerta' : '') +
          cif(salieron, 'marcaron salida', '') +
        '</div>' +
        '<h2 class="sub-t">Asistencia de hoy — ' + esc(fechaLarga(hoy)) + '</h2>' +
        '<p class="sub">Al lado de cada hora va a cuántos metros de la sede estaba el teléfono ' +
        'cuando marcó, y cuánto margen de error declaraba el propio GPS.</p>' +
        '<div class="renglones">' + personal.map(function (p) {
          return filaPersona(p, porPersona[p.cedula]);
        }).join('') + '</div>';

      engancharCorregir(z, verHoy);
    }).catch(function (e) {
      z.innerHTML = '<div class="aviso bad">' + esc(e.message || e) + '</div>';
    });
  }

  function filaPersona(p, m) {
    m = m || {};
    var entrada = marca(m.hora_entrada, m.dentro_sede_entrada, m.distancia_entrada_m, m.precision_entrada_m) +
      (m.hora_entrada && m.sede_entrada_nombre ? ' <span class="cuando">' + esc(m.sede_entrada_nombre) + '</span>' : '');
    var salida = m.hora_salida
      ? marca(m.hora_salida, m.dentro_sede_salida, m.distancia_salida_m, m.precision_salida_m) +
        (m.sede_salida_nombre ? ' <span class="cuando">' + esc(m.sede_salida_nombre) + '</span>' : '')
      : (m.hora_entrada ? '<em class="ojo">sin marcar</em>' : '<span class="cuando">—</span>');

    return '<div class="renglon">' +
      '<div class="que"><b>' + esc(p.nombre) + '</b>' +
      '<span>C.I. ' + esc(p.cedula) + (p.telefono ? ' · ' + esc(p.telefono) : '') + '</span>' +
      '<span class="meds">Entrada: ' + entrada + '<br>Salida: ' + salida +
      (m.nota_correccion ? '<br><em class="ojo">Corregido: ' + esc(m.nota_correccion) + '</em>' : '') +
      '</span></div>' +
      (m.id ? '<button type="button" class="suave" data-corregir="' + esc(m.id) + '" ' +
              'data-nombre="' + esc(p.nombre) + '">Corregir</button>' : '') +
      '</div>';
  }

  /* El admin corrige una hora ya marcada (la app y la persona no pueden:
     lo bloquea un candado en la base). Queda anotado el motivo. */
  function engancharCorregir(z, recargar) {
    z.querySelectorAll('[data-corregir]').forEach(function (b) {
      b.addEventListener('click', function () {
        var cual = window.prompt(
          '¿Qué corriges de ' + b.dataset.nombre + '?\nEscribe "entrada" o "salida".', 'entrada');
        if (!cual || (cual !== 'entrada' && cual !== 'salida')) return;
        var horaTxt = window.prompt('Hora correcta (formato 24h, HH:MM):', '08:00');
        if (!horaTxt || !/^([01]\d|2[0-3]):[0-5]\d$/.test(horaTxt.trim())) {
          aviso('warn', 'La hora debe tener el formato HH:MM, por ejemplo 08:00.');
          return;
        }
        var motivo = window.prompt('¿Por qué se corrige? (queda anotado)', '');
        if (!motivo || !motivo.trim()) { aviso('warn', 'Hace falta el motivo de la corrección.'); return; }

        /* La hora que se escribe es hora de Venezuela, y así se guarda:
           se le pone el huso a mano (-04:00, que aquí no cambia en todo
           el año). Sin eso, la hora se interpretaría en la zona horaria
           de la computadora del administrador y la corrección quedaría
           movida varias horas. */
        var iso = hoyVzla() + 'T' + horaTxt.trim() + ':00-04:00';
        var campo = cual === 'entrada' ? 'hora_entrada' : 'hora_salida';
        var cambio = {}; cambio[campo] = new Date(iso).toISOString();
        cambio.nota_correccion = motivo.trim();
        cambio.corregido_por = yo.id;
        cambio.corregido_en = new Date().toISOString();

        b.disabled = true;
        sb.from('asistencia_registros').update(cambio).eq('id', b.dataset.corregir).select()
          .then(function (r) {
            b.disabled = false;
            if (r.error) { aviso('bad', enCristiano(r.error)); return; }
            aviso('ok', 'Corregido. Queda registrado en la bitácora.');
            recargar();
          });
      });
    });
  }

  /* ---------------------------------------------------------- historial */
  function verHistorial() {
    var z = document.getElementById('zonaAsis');
    var hoy = hoyVzla();
    var hace30 = new Date(hoy + 'T12:00:00'); hace30.setDate(hace30.getDate() - 30);
    var desdeIni = hace30.toISOString().slice(0, 10);

    z.innerHTML =
      '<h2 class="sub-t">Historial de asistencia</h2>' +
      '<p class="sub">Cada marca trae los metros a los que estaba de la sede. ' +
      'El Excel sale con todo: horas, metros, margen de error del GPS y correcciones.</p>' +
      '<div class="filtros">' +
        '<input id="asDesde" type="date" aria-label="Desde" value="' + desdeIni + '">' +
        '<input id="asHasta" type="date" aria-label="Hasta" value="' + hoy + '">' +
        '<input id="asQuien" type="search" aria-label="Filtrar por persona" placeholder="Nombre de la persona…">' +
      '</div>' +
      '<div class="descargas"><button type="button" id="asExcel">Descargar en Excel</button></div>' +
      '<div id="asResultado"><div class="cargando">Cargando…</div></div>';

    document.getElementById('asDesde').addEventListener('change', cargarHistorial);
    document.getElementById('asHasta').addEventListener('change', cargarHistorial);
    document.getElementById('asQuien').addEventListener('input', function () {
      clearTimeout(window._tasis); window._tasis = setTimeout(cargarHistorial, 300);
    });
    document.getElementById('asExcel').addEventListener('click', function () { bajarExcel(this); });
    cargarHistorial();
  }

  function filtros() {
    return {
      desde: document.getElementById('asDesde').value,
      hasta: document.getElementById('asHasta').value,
      quien: document.getElementById('asQuien').value.trim()
    };
  }

  function cargarHistorial() {
    var z = document.getElementById('asResultado');
    var f = filtros();
    var q = sb.from('v_asistencia')
      .select('id,fecha,cedula,empleado_nombre,hora_entrada,dentro_sede_entrada,' +
              'distancia_entrada_m,precision_entrada_m,' +
              'hora_salida,dentro_sede_salida,distancia_salida_m,precision_salida_m,nota_correccion')
      .order('fecha', { ascending: false }).limit(300);
    if (f.desde) q = q.gte('fecha', f.desde);
    if (f.hasta) q = q.lte('fecha', f.hasta);
    if (f.quien) q = q.ilike('empleado_nombre', '*' + f.quien.replace(/[%,()]/g, '') + '*');

    q.then(function (r) {
      if (r.error) { z.innerHTML = '<div class=\"aviso bad\">' + esc(enCristiano(r.error)) + '</div>'; return; }
      var filas = r.data || [];
      if (!filas.length) { z.innerHTML = '<p class="sub">No hay marcajes con ese filtro.</p>'; return; }
      z.innerHTML = '<div class="renglones">' + filas.map(function (x) {
        return '<div class="renglon"><div class="que">' +
          '<b>' + esc(x.empleado_nombre) + '</b>' +
          '<span>C.I. ' + esc(x.cedula) + ' · ' + esc(fechaCorta(x.fecha)) + '</span>' +
          '<span class="meds">Entrada: ' +
            marca(x.hora_entrada, x.dentro_sede_entrada, x.distancia_entrada_m, x.precision_entrada_m) +
          '<br>Salida: ' +
            marca(x.hora_salida, x.dentro_sede_salida, x.distancia_salida_m, x.precision_salida_m) +
          (x.nota_correccion ? '<br><em class="ojo">Corregido: ' + esc(x.nota_correccion) + '</em>' : '') +
          '</span></div></div>';
      }).join('') + '</div>' +
      (filas.length >= 300
        ? '<p class="sub">Se muestran las 300 más recientes. Acota el rango de fechas para ver más detalle.</p>'
        : '');
    });
  }

  function bajarExcel(btn) {
    var texto = btn.textContent;
    btn.disabled = true; btn.textContent = 'Preparando…';
    var f = filtros();

    porTandas(function (desde) {
      var q = sb.from('v_asistencia')
        .select('fecha,cedula,empleado_nombre,hora_entrada,dentro_sede_entrada,sede_entrada_nombre,' +
                'distancia_entrada_m,precision_entrada_m,' +
                'hora_salida,dentro_sede_salida,sede_salida_nombre,' +
                'distancia_salida_m,precision_salida_m,nota_correccion')
        .order('fecha', { ascending: false }).range(desde, desde + 999);
      if (f.desde) q = q.gte('fecha', f.desde);
      if (f.hasta) q = q.lte('fecha', f.hasta);
      if (f.quien) q = q.ilike('empleado_nombre', '*' + f.quien.replace(/[%,()]/g, '') + '*');
      return q;
    }, 20000).then(function (todo) {
      var si = function (v) { return v === true ? 'Sí' : (v === false ? 'No' : ''); };
      var mt = function (v) { var n = metros(v); return n == null ? '' : n; };
      /* 14 encabezados, 14 datos por fila, 14 anchos. Si los tres no
         coinciden, el Excel sale con los datos corridos de columna y sin
         avisar. */
      var filas = todo.map(function (x) {
        return [fechaCorta(x.fecha), x.empleado_nombre, x.cedula,
                x.hora_entrada ? horaCorta(x.hora_entrada) : '',
                si(x.dentro_sede_entrada), mt(x.distancia_entrada_m), mt(x.precision_entrada_m),
                x.sede_entrada_nombre || '',
                x.hora_salida ? horaCorta(x.hora_salida) : '',
                si(x.dentro_sede_salida), mt(x.distancia_salida_m), mt(x.precision_salida_m),
                x.sede_salida_nombre || '', x.nota_correccion || ''];
      });
      window.FARMREP.excel('Asistencia - Direccion de Salud', [{
        nombre: 'Asistencia',
        titulo: 'Asistencia del personal · Dirección de Salud',
        encabezados: ['Fecha', 'Empleado', 'Cédula',
                      'Hora entrada', '¿Dentro del sitio?', 'Metros de la sede (entrada)',
                      'Error del GPS (entrada)', 'Sitio de entrada',
                      'Hora salida', '¿Dentro del sitio?', 'Metros de la sede (salida)',
                      'Error del GPS (salida)', 'Sitio de salida', 'Corrección'],
        filas: filas,
        anchos: [12, 26, 14, 12, 15, 17, 16, 20, 12, 15, 17, 16, 20, 30]
      }]);
      btn.disabled = false; btn.textContent = texto;
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = texto;
      aviso('bad', 'No se pudo preparar la descarga: ' + (e.message || e));
    });
  }

  /* ----------------------------------------------------------- personal
     La Dirección de Salud entra a la app SOLO con cédula: no tiene cuenta
     de Despacho/Inventario/Administración. Crear a alguien o resetearle
     la clave pasa por una RPC (la clave va hasheada, un UPDATE normal por
     REST no puede calcular eso). */
  function verPersonal() {
    var z = document.getElementById('zonaAsis');
    z.innerHTML = '<div class="cargando">Cargando…</div>';
    sb.from('asistencia_personal').select('cedula,nombre,telefono,correo,activo,debe_cambiar_clave').order('nombre')
      .then(function (r) {
        if (r.error) { z.innerHTML = '<div class=\"aviso bad\">' + esc(enCristiano(r.error)) + '</div>'; return; }
        var f = r.data || [];
        z.innerHTML =
          '<h2 class="sub-t">Personal de la Dirección de Salud (' + f.length + ')</h2>' +
          '<p class="sub">Entran a la app solo con su cédula. La clave la pones tú aquí; ' +
          'al primer ingreso, la app les pide cambiarla.</p>' +
          (f.length ? '<div class="renglones">' + f.map(function (p) {
            return '<div class="renglon"><div class="que"><b>' + esc(p.nombre) + '</b>' +
              '<span>C.I. ' + esc(p.cedula) + (p.telefono ? ' · ' + esc(p.telefono) : '') +
              (p.correo ? ' · ' + esc(p.correo) : '') +
              (p.activo ? '' : ' · <em class="ojo">desactivado</em>') +
              (p.debe_cambiar_clave ? ' · <em class="ojo">clave pendiente de cambiar</em>' : '') + '</span></div>' +
              '<div class="acciones-u">' +
                '<button type="button" class="quitar" data-personal-toggle="' + esc(p.cedula) + '" data-a="' + (p.activo ? 1 : 0) + '">' +
                (p.activo ? 'Desactivar' : 'Activar') + '</button>' +
                '<button type="button" class="suave" data-resetear="' + esc(p.cedula) + '" data-nombre="' + esc(p.nombre) + '">Restablecer clave</button>' +
              '</div></div>';
          }).join('') + '</div>' : '<p class="sub">Todavía no hay nadie cargado.</p>') +

          '<h2 class="sub-t">Agregar a alguien</h2>' +
          '<label for="asCedula">Cédula (sin V ni puntos)</label>' +
          '<input id="asCedula" type="text" inputmode="numeric" placeholder="12345678">' +
          '<label for="asNombre">Nombre y apellido</label>' +
          '<input id="asNombre" type="text" placeholder="Nombre Apellido">' +
          '<div class="fila-clave">' +
            '<div style="flex:1"><label for="asTelefono">Teléfono</label><input id="asTelefono" type="text" placeholder="0414-1234567"></div>' +
            '<div style="flex:1"><label for="asCorreo">Correo (opcional)</label><input id="asCorreo" type="email"></div>' +
          '</div>' +
          '<label for="asClave">Clave inicial (se la dictas a la persona; se la cambia al entrar)</label>' +
          '<div class="fila-clave">' +
            '<input id="asClave" type="text" style="flex:1" value="' + esc(claveSugerida()) + '">' +
            '<button type="button" id="asOtraClave" class="suave" title="Sugerir otra clave">Otra</button>' +
          '</div>' +
          '<div class="botonera"><button type="button" class="principal" id="asAgregar">Agregar</button></div>';

        document.getElementById('asOtraClave').addEventListener('click', function () {
          document.getElementById('asClave').value = claveSugerida();
        });

        z.querySelectorAll('[data-personal-toggle]').forEach(function (b) {
          b.addEventListener('click', function () {
            var activando = b.dataset.a !== '1';
            b.disabled = true;
            sb.from('asistencia_personal').update({ activo: activando }).eq('cedula', b.dataset.personalToggle)
              .then(function (r) {
                b.disabled = false;
                if (r.error) { aviso('bad', enCristiano(r.error)); return; }
                aviso('ok', 'Listo.'); verPersonal();
              });
          });
        });

        z.querySelectorAll('[data-resetear]').forEach(function (b) {
          b.addEventListener('click', function () {
            var nueva = window.prompt('Nueva clave para ' + b.dataset.nombre + '. Se le va a pedir que la cambie al entrar.', claveSugerida());
            if (nueva === null) return;
            if (nueva.length < 6) { aviso('warn', 'La clave debe tener al menos 6 caracteres.'); return; }
            b.disabled = true;
            sb.rpc('asis_admin_resetear_clave', { p_cedula: b.dataset.resetear, p_clave_nueva: nueva }).then(function (r) {
              b.disabled = false;
              if (r.error) { aviso('bad', enCristiano(r.error)); return; }
              aviso('ok', 'Clave restablecida para ' + b.dataset.nombre + '.'); verPersonal();
            });
          });
        });

        document.getElementById('asAgregar').addEventListener('click', function () {
          var boton = this;
          var cedula = document.getElementById('asCedula').value.replace(/\D/g, '');
          var nombre = document.getElementById('asNombre').value.trim();
          var telefono = document.getElementById('asTelefono').value.trim();
          var correo = document.getElementById('asCorreo').value.trim();
          var clave = document.getElementById('asClave').value;
          if (!/^\d{6,9}$/.test(cedula)) { aviso('warn', 'La cédula debe tener entre 6 y 9 números.'); return; }
          if (nombre.length < 4) { aviso('warn', 'Escribe el nombre y el apellido completos.'); return; }
          if (clave.length < 6) { aviso('warn', 'La clave debe tener al menos 6 caracteres.'); return; }
          boton.disabled = true;
          sb.rpc('asis_admin_crear_personal', {
            p_cedula: cedula, p_nombre: nombre, p_telefono: telefono || null,
            p_correo: correo || null, p_clave_inicial: clave
          }).then(function (r) {
            boton.disabled = false;
            if (r.error) { aviso('bad', enCristiano(r.error)); return; }
            aviso('ok', nombre + ' agregado(a). Clave inicial: ' + clave); verPersonal();
          });
        });
      });
  }

  /* -------------------------------------------------------------- sedes
     El radio se edita aquí porque es la mitad del candado: la otra mitad
     es la tolerancia, que está en Horario. Se muestran las coordenadas
     con enlace a Google Maps para poder comprobar de un vistazo que el
     punto es de verdad la puerta de la Dirección, y no un punto pegado
     mal de otro lado. */
  function verSedes() {
    var z = document.getElementById('zonaAsis');
    z.innerHTML = '<div class="cargando">Cargando…</div>';

    Promise.all([
      sb.from('sedes').select('id,nombre,latitud,longitud,radio_metros,activo').order('nombre'),
      sb.from('config_asistencia').select('tolerancia_gps_metros').eq('id', 1).single()
    ]).then(function (r) {
      if (r[0].error) { z.innerHTML = '<div class="aviso bad">' + esc(enCristiano(r[0].error)) + '</div>'; return; }
      var f = r[0].data || [];
      var tol = (r[1].data && r[1].data.tolerancia_gps_metros != null) ? Number(r[1].data.tolerancia_gps_metros) : null;

      z.innerHTML =
        '<h2 class="sub-t">Sitios donde se puede marcar</h2>' +
        '<p class="sub">La app compara la ubicación del teléfono contra estos sitios y ' +
        '<b>la base rechaza el marcaje de quien no esté ahí</b>. Sin ningún sitio activo el ' +
        'marcaje se guarda igual, pero sin poder confirmar si la persona estaba en el lugar.</p>' +
        (tol != null
          ? '<p class="sub">Al radio de cada sitio se le suma la <b>tolerancia de ' + tol + ' m</b> ' +
            'que está en la pestaña Horario, y nunca más de lo que el propio teléfono admita ' +
            'equivocarse. Ejemplo: radio de 15 m y un teléfono que dice acertar a ±12 m, deja ' +
            'marcar hasta 27 m del punto.</p>'
          : '') +

        (f.length ? '<div class="renglones">' + f.map(function (s) {
          var mapa = 'https://www.google.com/maps?q=' + encodeURIComponent(s.latitud + ',' + s.longitud);
          return '<div class="renglon rev">' +
            '<div class="que"><b>' + esc(s.nombre) + '</b>' +
              '<span>' + esc(s.latitud) + ', ' + esc(s.longitud) +
              (s.activo ? '' : ' · <em class="ojo">desactivado</em>') + '</span>' +
              '<span class="meds">Radio actual: <b>' + esc(s.radio_metros) + ' m</b> · ' +
              '<a href="' + esc(mapa) + '" target="_blank" rel="noopener">ver el punto en Google Maps</a>' +
              '</span></div>' +
            '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;width:100%">' +
              '<div style="flex:1;min-width:130px">' +
                '<label for="asRadio_' + esc(s.id) + '" style="margin-top:0">Radio en metros</label>' +
                '<input id="asRadio_' + esc(s.id) + '" type="number" inputmode="numeric" min="5" max="2000" ' +
                'value="' + esc(s.radio_metros) + '">' +
              '</div>' +
              '<button type="button" class="suave" data-guardar-radio="' + esc(s.id) + '" ' +
                'data-nombre="' + esc(s.nombre) + '">Guardar radio</button>' +
              '<button type="button" class="suave" data-sede-toggle="' + esc(s.id) + '" data-a="' + (s.activo ? 1 : 0) + '">' +
              (s.activo ? 'Desactivar' : 'Activar') + '</button>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>' : '<p class="sub">Todavía no hay ningún sitio cargado.</p>') +

        '<h2 class="sub-t">Agregar un sitio</h2>' +
        '<label for="asSedeNombre">Nombre</label>' +
        '<input id="asSedeNombre" type="text" placeholder="Ej: Dirección de Salud">' +
        '<label for="asPegar">Pegar coordenadas (opcional)</label>' +
        '<input id="asPegar" type="text" placeholder="Ej: 10.237365, -66.859424 (lo que copias de Google Maps)">' +
        '<div class="fila-clave">' +
          '<div style="flex:1"><label for="asLat">Latitud</label><input id="asLat" type="text" inputmode="decimal"></div>' +
          '<div style="flex:1"><label for="asLng">Longitud</label><input id="asLng" type="text" inputmode="decimal"></div>' +
        '</div>' +
        '<label for="asSedeRadio">Radio permitido (metros)</label>' +
        '<input id="asSedeRadio" type="number" inputmode="numeric" value="15" min="5" max="2000">' +
        '<p class="sub chico">Con 15 m alcanza para un edificio pequeño: la tolerancia del GPS ' +
        'hace el resto. Si el sitio es grande (un galpón, un patio), súbelo.</p>' +
        '<div class="botonera"><button type="button" class="principal" id="asSedeGuardar">Agregar sitio</button></div>';

      /* --- guardar el radio de un sitio que ya existe --- */
      z.querySelectorAll('[data-guardar-radio]').forEach(function (b) {
        b.addEventListener('click', function () {
          var campo = document.getElementById('asRadio_' + b.dataset.guardarRadio);
          var radio = parseInt(campo.value, 10);
          if (!isFinite(radio) || radio < 5 || radio > 2000) {
            aviso('warn', 'El radio tiene que estar entre 5 y 2000 metros.');
            return;
          }
          b.disabled = true;
          sb.from('sedes').update({ radio_metros: radio }).eq('id', b.dataset.guardarRadio).select()
            .then(function (r) {
              b.disabled = false;
              if (r.error) { aviso('bad', enCristiano(r.error)); return; }
              if (!r.data || !r.data.length) {
                aviso('bad', 'La base no confirmó el cambio: no se guardó nada.');
                return;
              }
              aviso('ok', 'El radio de «' + b.dataset.nombre + '» quedó en ' + radio +
                          ' m. Ya aplica de inmediato en la app.');
              verSedes();
            });
        });
      });

      /* --- activar y desactivar un sitio --- */
      z.querySelectorAll('[data-sede-toggle]').forEach(function (b) {
        b.addEventListener('click', function () {
          var activando = b.dataset.a !== '1';
          b.disabled = true;
          sb.from('sedes').update({ activo: activando }).eq('id', b.dataset.sedeToggle)
            .then(function (r) {
              b.disabled = false;
              if (r.error) { aviso('bad', enCristiano(r.error)); return; }
              aviso('ok', 'Listo.'); verSedes();
            });
        });
      });

      document.getElementById('asPegar').addEventListener('input', function () {
        var m = this.value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
        if (m) { document.getElementById('asLat').value = m[1]; document.getElementById('asLng').value = m[2]; }
      });

      document.getElementById('asSedeGuardar').addEventListener('click', function () {
        var boton = this;
        var nombre = document.getElementById('asSedeNombre').value.trim();
        var lat = parseFloat(document.getElementById('asLat').value);
        var lng = parseFloat(document.getElementById('asLng').value);
        var radio = parseInt(document.getElementById('asSedeRadio').value, 10);
        if (!nombre) { aviso('warn', 'Falta el nombre del sitio.'); return; }
        if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          aviso('warn', 'La latitud y la longitud no son válidas. Revísalas.');
          return;
        }
        if (!isFinite(radio) || radio < 5 || radio > 2000) {
          aviso('warn', 'El radio tiene que estar entre 5 y 2000 metros.');
          return;
        }
        boton.disabled = true;
        sb.from('sedes').insert({ nombre: nombre, latitud: lat, longitud: lng, radio_metros: radio })
          .then(function (r) {
            boton.disabled = false;
            if (r.error) { aviso('bad', enCristiano(r.error)); return; }
            aviso('ok', 'Sitio agregado.'); verSedes();
          });
      });
    }).catch(function (e) {
      z.innerHTML = '<div class="aviso bad">' + esc(e.message || e) + '</div>';
    });
  }

  /* ------------------------------------------------------------ horario
     Las dos ventanas para marcar y el candado de sitio. Todo esto son
     candados de verdad: los aplica la base (asis_verificar_ventana y
     asis_verificar_sitio), no la pantalla. */
  function verHorario() {
    var z = document.getElementById('zonaAsis');
    z.innerHTML = '<div class="cargando">Cargando…</div>';
    sb.from('config_asistencia').select('*').eq('id', 1).single().then(function (r) {
      if (r.error) { z.innerHTML = '<div class=\"aviso bad\">' + esc(enCristiano(r.error)) + '</div>'; return; }
      var c = r.data || {};
      var exige = c.exigir_gps !== false;

      z.innerHTML =
        '<h2 class="sub-t">Ventana para marcar entrada</h2>' +
        '<p class="sub"><b>Candado de verdad:</b> fuera de este rango, la app no deja marcar la entrada.</p>' +
        '<div class="fila-clave">' +
          '<div style="flex:1"><label for="asEntDesde">Desde</label><input id="asEntDesde" type="time" value="' + esc((c.entrada_desde || '07:00').slice(0, 5)) + '"></div>' +
          '<div style="flex:1"><label for="asEntHasta">Hasta</label><input id="asEntHasta" type="time" value="' + esc((c.entrada_hasta || '08:45').slice(0, 5)) + '"></div>' +
        '</div>' +
        '<div class="botonera"><button type="button" class="principal" id="asGuardarEntrada">Guardar ventana de entrada</button></div>' +

        '<h2 class="sub-t" style="margin-top:28px">Ventana para marcar salida</h2>' +
        '<p class="sub"><b>Candado de verdad:</b> fuera de este rango, la app no deja marcar la salida.</p>' +
        '<div class="fila-clave">' +
          '<div style="flex:1"><label for="asSalDesde">Desde</label><input id="asSalDesde" type="time" value="' + esc((c.salida_desde || '16:30').slice(0, 5)) + '"></div>' +
          '<div style="flex:1"><label for="asSalHasta">Hasta</label><input id="asSalHasta" type="time" value="' + esc((c.salida_hasta || '18:30').slice(0, 5)) + '"></div>' +
        '</div>' +
        '<div class="botonera"><button type="button" class="principal" id="asGuardarSalida">Guardar ventana de salida</button></div>' +

        '<h2 class="sub-t" style="margin-top:28px">Estar en el sitio (GPS)</h2>' +
        '<p class="sub"><b>Por qué existe la tolerancia:</b> el GPS de un teléfono no da un punto ' +
        'exacto, se equivoca entre 10 y 20 metros según el cielo, el techo y el aparato. Con un ' +
        'radio de 15 m y sin darle esa gracia, habría gente parada <b>dentro</b> de la oficina ' +
        'que no podría marcar. Por eso se acepta cuando es creíble que esté dentro: a los metros ' +
        'medidos se les descuenta el error que el propio teléfono declara, sin pasarse de la ' +
        'tolerancia. Nunca se regala más de lo que el teléfono admite equivocarse.</p>' +

        '<div class="renglon" style="margin-top:12px">' +
          '<div class="que"><b>Exigir estar en la sede para poder marcar</b>' +
          '<span>Encendido: sin ubicación, o estando fuera del sitio, la base no deja marcar. ' +
          'Apágalo solo si el GPS de un teléfono está dando problemas.</span></div>' +
          '<span class="pill" id="asGpsEstado" style="background:' +
            (exige ? 'var(--ok-bg);color:var(--ok-ink)' : 'var(--warn-bg);color:var(--warn-ink)') + '">' +
            (exige ? 'encendido' : 'apagado') + '</span>' +
          '<input type="checkbox" id="asExigirGps" ' + (exige ? 'checked' : '') + ' ' +
            'aria-label="Exigir estar en la sede para poder marcar" ' +
            'style="flex:none;width:28px;height:28px;accent-color:var(--navy);cursor:pointer">' +
        '</div>' +

        '<label for="asTolerancia">Tolerancia del GPS, en metros</label>' +
        '<input id="asTolerancia" type="number" inputmode="numeric" min="0" max="200" ' +
          'value="' + esc(c.tolerancia_gps_metros == null ? 35 : c.tolerancia_gps_metros) + '">' +
        '<p class="sub chico">Metros de gracia que se le suman al radio del sitio, y solo hasta ' +
        'donde llegue el error que declara el teléfono.</p>' +

        '<label for="asPrecision">Error máximo aceptado del teléfono, en metros</label>' +
        '<input id="asPrecision" type="number" inputmode="numeric" min="20" max="1000" ' +
          'value="' + esc(c.precision_maxima_metros == null ? 100 : c.precision_maxima_metros) + '">' +
        '<p class="sub chico">Si el teléfono avisa que su ubicación puede estar errada más que ' +
        'esto, no se acepta: eso no es GPS, es la antena del celular o el wifi.</p>' +

        '<div class="botonera"><button type="button" class="principal" id="asGuardarGps">Guardar el candado de sitio</button></div>';

      /* La etiqueta de al lado dice lo que está a punto de guardarse, no
         lo que ya está guardado: por eso cambia al tocar el interruptor. */
      var caja = document.getElementById('asExigirGps');
      caja.addEventListener('change', function () {
        var p = document.getElementById('asGpsEstado');
        p.textContent = caja.checked ? 'encendido' : 'apagado';
        p.style.background = caja.checked ? 'var(--ok-bg)' : 'var(--warn-bg)';
        p.style.color = caja.checked ? 'var(--ok-ink)' : 'var(--warn-ink)';
      });

      function guardar(campos, boton, mensaje) {
        boton.disabled = true;
        campos.actualizado_en = new Date().toISOString();
        sb.from('config_asistencia').update(campos).eq('id', 1).select()
          .then(function (r) {
            boton.disabled = false;
            if (r.error) { aviso('bad', enCristiano(r.error)); return; }
            /* Si la base no devolvió la fila, el cambio NO ocurrió (por
               ejemplo, porque quien está usando esto ya no es admin).
               No se dice "guardado" sin que el servidor lo confirme. */
            if (!r.data || !r.data.length) {
              aviso('bad', 'La base no confirmó el cambio: no se guardó nada. Vuelve a entrar e inténtalo otra vez.');
              return;
            }
            aviso('ok', mensaje);
          });
      }

      document.getElementById('asGuardarEntrada').addEventListener('click', function () {
        var desde = document.getElementById('asEntDesde').value;
        var hasta = document.getElementById('asEntHasta').value;
        if (!desde || !hasta || desde >= hasta) { aviso('warn', 'La hora de inicio debe ser antes que la de fin.'); return; }
        guardar({ entrada_desde: desde, entrada_hasta: hasta },
                this, 'Ventana de entrada actualizada. Ya aplica de inmediato en la app.');
      });

      document.getElementById('asGuardarSalida').addEventListener('click', function () {
        var desde = document.getElementById('asSalDesde').value;
        var hasta = document.getElementById('asSalHasta').value;
        if (!desde || !hasta || desde >= hasta) { aviso('warn', 'La hora de inicio debe ser antes que la de fin.'); return; }
        guardar({ salida_desde: desde, salida_hasta: hasta },
                this, 'Ventana de salida actualizada. Ya aplica de inmediato en la app.');
      });

      document.getElementById('asGuardarGps').addEventListener('click', function () {
        var exigir = document.getElementById('asExigirGps').checked;
        var tol = parseInt(document.getElementById('asTolerancia').value, 10);
        var pre = parseInt(document.getElementById('asPrecision').value, 10);
        if (!isFinite(tol) || tol < 0 || tol > 200) {
          aviso('warn', 'La tolerancia tiene que estar entre 0 y 200 metros.'); return;
        }
        if (!isFinite(pre) || pre < 20 || pre > 1000) {
          aviso('warn', 'El error máximo aceptado tiene que estar entre 20 y 1000 metros.'); return;
        }
        if (!exigir && !window.confirm(
              'Si apagas esto, cualquiera va a poder marcar desde donde esté, ' +
              'aunque no haya llegado a la Dirección de Salud.\n\n¿Seguro?')) return;
        guardar({ exigir_gps: exigir, tolerancia_gps_metros: tol, precision_maxima_metros: pre },
                this, exigir
                  ? 'Candado de sitio guardado: solo se puede marcar dentro de la sede.'
                  : 'Guardado. OJO: el candado de sitio quedó APAGADO, se puede marcar desde cualquier lado.');
      });
    });
  }

  window.PANTALLA_ASISTENCIA = function (sbCliente, zona, usuario) {
    sb = sbCliente; ancla = zona; yo = usuario; sub = 'hoy'; pintar();
  };
})();
