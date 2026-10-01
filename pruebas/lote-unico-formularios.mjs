/* Ejecuto los dos manejadores reales: un repetido no crea ni suma existencias. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const fuente = fs.readFileSync(new URL('../inventario.js', import.meta.url), 'utf8');
const rapido = fuente.slice(fuente.indexOf('  function guardarRapido('), fuente.indexOf('  /* ================================================================', fuente.indexOf('  function guardarRapido(')));
const ficha = fuente.slice(fuente.indexOf('  function formLoteNuevo('), fuente.indexOf('  /* ---------- cuánto llegó'));

async function ejecutar(modo, disponible, colision = false, codigo = 'LOTE-PRUEBA') {
  const escrituras = [], avisos = [], eventos = {};
  const valores = { rInsumo: 'MEDICAMENTO PRUEBA', rPres: '', rLote: codigo, rVence: '2030-01-01', rCant: '5', lCodigo: codigo, lVence: '2031-01-01' };
  const nodos = {};
  const nodo = id => nodos[id] ||= { value: valores[id] || '', innerHTML: '', disabled: false, textContent: '', focus() {}, addEventListener(e, fn) { eventos[id + ':' + e] = fn; } };
  function consulta(tabla) {
    const q = {
      select() { return q; }, ilike() { return q; },
      limit() { return Promise.resolve({ data: [{ id: 'p1', nombre: 'PRUEBA' }] }); },
      insert(d) { escrituras.push({ tabla, datos: d }); return q; },
      single() { return Promise.resolve(colision && tabla === 'lotes' ? { error: { code: '23505', message: 'Ese lote ya está registrado en el inventario.' } } : { data: { id: 'l1' } }); },
      then(fn) { return Promise.resolve({ error: null }).then(fn); }
    };
    return q;
  }
  const c = vm.createContext({
    document: { getElementById: nodo }, window: { confirm: () => true, scrollTo() {} },
    sb: { rpc() { return Promise.resolve({ data: disponible }); }, from: consulta },
    aviso: (tipo, texto) => avisos.push({ tipo, texto }), num: String, ultimo: null,
    verCargar() {}, verProducto() {}, cuantoLlego: () => '', engancharCuanto() {}, unidadesEscritas: () => 5
  });
  vm.runInContext(rapido + ficha, c);
  if (modo === 'rapido') c.guardarRapido();
  else { c.formLoteNuevo({ producto_id: 'p1', producto: 'PRUEBA' }, []); eventos['lGuardar:click'].call(nodo('lGuardar')); }
  await new Promise(r => setImmediate(r));
  return { escrituras, avisos };
}
for (const modo of ['rapido', 'ficha']) {
  const repetido = await ejecutar(modo, false);
  assert.equal(repetido.escrituras.length, 0, modo + ': el lote repetido no escribe');
  assert.equal(repetido.avisos.at(-1).tipo, 'bad');
  const vacio = await ejecutar(modo, true, false, '');
  assert.equal(vacio.escrituras.length, 0);
  assert.equal(vacio.avisos.at(-1).tipo, 'warn');
  const nuevo = await ejecutar(modo, true);
  assert.deepEqual(nuevo.escrituras.map(x => x.tabla), ['lotes', 'movimientos']);
  assert.equal(nuevo.avisos.at(-1).tipo, 'ok');
  const carrera = await ejecutar(modo, true, true);
  assert.ok(!carrera.escrituras.some(x => x.tabla === 'movimientos'));
  assert.equal(carrera.avisos.at(-1).tipo, 'bad');
}
console.log('Ambos formularios: lote nuevo, repetido, vacío y colisión al guardar correctos.');
