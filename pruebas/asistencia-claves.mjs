/* ASISTENCIA: entrar con la clave temporal y cambiarla, de punta a punta.

   Llama al servidor EXACTAMENTE como lo hace la app del teléfono: con la
   clave pública (anon), por REST, en el esquema farmacia. Si esto pasa,
   el teléfono entra.

   1. Las cuentas reales entran con la clave temporal y piden cambiarla
      (solo lectura: a las personas reales no se les cambia nada).
   2. Con una cuenta de prueba ZZZ, el recorrido completo:
        crear con clave A  ->  "re-crear" con clave B (el fallo que había)
        ->  entra con B, NO con A  ->  pide cambiarla
        ->  cambia a C  ->  entra con C, ya no con B, y ya no pide cambio
        ->  clave nueva corta se rechaza.
   3. Un intento con clave equivocada da vacío (no deja pasar).

   La cuenta ZZZ se borra al terminar.

       export SUPABASE_TOKEN=sbp_...
       export FARMACIA_ADMIN_CLAVE=...
       export CLAVE_TEMPORAL=...
       node pruebas/asistencia-claves.mjs
*/
const REF = 'tfbzghjjfcaqmkzsxrrs'
const URL_SB = `https://${REF}.supabase.co`
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmYnpnaGpqZmNhcW1renN4cnJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MjQ1NjQsImV4cCI6MjA5NDUwMDU2NH0.7TPSDGTjCeYu6m-H98tnkt_2v4kUidTdePAUaEZEwXU'
const TOKEN = process.env.SUPABASE_TOKEN
const ADMIN = process.env.FARMACIA_ADMIN_CORREO || 'carlos.linares.es@gmail.com'
const CLAVE_ADMIN = process.env.FARMACIA_ADMIN_CLAVE
const TEMPORAL = process.env.CLAVE_TEMPORAL
if (!TOKEN || !CLAVE_ADMIN || !TEMPORAL) {
  console.error('Faltan SUPABASE_TOKEN, FARMACIA_ADMIN_CLAVE o CLAVE_TEMPORAL.'); process.exit(2)
}

let ok = 0, mal = 0
const fallos = []
const prueba = (n, c, d = '') => {
  if (c) { ok++; console.log('  OK    ' + n) }
  else { mal++; fallos.push(n + '  ' + d); console.log('  FALLA ' + n + '   ' + d) }
}

const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { error: t } }
}

/* Igual que la app: clave anon, esquema farmacia. */
async function rpc(fn, params, jwt) {
  const r = await fetch(`${URL_SB}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON, Authorization: 'Bearer ' + (jwt || ANON),
      'Content-Type': 'application/json', 'Accept-Profile': 'farmacia', 'Content-Profile': 'farmacia',
    },
    body: JSON.stringify(params),
  })
  const t = await r.text()
  let cuerpo; try { cuerpo = JSON.parse(t) } catch { cuerpo = t }
  return { status: r.status, cuerpo }
}

const CEDULA_ZZZ = '9' + String(Date.now()).slice(-7)

try {
  console.log('='.repeat(64))
  console.log('ASISTENCIA: ENTRAR CON LA CLAVE TEMPORAL Y CAMBIARLA')
  console.log('='.repeat(64))

  console.log('\n--- 1. Las cuentas reales entran con la clave temporal (sin cambiarles nada) ---')
  const reales = await sql(`select cedula, nombre from farmacia.asistencia_personal
                            where activo and debe_cambiar_clave and cedula not like '9%' order by nombre;`)
  prueba('hay cuentas reales esperando su primera entrada', reales.length > 0, JSON.stringify(reales.length))
  for (const p of reales) {
    const r = await rpc('asis_login', { p_cedula: p.cedula, p_clave: TEMPORAL })
    const fila = Array.isArray(r.cuerpo) ? r.cuerpo[0] : null
    prueba(`${p.nombre} entra con la clave temporal`, r.status === 200 && !!fila, `${r.status} ${JSON.stringify(r.cuerpo).slice(0, 120)}`)
    prueba(`${p.nombre} tiene que cambiarla al entrar`, fila && fila.debe_cambiar_clave === true)
  }
  const conV = await rpc('asis_login', { p_cedula: 'V-' + reales[0].cedula, p_clave: TEMPORAL })
  prueba('entra también si escriben la cédula con V- y guion', Array.isArray(conV.cuerpo) && conV.cuerpo.length === 1)
  const mala = await rpc('asis_login', { p_cedula: reales[0].cedula, p_clave: TEMPORAL + 'x' })
  prueba('con una clave equivocada NO deja entrar', mala.status === 200 && Array.isArray(mala.cuerpo) && mala.cuerpo.length === 0, JSON.stringify(mala.cuerpo))

  console.log('\n--- 2. Entrar como admin del panel (para crear la cuenta de prueba) ---')
  const auth = await fetch(`${URL_SB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN, password: CLAVE_ADMIN }),
  }).then((r) => r.json())
  const jwt = auth.access_token
  prueba('el admin entra al panel', !!jwt, JSON.stringify(auth).slice(0, 120))

  console.log('\n--- 3. El fallo que había: re-crear a alguien con otra clave ---')
  const c1 = await rpc('asis_admin_crear_personal', {
    p_cedula: CEDULA_ZZZ, p_nombre: 'ZZZ PRUEBA CLAVES', p_telefono: null, p_correo: null, p_clave_inicial: 'claveA111',
  }, jwt)
  prueba('crear la cuenta de prueba con la clave A', c1.status === 200 && c1.cuerpo === true, JSON.stringify(c1))
  const c2 = await rpc('asis_admin_crear_personal', {
    p_cedula: CEDULA_ZZZ, p_nombre: 'ZZZ PRUEBA CLAVES', p_telefono: null, p_correo: null, p_clave_inicial: 'claveB222',
  }, jwt)
  prueba('volver a "crearla" con la clave B', c2.status === 200 && c2.cuerpo === true, JSON.stringify(c2))
  const conB = await rpc('asis_login', { p_cedula: CEDULA_ZZZ, p_clave: 'claveB222' })
  prueba('ahora entra con la clave B (antes seguía con la vieja)', Array.isArray(conB.cuerpo) && conB.cuerpo.length === 1, JSON.stringify(conB.cuerpo))
  const conA = await rpc('asis_login', { p_cedula: CEDULA_ZZZ, p_clave: 'claveA111' })
  prueba('y ya NO entra con la clave A', Array.isArray(conA.cuerpo) && conA.cuerpo.length === 0, JSON.stringify(conA.cuerpo))
  prueba('pide cambiar la clave al entrar', conB.cuerpo[0] && conB.cuerpo[0].debe_cambiar_clave === true)

  console.log('\n--- 4. El cambio obligatorio, como lo hace la app ---')
  const corta = await rpc('asis_cambiar_clave', { p_cedula: CEDULA_ZZZ, p_clave_actual: 'claveB222', p_clave_nueva: '123' })
  prueba('una clave nueva de menos de 6 caracteres se rechaza', corta.status >= 400, JSON.stringify(corta))
  const malActual = await rpc('asis_cambiar_clave', { p_cedula: CEDULA_ZZZ, p_clave_actual: 'noesesta', p_clave_nueva: 'claveC333' })
  prueba('sin la clave actual correcta no deja cambiarla', Array.isArray(malActual.cuerpo) && malActual.cuerpo[0]?.ok === false, JSON.stringify(malActual.cuerpo))
  const cambio = await rpc('asis_cambiar_clave', { p_cedula: CEDULA_ZZZ, p_clave_actual: 'claveB222', p_clave_nueva: 'claveC333' })
  prueba('con la clave actual correcta, la cambia', Array.isArray(cambio.cuerpo) && cambio.cuerpo[0]?.ok === true, JSON.stringify(cambio.cuerpo))
  const conC = await rpc('asis_login', { p_cedula: CEDULA_ZZZ, p_clave: 'claveC333' })
  prueba('entra con la clave nueva', Array.isArray(conC.cuerpo) && conC.cuerpo.length === 1)
  prueba('y ya no le vuelve a pedir cambiarla', conC.cuerpo[0] && conC.cuerpo[0].debe_cambiar_clave === false)
  const conBOtraVez = await rpc('asis_login', { p_cedula: CEDULA_ZZZ, p_clave: 'claveB222' })
  prueba('la clave anterior ya no sirve', Array.isArray(conBOtraVez.cuerpo) && conBOtraVez.cuerpo.length === 0)

  console.log('\n--- 5. Lo que ve el teléfono después de entrar ---')
  const hoy = await rpc('asis_estado_hoy', { p_cedula: CEDULA_ZZZ })
  prueba('puede consultar su estado de hoy (la pantalla que sigue al entrar)', hoy.status === 200, JSON.stringify(hoy).slice(0, 160))
} catch (e) {
  mal++; fallos.push('EXCEPCION: ' + e.message); console.log('\n  EXCEPCION: ' + e.message)
} finally {
  await sql(`delete from farmacia.asistencia_registros where cedula = '${CEDULA_ZZZ}';`)
  await sql(`delete from farmacia.asistencia_personal where cedula = '${CEDULA_ZZZ}';`)
}

console.log('\n--- Limpieza ---')
const quedan = await sql(`select count(*) n from farmacia.asistencia_personal where cedula = '${CEDULA_ZZZ}';`)
prueba('la cuenta de prueba quedó borrada', Number(quedan[0]?.n) === 0, JSON.stringify(quedan))

console.log('\n' + '='.repeat(64))
if (mal) { console.log(`FALLARON ${mal} de ${ok + mal}`); fallos.forEach((f) => console.log('   - ' + f)); process.exit(1) }
else console.log(`Pasaron las ${ok} pruebas.`)
