/* ===================================================================
   Crear y administrar los usuarios de la Farmacia Municipal.

   Por qué hace falta una función en el servidor y no se hace desde el
   navegador: crear una cuenta de acceso exige la llave `service_role`,
   que se salta TODOS los permisos de la base de datos. Esa llave no
   puede estar en una página web — quien abra el código fuente la vería
   y tendría el sistema entero. Aquí vive en el servidor, donde nadie
   la ve.

   Cómo se protege:
     1. Solo entra quien traiga la sesión de un administrador activo.
     2. La cuenta de acceso se crea con la llave secreta.
     3. Pero el perfil (nombre, rol, activación) se guarda usando la
        sesión DEL PROPIO ADMINISTRADOR, no la llave secreta. Así el
        permiso lo vuelve a comprobar la base de datos, y la bitácora
        registra quién lo hizo de verdad.
     4. Nadie puede quitarse a sí mismo, ni quitarle el puesto al
        último administrador que queda.

   Se despliega en el proyecto tfbzghjjfcaqmkzsxrrs con el slug
   `farmacia-usuarios`.
=================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const URL_SB   = Deno.env.get('SUPABASE_URL')!;
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANONIMA  = Deno.env.get('SUPABASE_ANON_KEY')!;

const CABECERAS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

const ROLES = ['despacho', 'inventario', 'admin'];

function responde(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: CABECERAS });
}

/* Las mismas reglas que revisa la pantalla, repetidas aquí porque la
   pantalla se puede saltar. */
function revisaClave(clave: string): string | null {
  const c = String(clave || '');
  if (c.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/[a-zA-Z]/.test(c)) return 'La contraseña debe llevar al menos una letra.';
  if (!/\d/.test(c)) return 'La contraseña debe llevar al menos un número.';
  if (/^(?:123|abc|clave|password|farmacia)/i.test(c)) return 'Esa contraseña es muy fácil de adivinar.';
  return null;
}

function revisaCorreo(correo: string): string | null {
  const c = String(correo || '').trim().toLowerCase();
  if (!c) return 'Falta el correo.';
  if (c.length > 254) return 'Ese correo es demasiado largo.';
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(c)) return 'Ese correo no tiene forma de correo.';
  return null;
}

Deno.serve(async (peticion: Request) => {
  if (peticion.method === 'OPTIONS') return new Response('ok', { headers: CABECERAS });
  if (peticion.method !== 'POST') return responde({ error: 'Solo se admite POST.' }, 405);

  /* ---------- 1. ¿quién llama? ---------- */
  const cabecera = peticion.headers.get('Authorization') || '';
  const token = cabecera.replace(/^Bearer\s+/i, '').trim();
  if (!token) return responde({ error: 'Falta la sesión. Vuelve a entrar.' }, 401);

  const admin = createClient(URL_SB, SERVICIO, { auth: { persistSession: false } });

  const { data: quien, error: errQuien } = await admin.auth.getUser(token);
  if (errQuien || !quien?.user) {
    return responde({ error: 'Tu sesión no vale o ya venció. Vuelve a entrar.' }, 401);
  }
  const uidLlamante = quien.user.id;

  /* ---------- 2. ¿es administrador activo? ---------- */
  const { data: perfilLlamante, error: errPerfil } = await admin
    .schema('farmacia').from('perfiles')
    .select('id, rol, activo, nombre').eq('id', uidLlamante).maybeSingle();

  if (errPerfil) return responde({ error: 'No pude comprobar tus permisos.' }, 500);
  if (!perfilLlamante || perfilLlamante.rol !== 'admin' || !perfilLlamante.activo) {
    return responde({ error: 'Esto solo lo puede hacer un administrador.' }, 403);
  }

  /* La sesión del administrador: con ella se tocan los perfiles, para que
     la base vuelva a comprobar el permiso y la bitácora sepa quién fue. */
  const comoAdmin = createClient(URL_SB, ANONIMA, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + token } },
  }).schema('farmacia');

  /* ---------- 3. qué me piden ---------- */
  let cuerpo: any;
  try { cuerpo = await peticion.json(); }
  catch { return responde({ error: 'No entendí la petición.' }, 400); }

  const accion = String(cuerpo?.accion || '');

  /* ================================================================
     CREAR: cuenta de acceso + perfil, todo de una vez
  ================================================================ */
  if (accion === 'crear') {
    const correo = String(cuerpo.correo || '').trim().toLowerCase();
    const nombre = String(cuerpo.nombre || '').trim().replace(/\s+/g, ' ');
    const rol    = String(cuerpo.rol || '');
    const clave  = String(cuerpo.clave || '');

    const malCorreo = revisaCorreo(correo);
    if (malCorreo) return responde({ error: malCorreo }, 400);
    if (nombre.length < 4) return responde({ error: 'Escribe el nombre y el apellido completos.' }, 400);
    if (nombre.length > 120) return responde({ error: 'Ese nombre es demasiado largo.' }, 400);
    if (!ROLES.includes(rol)) return responde({ error: 'Ese puesto no existe.' }, 400);
    const malClave = revisaClave(clave);
    if (malClave) return responde({ error: malClave }, 400);

    /* ¿ya existe ese correo? Se avisa claro en vez de dar un error feo. */
    const { data: yaHay } = await admin
      .schema('farmacia').from('perfiles')
      .select('id, nombre, rol, activo').eq('correo', correo).maybeSingle();
    if (yaHay) {
      return responde({
        error: 'Ya hay un usuario con ese correo: ' + (yaHay.nombre || correo) +
               ' (' + yaHay.rol + (yaHay.activo ? '' : ', desactivado') + '). ' +
               'Si olvidó su contraseña, usa "Cambiarle la contraseña".',
      }, 409);
    }

    /* Se crea la cuenta de acceso. El disparador tr_perfil_nuevo_usuario
       crea sola la fila del perfil, desactivada y sin permisos. */
    const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
      email: correo,
      password: clave,
      email_confirm: true,          // no hay que confirmar por correo
    });
    if (errCrear || !creado?.user) {
      const m = String(errCrear?.message || '');
      if (/already|registered|exists/i.test(m)) {
        return responde({ error: 'Ese correo ya tiene una cuenta de acceso.' }, 409);
      }
      return responde({ error: 'No se pudo crear la cuenta: ' + m }, 400);
    }
    const uidNuevo = creado.user.id;

    /* El perfil se completa CON LA SESIÓN DEL ADMINISTRADOR. */
    const { data: perfil, error: errPerf } = await comoAdmin.from('perfiles')
      .update({
        nombre: nombre,
        rol: rol,
        activo: true,
        debe_cambiar_clave: true,     // la clave la puso otra persona
        clave_cambiada_en: null,
        actualizado_en: new Date().toISOString(),
      })
      .eq('id', uidNuevo)
      .select('id, correo, nombre, rol, activo')
      .maybeSingle();

    if (errPerf || !perfil) {
      /* Si el perfil no se pudo completar, la cuenta a medias no sirve
         y confunde: se deshace para no dejar basura. */
      await admin.auth.admin.deleteUser(uidNuevo).catch(() => {});
      return responde({
        error: 'La cuenta se creó pero no se le pudieron dar los permisos, así que se deshizo. ' +
               (errPerf?.message || ''),
      }, 500);
    }

    return responde({
      ok: true,
      usuario: perfil,
      mensaje: nombre + ' ya puede entrar como ' + rol + '. Le va a pedir cambiar la contraseña.',
    });
  }

  /* ================================================================
     CLAVE: ponerle una contraseña nueva a alguien que la olvidó
  ================================================================ */
  if (accion === 'clave') {
    const correo = String(cuerpo.correo || '').trim().toLowerCase();
    const clave  = String(cuerpo.clave || '');

    const malCorreo = revisaCorreo(correo);
    if (malCorreo) return responde({ error: malCorreo }, 400);
    const malClave = revisaClave(clave);
    if (malClave) return responde({ error: malClave }, 400);

    const { data: destino } = await admin
      .schema('farmacia').from('perfiles')
      .select('id, nombre, rol').eq('correo', correo).maybeSingle();
    if (!destino) return responde({ error: 'No hay ningún usuario con ese correo.' }, 404);

    const { error: errClave } = await admin.auth.admin.updateUserById(destino.id, {
      password: clave,
    });
    if (errClave) return responde({ error: 'No se pudo cambiar la contraseña: ' + errClave.message }, 400);

    /* Queda obligada a cambiarla, porque la puso otra persona.
       Se marca con la sesión del administrador: así entra en la bitácora. */
    await comoAdmin.from('perfiles')
      .update({ debe_cambiar_clave: true, clave_cambiada_en: null,
                actualizado_en: new Date().toISOString() })
      .eq('id', destino.id);

    return responde({
      ok: true,
      mensaje: 'Listo. ' + (destino.nombre || correo) +
               ' entra con esa contraseña y el sistema le pedirá cambiarla.',
    });
  }

  /* ================================================================
     BORRAR: quitar del sistema a alguien que ya no trabaja aquí
  ================================================================ */
  if (accion === 'borrar') {
    const correo = String(cuerpo.correo || '').trim().toLowerCase();
    const malCorreo = revisaCorreo(correo);
    if (malCorreo) return responde({ error: malCorreo }, 400);

    const { data: destino } = await admin
      .schema('farmacia').from('perfiles')
      .select('id, nombre, rol').eq('correo', correo).maybeSingle();
    if (!destino) return responde({ error: 'No hay ningún usuario con ese correo.' }, 404);

    if (destino.id === uidLlamante) {
      return responde({ error: 'No te puedes borrar a ti mismo.' }, 400);
    }

    /* No se puede quedar el sistema sin ningún administrador. */
    if (destino.rol === 'admin') {
      const { count } = await admin.schema('farmacia').from('perfiles')
        .select('id', { count: 'exact', head: true }).eq('rol', 'admin').eq('activo', true);
      if ((count || 0) <= 1) {
        return responde({ error: 'Es el único administrador activo. Nombra otro antes de borrarlo.' }, 400);
      }
    }

    /* Lo que esa persona hizo NO se borra: sus entregas y sus apuntes de
       la bitácora se quedan, con su nombre. Solo se le quita el acceso. */
    const { error: errBorrar } = await admin.auth.admin.deleteUser(destino.id);
    if (errBorrar) return responde({ error: 'No se pudo borrar: ' + errBorrar.message }, 400);

    return responde({
      ok: true,
      mensaje: (destino.nombre || correo) + ' ya no puede entrar. Lo que hizo queda registrado.',
    });
  }

  return responde({ error: 'No sé hacer eso.' }, 400);
});
