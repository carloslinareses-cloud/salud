/* Farmacia Municipal — Alcaldía de Cristóbal Rojas
   Aplicación de una sola página, sin compilación: se publica tal cual.
   La seguridad real vive en las políticas RLS de la base, no en este archivo. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

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
    $('pie').textContent = 'Publicado el ' +
      new Date().toLocaleDateString('es-VE', { day: 'numeric', month: 'long', year: 'numeric' });

    $('formAcceso').addEventListener('submit', entrar);
    $('btnSalir').addEventListener('click', salir);

    if (!window.CONFIG || !window.CONFIG.listo()) {
      $('avisoPreparacion').hidden = false;
      $('btnEntrar').disabled = true;
      return;
    }
    /* La biblioteca de Supabase se carga aparte y tarda. Hasta que llegue,
       el botón queda apagado: si no, quien escribe rápido o tiene mal
       internet pulsa Entrar antes de tiempo y recibe un mensaje que parece
       que el sistema está roto, cuando en realidad solo estaba cargando. */
    var boton = $('btnEntrar');
    var textoBoton = boton.textContent;
    boton.disabled = true;
    boton.textContent = 'Conectando…';

    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
    s.onload = function () {
      if (iniciarSupabase()) {
        boton.disabled = false;
        boton.textContent = textoBoton;
        cargarSesion();
      } else {
        boton.textContent = textoBoton;
        mostrarError('No se pudo preparar la conexión. Recarga la página.');
      }
    };
    s.onerror = function () {
      boton.textContent = textoBoton;
      mostrarError('No se pudo cargar la conexión. Revisa tu internet y recarga la página.');
    };
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }
})();
