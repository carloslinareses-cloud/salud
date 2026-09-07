/* Prueba de punta a punta de la funcion farmacia-usuarios.
   Crea sus propios datos con la marca ZZZP y los borra al terminar. */
const REF = 'tfbzghjjfcaqmkzsxrrs'
const URL = `https://${REF}.supabase.co`
const FN = `${URL}/functions/v1/farmacia-usuarios`
const TOKEN = process.env.SUPABASE_TOKEN
const ADMIN_CORREO = process.env.FARMACIA_ADMIN_CORREO || 'carlos.linares.es@gmail.com'
const ADMIN_CLAVE = process.env.FARMACIA_ADMIN_CLAVE
if (!ADMIN_CLAVE) {
  console.error('Falta la variable FARMACIA_ADMIN_CLAVE con la contrasena del administrador.')
  process.exit(2)
}

let ok = 0, mal = 0
const fallos = []
function prueba(nombre, cond, detalle = '') {
  if (cond) { ok++; console.log('  OK    ' + nombre) }
  else { mal++; fallos.push(nombre + '  ' + detalle); console.log('  FALLA ' + nombre + '   ' + detalle) }
}

async function pide(url, opts = {}) {
  const r = await fetch(url, opts)
  const t = await r.text()
  let j = null
  try { j = t ? JSON.parse(t) : null } catch { j = t.slice(0, 200) }
  return { estado: r.status, cuerpo: j }
}

// llaves del proyecto
const ks = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`,
  { headers: { Authorization: 'Bearer ' + TOKEN } })).json()
const ANON = ks.find(k => k.name === 'anon').api_key
const SRV = ks.find(k => k.name === 'service_role').api_key

const entrar = async (correo, clave) => {
  const r = await pide(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password: clave }),
  })
  return r.estado === 200 ? r.cuerpo.access_token : null
}
const llama = (token, cuerpo) => pide(FN, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify(cuerpo),
})

const MARCA = 'zzzp' + Math.floor(Date.now() / 1000).toString(36)
const CORREO_NUEVO = `${MARCA}.despacho@prueba.local`
const CLAVE_NUEVA = 'Prueba-Farmacia-2026'

console.log('='.repeat(62))
console.log('PRUEBA DE LA FUNCION farmacia-usuarios')
console.log('='.repeat(62))

console.log('\n--- Quien puede llamarla ---')
const tAdmin = await entrar(ADMIN_CORREO, ADMIN_CLAVE)
prueba('el administrador entra', tAdmin !== null)

let r = await llama('', { accion: 'crear' })
prueba('sin sesion NO deja', r.estado === 401, JSON.stringify(r.cuerpo))

r = await llama('token-inventado-12345', { accion: 'crear' })
prueba('con una sesion falsa NO deja', r.estado === 401, JSON.stringify(r.cuerpo))

r = await llama(ANON, { accion: 'crear' })
prueba('con la llave publica NO deja', r.estado === 401 || r.estado === 403, JSON.stringify(r.cuerpo))

r = await llama(SRV, { accion: 'crear' })
prueba('con la llave de servidor tampoco (no es un usuario)', r.estado === 401 || r.estado === 403, JSON.stringify(r.cuerpo))

console.log('\n--- Lo que no acepta ---')
r = await llama(tAdmin, { accion: 'crear', correo: 'esto-no-es-correo', nombre: 'Ana Prueba', rol: 'despacho', clave: CLAVE_NUEVA })
prueba('rechaza un correo mal escrito', r.estado === 400)
r = await llama(tAdmin, { accion: 'crear', correo: CORREO_NUEVO, nombre: 'Ana', rol: 'despacho', clave: CLAVE_NUEVA })
prueba('rechaza un nombre demasiado corto', r.estado === 400)
r = await llama(tAdmin, { accion: 'crear', correo: CORREO_NUEVO, nombre: 'Ana Prueba', rol: 'jefe_supremo', clave: CLAVE_NUEVA })
prueba('rechaza un puesto que no existe', r.estado === 400, JSON.stringify(r.cuerpo))
r = await llama(tAdmin, { accion: 'crear', correo: CORREO_NUEVO, nombre: 'Ana Prueba', rol: 'despacho', clave: '123' })
prueba('rechaza una clave corta', r.estado === 400)
r = await llama(tAdmin, { accion: 'crear', correo: CORREO_NUEVO, nombre: 'Ana Prueba', rol: 'despacho', clave: 'farmacia123' })
prueba('rechaza una clave facil de adivinar', r.estado === 400)
r = await llama(tAdmin, { accion: 'inventada' })
prueba('rechaza una accion que no existe', r.estado === 400)

console.log('\n--- Crear el usuario completo ---')
r = await llama(tAdmin, { accion: 'crear', correo: CORREO_NUEVO, nombre: 'Ana Prueba Despacho', rol: 'despacho', clave: CLAVE_NUEVA })
prueba('lo crea de una sola vez', r.estado === 200 && r.cuerpo?.ok === true, JSON.stringify(r.cuerpo))
prueba('lo devuelve con su puesto', r.cuerpo?.usuario?.rol === 'despacho')
prueba('lo devuelve activado', r.cuerpo?.usuario?.activo === true)

const tNuevo = await entrar(CORREO_NUEVO, CLAVE_NUEVA)
prueba('la persona nueva YA PUEDE ENTRAR sin registrarse', tNuevo !== null)

const perf = await pide(`${URL}/rest/v1/perfiles?select=nombre,rol,activo,debe_cambiar_clave&correo=eq.${CORREO_NUEVO}`,
  { headers: { apikey: ANON, Authorization: 'Bearer ' + tNuevo, 'Accept-Profile': 'farmacia' } })
prueba('le pide cambiar la contrasena al entrar', perf.cuerpo?.[0]?.debe_cambiar_clave === true, JSON.stringify(perf.cuerpo))
prueba('su nombre quedo bien', perf.cuerpo?.[0]?.nombre === 'Ana Prueba Despacho')

console.log('\n--- Un usuario normal NO puede crear usuarios ---')
r = await llama(tNuevo, { accion: 'crear', correo: `otro.${MARCA}@prueba.local`, nombre: 'Colado Colado', rol: 'admin', clave: CLAVE_NUEVA })
prueba('un despachador NO puede crear a nadie', r.estado === 403, JSON.stringify(r.cuerpo))
r = await llama(tNuevo, { accion: 'borrar', correo: ADMIN_CORREO })
prueba('un despachador NO puede borrar al admin', r.estado === 403)
r = await llama(tNuevo, { accion: 'clave', correo: ADMIN_CORREO, clave: 'MeApodero2026' })
prueba('un despachador NO puede cambiarle la clave al admin', r.estado === 403)

console.log('\n--- No se repiten correos ---')
r = await llama(tAdmin, { accion: 'crear', correo: CORREO_NUEVO, nombre: 'Ana Repetida Otra', rol: 'admin', clave: CLAVE_NUEVA })
prueba('avisa que ese correo ya existe', r.estado === 409, JSON.stringify(r.cuerpo))

console.log('\n--- Cambiarle la contrasena a alguien ---')
const CLAVE_OTRA = 'Charallave-Otra-88'
r = await llama(tAdmin, { accion: 'clave', correo: CORREO_NUEVO, clave: CLAVE_OTRA })
prueba('el admin le pone una contrasena nueva', r.estado === 200 && r.cuerpo?.ok === true, JSON.stringify(r.cuerpo))
prueba('entra con la nueva', (await entrar(CORREO_NUEVO, CLAVE_OTRA)) !== null)
prueba('la vieja ya no sirve', (await entrar(CORREO_NUEVO, CLAVE_NUEVA)) === null)

console.log('\n--- Candados del administrador ---')
r = await llama(tAdmin, { accion: 'borrar', correo: ADMIN_CORREO })
prueba('el admin no se puede borrar a si mismo', r.estado === 400, JSON.stringify(r.cuerpo))

console.log('\n--- Queda en la bitacora ---')
const bit = await pide(`${URL}/rest/v1/bitacora?select=usuario_nombre,operacion,tabla&tabla=eq.perfiles&order=momento.desc&limit=5`,
  { headers: { apikey: ANON, Authorization: 'Bearer ' + tAdmin, 'Accept-Profile': 'farmacia' } })
prueba('la bitacora anoto quien lo hizo',
  Array.isArray(bit.cuerpo) && bit.cuerpo.some(b => b.usuario_nombre === 'Carlos Linares'),
  JSON.stringify(bit.cuerpo))

console.log('\n--- Limpieza ---')
r = await llama(tAdmin, { accion: 'borrar', correo: CORREO_NUEVO })
prueba('el admin lo borra', r.estado === 200 && r.cuerpo?.ok === true, JSON.stringify(r.cuerpo))
prueba('ya no puede entrar', (await entrar(CORREO_NUEVO, CLAVE_OTRA)) === null)
const queda = await pide(`${URL}/rest/v1/perfiles?select=correo&correo=eq.${CORREO_NUEVO}`,
  { headers: { apikey: ANON, Authorization: 'Bearer ' + tAdmin, 'Accept-Profile': 'farmacia' } })
prueba('no quedo su ficha', Array.isArray(queda.cuerpo) && queda.cuerpo.length === 0, JSON.stringify(queda.cuerpo))

console.log('\n' + '='.repeat(62))
if (mal) { console.log(`FALLARON ${mal} de ${ok + mal}`); fallos.forEach(f => console.log('   - ' + f)); process.exit(1) }
console.log(`Pasaron las ${ok} pruebas.`)
