/* ===================================================================
   PRUEBA DE PUNTA A PUNTA — Control de asistencia (Dirección de Salud)
   Farmacia / Asistencia — Alcaldía de Cristóbal Rojas

   Junta en un solo archivo las tres pruebas que antes vivían sueltas en
   la carpeta temporal de la sesión y se perdían al cerrar:

     1. El selector Farmacia / Asistencia de la barra azul, en claro, en
        oscuro y en teléfono.
     2. Los candados del control de asistencia, contra la base de verdad.
     3. Entrar con cédula, tal como lo hace la aplicación del teléfono.

   Se corre así, sin instalar nada de pruebas:

       node pruebas/e2e-asistencia.mjs

   ESTA PRUEBA NO ESCRIBE NADA
   ---------------------------
   Ni una fila, ni un marcaje, ni una cuenta. Solo llama a las funciones
   que calculan sin guardar (asis_donde_estoy, asis_sedes_activas) y a
   asis_login con una cédula inventada que no existe. Por eso se puede
   correr contra producción con toda tranquilidad y no hace falta ningún
   PERMITIR_ESCRIBIR: no hay nada que permitir.

   A propósito NO se prueban asis_marcar_entrada ni asis_marcar_salida:
   esas sí escriben, y meterían un marcaje falso en el historial de una
   persona real. Eso se prueba a mano, con el teléfono, una sola vez.

   VARIABLES DE ENTORNO (todas opcionales):

       PUBLICADO=si      prueba el sitio publicado en vez de esta carpeta.
       BASE=http://...   dirección exacta a probar (manda sobre PUBLICADO).
       CEDULA_PRUEBA=... si la pones (junto con CLAVE_PRUEBA), además se
       CLAVE_PRUEBA=...  comprueba que esa persona SÍ entra. Se leen del
                         entorno a propósito: en este repositorio, que es
                         público, no puede quedar escrita ni una clave.
       CHROME=...        ruta de chrome.exe si no está donde siempre.

   Por omisión se sirve ESTA carpeta en 127.0.0.1, que es lo que hay que
   probar: el código que se acaba de tocar, antes de publicarlo.
=================================================================== */

import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------
   Marcador y contadores, al estilo de pruebas/unitarias.mjs
------------------------------------------------------------------ */
let ok = 0, mal = 0, saltadas = 0;
const fallos = [];

function prueba(nombre, real, esperado) {
    const iguales = JSON.stringify(real) === JSON.stringify(esperado);
    if (iguales) { ok++; console.log('   ✓ ' + nombre); }
    else {
        mal++;
        fallos.push(`${nombre}\n      esperaba: ${JSON.stringify(esperado)}\n      dio:      ${JSON.stringify(real)}`);
        console.log('   ✗ ' + nombre);
    }
}
function grupo(t) { console.log('\n' + t); }
function saltar(t) { saltadas++; console.log('   · (saltada) ' + t); }

/* ------------------------------------------------------------------
   Configuración
------------------------------------------------------------------ */
const CARPETA = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SITIO_PUBLICADO = 'https://salud.alcaldiadecharallave.com';
const CEDULA_INVENTADA = '12345678';          // no existe y no es de nadie

const RUTAS_CHROME = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Users/' + os.userInfo().username + '/AppData/Local/Google/Chrome/Application/chrome.exe'
].filter(Boolean);

/* La dirección y la clave pública de Supabase salen de config.js, que ya
   está en el repositorio: la clave anónima es pública por diseño. Aquí no
   se escribe ninguna credencial. */
const CONFIG = fs.readFileSync(path.join(CARPETA, 'config.js'), 'utf-8');
const SUPABASE = (CONFIG.match(/SUPABASE_URL:\s*'([^']+)'/) || [])[1];
const CLAVE_PUBLICA = (CONFIG.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/) || [])[1];

async function rpc(nombre, argumentos) {
    const r = await fetch(`${SUPABASE}/rest/v1/rpc/${nombre}`, {
        method: 'POST',
        headers: {
            apikey: CLAVE_PUBLICA, Authorization: 'Bearer ' + CLAVE_PUBLICA,
            'Content-Type': 'application/json',
            'Accept-Profile': 'farmacia', 'Content-Profile': 'farmacia'
        },
        body: JSON.stringify(argumentos)
    });
    const texto = await r.text();
    let cuerpo; try { cuerpo = JSON.parse(texto); } catch (e) { cuerpo = texto; }
    return { estado: r.status, cuerpo };
}
const primeraFila = (r) => Array.isArray(r.cuerpo) ? (r.cuerpo[0] || null) : r.cuerpo;

/* Mueve un punto tantos metros al norte, para simular a alguien parado
   lejos sin tener que salir a la calle con el teléfono. */
function moverMetros(punto, metros) {
    return { lat: punto.lat + (metros / 111320), lng: punto.lng };
}

/* ------------------------------------------------------------------
   Servidor estático mínimo, para probar la carpeta tal como está
------------------------------------------------------------------ */
const TIPOS = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8'
};
function servirCarpeta(raiz) {
    return new Promise((resolver) => {
        const servidor = http.createServer((pet, res) => {
            if (pet.url.split('?')[0] === '/favicon.ico') { res.writeHead(204).end(); return; }
            const rel = decodeURIComponent(pet.url.split('?')[0]).replace(/^\//, '') || 'index.html';
            const abs = path.resolve(raiz, rel);
            if (!abs.startsWith(path.resolve(raiz))) { res.writeHead(403).end(); return; }
            fs.readFile(abs, (e, datos) => {
                if (e) { res.writeHead(404).end('no está'); return; }
                res.writeHead(200, { 'Content-Type': TIPOS[path.extname(abs)] || 'application/octet-stream' });
                res.end(datos);
            });
        });
        servidor.listen(0, '127.0.0.1', () => resolver(servidor));
    });
}

async function cargarPuppeteer() {
    try { return (await import('puppeteer-core')).default; }
    catch (e) {
        console.log('\nNo encontré puppeteer-core. Instálalo con:');
        console.log('    npm i -g puppeteer-core      (o  npm i puppeteer-core  en esta carpeta)');
        console.log('Detalle:', e.message);
        process.exit(2);
    }
}
function buscarChrome() {
    for (const r of RUTAS_CHROME) { try { if (fs.existsSync(r)) return r; } catch (e) { /* sigue */ } }
    console.log('\nNo encontré chrome.exe. Indícalo con  CHROME="ruta/a/chrome.exe"');
    process.exit(2);
}

/* ==================================================================
   AQUÍ EMPIEZA LA PRUEBA
================================================================== */
console.log('='.repeat(64));
console.log('PRUEBA DE PUNTA A PUNTA — control de asistencia');
console.log('='.repeat(64));

let servidor = null, navegador = null, perfil = null;

try {
    if (!SUPABASE || !CLAVE_PUBLICA) {
        console.log('\nNo pude leer SUPABASE_URL / SUPABASE_ANON_KEY de config.js. Prueba abortada.');
        process.exit(2);
    }

    let direccion;
    if (process.env.BASE) direccion = process.env.BASE.replace(/\/$/, '') + '/index.html';
    else if (process.env.PUBLICADO === 'si') direccion = SITIO_PUBLICADO + '/index.html';
    else {
        servidor = await servirCarpeta(CARPETA);
        direccion = 'http://127.0.0.1:' + servidor.address().port + '/index.html';
    }

    console.log('\nQué voy a hacer:');
    console.log('  · pantalla a mirar   : ' + direccion);
    console.log('  · base de datos      : ' + SUPABASE + ' (esquema farmacia)');
    console.log('  · escribe algo       : NO. Ni un marcaje, ni una fila, ni una cuenta.');
    console.log('  · cédula que uso     : ' + CEDULA_INVENTADA + ' (inventada, no es de nadie)');
    console.log('  · login de verdad    : ' + (process.env.CEDULA_PRUEBA
        ? 'sí, con la cédula que pasaste por CEDULA_PRUEBA'
        : 'no (pon CEDULA_PRUEBA y CLAVE_PRUEBA si lo quieres)'));

    /* ==============================================================
       1) EL SELECTOR FARMACIA / ASISTENCIA
       Existe porque el selector es la ÚNICA puerta al control de
       asistencia. Si se rompe, el módulo entero queda inalcanzable
       aunque esté perfecto por dentro, y en la barra azul un botón
       que se sale de la pantalla en un teléfono no se puede tocar.
    ============================================================== */
    const puppeteer = await cargarPuppeteer();
    perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-pruebas-'));
    navegador = await puppeteer.launch({
        executablePath: buscarChrome(),
        headless: 'new',
        args: ['--no-sandbox', '--user-data-dir=' + perfil]
    });

    const erroresPagina = [];
    /* Aquí se apunta cada consulta que la base RECHAZÓ por falta de
       sesión. No son errores de la página: son la prueba de que el
       candado está puesto. Esta prueba enciende el panel a mano, sin
       entrar con una cuenta, así que la base TIENE que decir que no. */
    const rechazadasPorLaBase = new Set();

    async function mirarSelector(tema, ancho, alto, nombre) {
        grupo(`El selector Farmacia / Asistencia — ${nombre} (${ancho} px, tema ${tema})`);
        const pag = await navegador.newPage();
        pag.on('pageerror', e => erroresPagina.push(`[${nombre}] ERROR DE PÁGINA: ` + e.message));
        pag.on('response', r => {
            if ((r.status() === 401 || r.status() === 403) && r.url().includes('/rest/v1/')) {
                rechazadasPorLaBase.add(r.url());
            }
        });
        pag.on('console', m => {
            const donde = (m.location() && m.location().url) || '';
            if (m.type() !== 'error') return;
            if (/favicon\.ico/.test(donde) || /net::ERR_/.test(m.text())) return;
            if (rechazadasPorLaBase.has(donde)) return;   // rechazo esperado, se mide aparte
            erroresPagina.push(`[${nombre}] CONSOLA: ` + m.text() + (donde ? '  [' + donde + ']' : ''));
        });
        await pag.setViewport({ width: ancho, height: alto, deviceScaleFactor: 2 });
        await pag.goto(direccion, { waitUntil: 'networkidle0', timeout: 45000 });
        await pag.evaluate(t => document.documentElement.setAttribute('data-theme', t), tema);

        /* Se enciende a mano lo que normalmente enciende el login del
           administrador. Así se mira la barra sin entrar con una cuenta
           real ni tocar la base. */
        const info = await pag.evaluate(() => {
            document.getElementById('vistaAcceso').hidden = true;
            document.getElementById('vistaPanel').hidden = false;
            document.getElementById('selectorSistema').hidden = false;
            const chip = document.getElementById('chipUsuario');
            chip.textContent = 'Administrador · prueba'; chip.hidden = false;
            document.getElementById('btnSalir').hidden = false;
            return {
                hayPantallaAsistencia: typeof window.PANTALLA_ASISTENCIA === 'function',
                sistemas: [...document.querySelectorAll('#selectorSistema [data-sistema]')].map(b => b.dataset.sistema),
                botonesBajitos: [...document.querySelectorAll('#selectorSistema [data-sistema]')]
                    .filter(b => b.getBoundingClientRect().height < 32).map(b => b.dataset.sistema)
            };
        });
        await new Promise(r => setTimeout(r, 250));

        const barra = await pag.evaluate(() => {
            const s = document.getElementById('selectorSistema');
            const r = s.getBoundingClientRect();
            return {
                visible: r.width > 0 && r.height > 0,
                seSale: r.right > window.innerWidth + 1 || r.left < -1,
                scrollHorizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
            };
        });

        prueba('está cargado el módulo de asistencia', info.hayPantallaAsistencia, true);
        prueba('hay dos sistemas para elegir', info.sistemas, ['farmacia', 'asistencia']);
        prueba('los dos botones se pueden tocar (≥32 px)', info.botonesBajitos, []);
        prueba('el selector se ve', barra.visible, true);
        prueba('el selector no se sale de la pantalla', barra.seSale, false);
        prueba('no hay scroll horizontal', barra.scrollHorizontal, false);

        /* Cambiar de sistema y comprobar que de verdad cambia. */
        await pag.click('#selectorSistema [data-sistema="asistencia"]');
        await new Promise(r => setTimeout(r, 1500));
        const tras = await pag.evaluate(() => ({
            farmaciaOculta: document.getElementById('vistaPanel').hidden,
            asistenciaVisible: !document.getElementById('vistaAsistencia').hidden,
            activo: (document.querySelector('#selectorSistema .on') || {}).dataset?.sistema,
            algoPintado: (document.getElementById('contenidoAsistencia').innerText || '').trim().length > 0
        }));
        prueba('al tocar Asistencia, la farmacia se esconde', tras.farmaciaOculta, true);
        prueba('aparece la pantalla de asistencia', tras.asistenciaVisible, true);
        prueba('el botón activo pasa a Asistencia', tras.activo, 'asistencia');
        prueba('la pantalla de asistencia pinta algo', tras.algoPintado, true);

        await pag.click('#selectorSistema [data-sistema="farmacia"]');
        await new Promise(r => setTimeout(r, 600));
        const vuelta = await pag.evaluate(() => ({
            farmaciaVisible: !document.getElementById('vistaPanel').hidden,
            asistenciaOculta: document.getElementById('vistaAsistencia').hidden
        }));
        prueba('y se puede volver a Farmacia', vuelta, { farmaciaVisible: true, asistenciaOculta: true });

        await pag.close();
    }

    await mirarSelector('light', 1280, 900, 'computadora en claro');
    await mirarSelector('dark', 1280, 900, 'computadora en oscuro');
    await mirarSelector('light', 375, 800, 'teléfono');

    grupo('Errores sueltos de la página');
    prueba('ninguna de las tres pantallas soltó errores', erroresPagina, []);

    /* Al encender el panel a mano, sin entrar con una cuenta, la base
       tiene que negarse a soltar los datos. Si algún día esto dejara de
       pasar, sería que alguien abrió las tablas y cualquiera con la
       clave pública podría bajarse el personal y sus marcajes. */
    prueba('sin sesión de verdad, la base niega los datos del panel',
        rechazadasPorLaBase.size > 0, true);
    if (rechazadasPorLaBase.size) {
        console.log('   (rechazó ' + rechazadasPorLaBase.size + ' consultas, como debe ser)');
    }

    /* ==============================================================
       2) LOS CANDADOS DEL CONTROL DE ASISTENCIA
       Todo esto se calcula EN LA BASE a propósito: si el candado
       viviera en el teléfono, bastaría con abrir la aplicación con
       otro programa para marcar desde la casa. Estas pruebas
       comprueban que el candado del servidor sigue puesto.
    ============================================================== */
    grupo('¿Están instaladas las funciones de asistencia?');
    const vivo = await rpc('asis_donde_estoy', { p_lat: 10, p_lng: -66, p_precision: 8 });
    const noInstalado = vivo.estado === 404 || (vivo.cuerpo && vivo.cuerpo.code === 'PGRST202');
    if (noInstalado) {
        console.log('\n   TODAVÍA NO. Hay que pegar sql/25-asistencia.sql en Supabase primero.');
        console.log('   La base contestó: ' + JSON.stringify(vivo.cuerpo).slice(0, 200));
        console.log('\n   Paro aquí: sin las funciones no hay nada que comprobar.');
        process.exit(2);
    }
    prueba('asis_donde_estoy contesta', vivo.estado, 200);

    grupo('La sede contra la que se mide');
    const sedes = await rpc('asis_sedes_activas', {});
    const sede = primeraFila(sedes);
    prueba('hay una sede activa cargada', !!sede, true);

    if (!sede) {
        saltar('todo el candado de distancia (no hay sede activa contra la que medir)');
    } else {
        const puerta = { lat: Number(sede.latitud), lng: Number(sede.longitud) };
        const radio = Number(sede.radio_metros);
        console.log('   sede: ' + sede.nombre + ' · radio ' + radio + ' m');

        /* Los casos NO llevan números mágicos: se arman a partir del radio
           que declara la propia sede, para que sigan valiendo si mañana
           alguien cambia el radio en la configuración. */
        grupo('El candado de la distancia');

        const enLaPuerta = primeraFila(await rpc('asis_donde_estoy',
            { p_lat: puerta.lat, p_lng: puerta.lng, p_precision: 8 }));
        prueba('parado en la puerta con buen GPS: puede marcar', enLaPuerta.puede, true);
        prueba('y la distancia que reporta es casi cero', Math.round(enLaPuerta.distancia) <= 2, true);
        prueba('dice contra qué sede midió', enLaPuerta.sede_nombre, sede.nombre);

        const dentro = moverMetros(puerta, Math.max(1, Math.floor(radio / 2)));
        const rDentro = primeraFila(await rpc('asis_donde_estoy',
            { p_lat: dentro.lat, p_lng: dentro.lng, p_precision: 8 }));
        prueba('a media distancia del radio: puede marcar', rDentro.puede, true);

        /* El cálculo de metros tiene que dar lo que se movió, o el mensaje
           "estás a X metros" engaña a la gente. Se permite un 5 % de error
           por el redondeo de la fórmula. */
        const objetivo = Math.max(1, Math.floor(radio / 2));
        prueba('la distancia calculada coincide con lo que me moví',
            Math.abs(rDentro.distancia - objetivo) <= Math.max(3, objetivo * 0.05), true);

        const lejos = moverMetros(puerta, radio + 1000);
        const rLejos = primeraFila(await rpc('asis_donde_estoy',
            { p_lat: lejos.lat, p_lng: lejos.lng, p_precision: 10 }));
        prueba('a un kilómetro de más del radio: NO puede marcar', rLejos.puede, false);
        prueba('y explica por qué, con los metros', /metros/i.test(String(rLejos.motivo || '')), true);

        const muyLejos = moverMetros(puerta, 5000);
        const rMuyLejos = primeraFila(await rpc('asis_donde_estoy',
            { p_lat: muyLejos.lat, p_lng: muyLejos.lng, p_precision: 10 }));
        prueba('desde su casa, a 5 km: NO puede marcar', rMuyLejos.puede, false);

        /* Invariante sin números mágicos: si a una distancia dice que no,
           al doble tiene que seguir diciendo que no. Si alguna vez esto
           se rompe, es que la fórmula se volvió loca. */
        prueba('si no puede a una distancia, tampoco al doble',
            (rLejos.puede === false && rMuyLejos.puede === false), true);

        /* Un GPS que se equivoca por cientos de metros no prueba nada:
           con él, cualquiera "está en la puerta" desde su casa. */
        const impreciso = primeraFila(await rpc('asis_donde_estoy',
            { p_lat: puerta.lat, p_lng: puerta.lng, p_precision: 5000 }));
        prueba('en la puerta pero con ±5 km de error: NO puede marcar', impreciso.puede, false);
    }

    grupo('Sin ubicación no se marca');
    const sinGps = primeraFila(await rpc('asis_donde_estoy',
        { p_lat: null, p_lng: null, p_precision: null }));
    prueba('sin coordenadas: NO puede marcar', sinGps.puede, false);
    prueba('y lo explica', String(sinGps.motivo || '').length > 0, true);

    /* ==============================================================
       3) ENTRAR CON CÉDULA, COMO LA APLICACIÓN DEL TELÉFONO
       La aplicación no usa el login de Supabase: entra por asis_login
       con cédula y clave. Si esa función dejara pasar a cualquiera, el
       control de asistencia entero no valdría nada.
    ============================================================== */
    grupo('Entrar con cédula, como la aplicación');
    const inventada = await rpc('asis_login', { p_cedula: CEDULA_INVENTADA, p_clave: 'loquesea' });
    prueba('una cédula que no existe NO entra',
        Array.isArray(inventada.cuerpo) && inventada.cuerpo.length === 0, true);

    if (process.env.CEDULA_PRUEBA && process.env.CLAVE_PRUEBA) {
        const buena = await rpc('asis_login',
            { p_cedula: process.env.CEDULA_PRUEBA, p_clave: process.env.CLAVE_PRUEBA });
        const fila = primeraFila(buena);
        prueba('con la clave correcta SÍ entra', !!(fila && fila.cedula), true);
        if (fila) console.log('   entró: ' + fila.nombre + ' · debe cambiar la clave: ' + fila.debe_cambiar_clave);

        const mala = await rpc('asis_login',
            { p_cedula: process.env.CEDULA_PRUEBA, p_clave: 'ESTA-CLAVE-NO-ES-' + Date.now() });
        prueba('con la clave equivocada NO entra',
            Array.isArray(mala.cuerpo) && mala.cuerpo.length === 0, true);
    } else {
        saltar('entrar con una cédula de verdad (pon CEDULA_PRUEBA y CLAVE_PRUEBA)');
        saltar('rechazar la clave equivocada de esa misma cédula');
    }

    /* ==============================================================
       4) LAS TABLAS SIGUEN CERRADAS A LA CLAVE PÚBLICA
       La clave anónima está a la vista de cualquiera dentro de la
       página. Si una de estas tablas se abriera, cualquiera podría
       bajarse el listado del personal con sus claves y sus horarios.
    ============================================================== */
    grupo('Las tablas siguen cerradas a la clave pública');
    for (const tabla of ['asistencia_personal', 'asistencia_registros', 'sedes', 'config_asistencia']) {
        const r = await fetch(`${SUPABASE}/rest/v1/${tabla}?select=*&limit=1`, {
            headers: { apikey: CLAVE_PUBLICA, Authorization: 'Bearer ' + CLAVE_PUBLICA, 'Accept-Profile': 'farmacia' }
        });
        const texto = await r.text();
        const cerrada = r.status === 401 || r.status === 403 || texto.trim() === '[]';
        prueba(`la tabla ${tabla} no se puede leer con la clave pública`, cerrada, true);
        if (!cerrada) console.log('      contestó ' + r.status + ': ' + texto.slice(0, 120));
    }

} catch (e) {
    mal++;
    fallos.push('LA PRUEBA SE CAYÓ A MITAD\n      ' + (e && e.stack ? e.stack : e));
    console.log('\n   ✗ la prueba se cayó: ' + (e && e.message ? e.message : e));
} finally {
    /* Todo lo que se abrió se cierra, aunque la prueba haya reventado
       antes de tiempo. Escribir no escribió nada, así que no hay nada
       más que deshacer. */
    try { if (navegador) await navegador.close(); } catch (e) { /* ya estaba cerrado */ }
    try { if (servidor) servidor.close(); } catch (e) { /* ya estaba cerrado */ }
    try { if (perfil) fs.rmSync(perfil, { recursive: true, force: true }); } catch (e) { /* ya no está */ }

    console.log('\n' + '='.repeat(64));
    if (mal) {
        console.log(`FALLARON ${mal} de ${ok + mal}` + (saltadas ? `  (${saltadas} saltadas)` : '') + '\n');
        fallos.forEach(f => console.log('   ✗ ' + f));
        process.exit(1);
    } else {
        console.log(`Pasaron las ${ok} pruebas.` + (saltadas ? `  (${saltadas} saltadas a propósito)` : ''));
        process.exit(0);
    }
}
