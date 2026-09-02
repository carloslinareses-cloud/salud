/* Farmacia Municipal — Alcaldía de Cristóbal Rojas
   Aplicación de una sola página, sin compilación: se publica tal cual.
   La seguridad real vive en las políticas RLS de la base, no en este archivo. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------------------------------------------------------
     Estado de la obra. Al terminar cada etapa se cambia aquí y el
     usuario lo ve publicado. Estados: 'hecho' | 'curso' | 'falta'
  --------------------------------------------------------------- */
  var PASOS = [
    { e: 'hecho', t: 'Espacio en internet creado',
      d: 'salud.alcaldiadecharallave.com, con su repositorio y publicación automática' },
    { e: 'hecho', t: 'Datos actuales leídos y revisados',
      d: '1.496 pacientes, 414 medicamentos y 645 entregas, sacados de los Excel de la Dirección de Salud' },
    { e: 'hecho', t: 'Base de datos, permisos y bitácora',
      d: '10 tablas, 26 permisos y 14 candados. Probado: no deja despachar vencidos, ni dejar existencia en negativo, ni borrar la bitácora' },
    { e: 'hecho', t: 'Pantalla de entrega de medicamentos',
      d: 'Busca a la persona o al centro, propone el lote que vence primero y descuenta del inventario' },
    { e: 'hecho', t: 'Datos actuales cargados',
      d: '455 medicamentos, 472 lotes y 1.496 pacientes. 78 quedaron marcados para revisar: ninguno se perdió' },
    { e: 'hecho', t: 'Pantalla de entrada de mercancía',
      d: 'Registrar lo que llega con su lote y vencimiento, alertas, bajas y corrección por conteo' },
    { e: 'hecho', t: 'Panel del administrador',
      d: 'Cifras del día, actividad en vivo, bitácora consultable, usuarios y pacientes por revisar' },
    { e: 'hecho', t: 'Historial de entregas traspasado',
      d: '4.999 entregas de los Excel, consultables por cédula o por nombre. No descuentan inventario: el 87% no anotaba la cantidad' }
  ];

  var MARCA = { hecho: '✓', curso: '•', falta: '' };

  function pintarPasos() {
    var ul = $('listaPasos');
    if (!ul) return;
    ul.innerHTML = PASOS.map(function (p) {
      return '<li class="' + p.e + '">' +
        '<span class="mark" aria-hidden="true">' + MARCA[p.e] + '</span>' +
        '<span><span class="t">' + p.t + '</span>' +
        '<span class="d">' + p.d + '</span></span></li>';
    }).join('');
  }

  /* ---------------------------------------------------------------
     Acceso
  --------------------------------------------------------------- */
  var sb = null;

  function iniciarSupabase() {
    if (!window.CONFIG || !window.CONFIG.listo()) return false;
    if (!window.supabase) return false;
    sb = window.supabase.createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON_KEY,
      { db: { schema: window.CONFIG.ESQUEMA || 'farmacia' } });
    return true;
  }

  function mostrarError(msg) {
    var e = $('errorAcceso');
    e.textContent = msg;
    e.hidden = false;
  }

  function traducirError(err) {
    var m = (err && err.message ? err.message : String(err)).toLowerCase();
    if (m.indexOf('invalid login') >= 0) return 'El correo o la contraseña no son correctos.';
    if (m.indexOf('email not confirmed') >= 0) return 'Falta confirmar el correo. Revisa tu bandeja.';
    if (m.indexOf('failed to fetch') >= 0 || m.indexOf('network') >= 0)
      return 'No hay conexión con el servidor. Revisa tu internet y vuelve a intentar.';
    if (m.indexOf('too many') >= 0) return 'Demasiados intentos. Espera un minuto y vuelve a intentar.';
    return 'No se pudo entrar. ' + (err && err.message ? err.message : '');
  }

  function entrar(ev) {
    ev.preventDefault();
    $('errorAcceso').hidden = true;

    if (!sb) {
      mostrarError('El sistema todavía no tiene base de datos conectada.');
      return;
    }
    var btn = $('btnEntrar');
    btn.disabled = true;
    btn.textContent = 'Entrando…';

    sb.auth.signInWithPassword({ email: $('correo').value.trim(), password: $('clave').value })
      .then(function (r) {
        if (r.error) throw r.error;
        return cargarSesion();
      })
      .catch(function (err) { mostrarError(traducirError(err)); })
      .then(function () { btn.disabled = false; btn.textContent = 'Entrar'; });
  }

  function registrarse() {
    $('errorAcceso').hidden = true;
    var correo = $('correo').value.trim(), clave = $('clave').value;
    if (!correo || clave.length < 8) {
      mostrarError('Escribe tu correo y una contraseña de al menos 8 caracteres, y vuelve a pulsar Regístrate.');
      return;
    }
    if (!sb) { mostrarError('Todavía no hay conexión con el servidor.'); return; }
    sb.auth.signUp({ email: correo, password: clave }).then(function (r) {
      if (r.error) throw r.error;
      var e = $('errorAcceso');
      e.className = 'aviso ok';
      e.textContent = 'Cuenta creada. Avísale al administrador para que te dé permisos: ' +
                      'hasta entonces no vas a poder entrar.';
      e.hidden = false;
    }).catch(function (err) { mostrarError(traducirError(err)); });
  }

  function salir() {
    if (!sb) return;
    sb.auth.signOut().then(function () { location.reload(); });
  }

  /* ---------------------------------------------------------------
     Sesión y perfil
  --------------------------------------------------------------- */
  var PERFILES = {
    admin:      { titulo: 'Panel del administrador', sub: 'Usuarios, actividad de todos y bitácora completa' },
    inventario: { titulo: 'Entrada de mercancía',    sub: 'Registrar lo que llega, con su lote y su vencimiento' },
    despacho:   { titulo: 'Entrega de medicamentos', sub: 'Buscar al paciente y registrar lo que se le entrega' }
  };

  function cargarSesion() {
    if (!sb) return Promise.resolve();
    return sb.auth.getUser().then(function (r) {
      var u = r && r.data ? r.data.user : null;
      if (!u) return;
      return sb.from('perfiles').select('nombre, rol, activo, debe_cambiar_clave').eq('id', u.id).single()
        .then(function (p) {
          var perfil = p && p.data ? p.data : null;
          if (!perfil || perfil.activo === false) {
            mostrarError('Tu usuario está desactivado. Habla con el administrador.');
            return sb.auth.signOut();
          }
          if (perfil.debe_cambiar_clave) { pedirCambioClave(u, perfil); return; }
          abrirPanel(u, perfil);
        });
    });
  }

  /* ---------------------------------------------------------------
     Cambio de contraseña obligatorio la primera vez.
     Mientras no la cambie, no ve ninguna pantalla del sistema.
  --------------------------------------------------------------- */
  function pedirCambioClave(usuario, perfil) {
    $('vistaAcceso').hidden = true;
    $('vistaPanel').hidden = true;
    $('vistaClave').hidden = false;
    $('chipUsuario').textContent = perfil.nombre || usuario.email;
    $('chipUsuario').hidden = false;
    $('btnSalir').hidden = false;

    var btn = $('btnGuardarClave'), err = $('errorClave');
    btn.onclick = function () {
      err.hidden = true;
      var c1 = $('clave1').value, c2 = $('clave2').value;
      var problema = window.FARM ? window.FARM.revisaClave(c1) : (c1.length < 8 ? 'Muy corta.' : null);
      if (problema) { err.textContent = problema; err.hidden = false; return; }
      if (c1 !== c2) { err.textContent = 'Las dos no coinciden. Escríbelas de nuevo.'; err.hidden = false; return; }

      btn.disabled = true; btn.textContent = 'Guardando…';
      sb.auth.updateUser({ password: c1 }).then(function (r) {
        if (r.error) throw r.error;
        return sb.from('perfiles')
          .update({ debe_cambiar_clave: false, clave_cambiada_en: new Date().toISOString() })
          .eq('id', usuario.id);
      }).then(function (r) {
        if (r && r.error) throw r.error;
        $('vistaClave').hidden = true;
        perfil.debe_cambiar_clave = false;
        abrirPanel(usuario, perfil);
      }).catch(function (e) {
        // Nunca decimos que se guardó si el servidor no confirmó.
        err.textContent = window.FARM ? window.FARM.traduceError(e) : (e.message || String(e));
        err.hidden = false;
        btn.disabled = false; btn.textContent = 'Guardar y entrar';
      });
    };
  }

  function abrirPanel(usuario, perfil) {
    var info = PERFILES[perfil.rol] || { titulo: 'Panel', sub: '' };
    $('vistaAcceso').hidden = true;
    $('vistaPanel').hidden = false;
    $('tituloPanel').textContent = info.titulo;
    $('subPanel').textContent = info.sub;
    $('chipUsuario').textContent = (perfil.nombre || usuario.email) + ' · ' + perfil.rol;
    $('chipUsuario').hidden = false;
    $('btnSalir').hidden = false;
    var zona = $('contenidoPanel');
    zona.innerHTML = '';

    if (perfil.rol === 'admin' && window.PANTALLA_ADMIN) {
      window.PANTALLA_ADMIN(sb, zona, usuario);
      return;
    }
    if (perfil.rol === 'inventario' && window.PANTALLA_INVENTARIO) {
      window.PANTALLA_INVENTARIO(sb, zona);
      return;
    }
    if (perfil.rol === 'despacho' && window.PANTALLA_DESPACHO) {
      window.PANTALLA_DESPACHO(sb, zona);
      return;
    }
    zona.innerHTML =
      '<div class="tarjeta"><h2>En construcción</h2>' +
      '<p class="sub">Esta pantalla se habilita en la siguiente etapa.</p></div>';
  }

  /* ---------------------------------------------------------------
     Arranque
  --------------------------------------------------------------- */
  function arrancar() {
    pintarPasos();
    $('pie').textContent = 'Publicado el ' +
      new Date().toLocaleDateString('es-VE', { day: 'numeric', month: 'long', year: 'numeric' });

    $('formAcceso').addEventListener('submit', entrar);
    $('btnRegistro').addEventListener('click', registrarse);
    $('btnSalir').addEventListener('click', salir);

    if (!window.CONFIG || !window.CONFIG.listo()) {
      $('avisoPreparacion').hidden = false;
      $('btnEntrar').disabled = true;
      return;
    }
    // La biblioteca de Supabase solo se carga si ya hay configuración.
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
    s.onload = function () { if (iniciarSupabase()) cargarSesion(); };
    s.onerror = function () { mostrarError('No se pudo cargar la conexión. Revisa tu internet.'); };
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }
})();
