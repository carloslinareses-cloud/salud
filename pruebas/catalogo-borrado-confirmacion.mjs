/* Compruebo que un DELETE bloqueado por RLS no se anuncie como borrado. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const fuente = fs.readFileSync(new URL('../inventario.js', import.meta.url), 'utf8');
const manejadores = fuente.slice(fuente.indexOf('  function borrarLote('), fuente.indexOf('  /* ---------- sumar a un lote'));
const errores = fuente.slice(fuente.indexOf('  function enCristiano('), fuente.indexOf('  function sit('));
const permisos = fuente.slice(fuente.indexOf('  function puedeBorrarCatalogo('), fuente.indexOf('  /* Los errores de la base'));

async function probar(tipo, respuesta) {
  const avisos = [], consultas = [], detalle = { innerHTML: 'Ficha existente' };
  let recargas = 0;
  const cadena = {
    delete() { consultas.push('delete'); return this; },
    eq(campo, id) { consultas.push([campo, id]); return this; },
    select(campos) { consultas.push(['select', campos]); return this; },
    then(fn) { return Promise.resolve(respuesta).then(fn); }
  };
  const contexto = vm.createContext({
    window: { confirm: () => true, FARMACIA_PERFIL: { rol: 'inventario' } },
    sb: { from: tabla => { consultas.push(tabla); return cadena; } },
    aviso: (tipo, texto) => avisos.push({ tipo, texto }),
    document: { getElementById: () => detalle }, cat: {},
    cargarCatalogo: () => recargas++, verProducto: () => recargas++
  });
  vm.runInContext(errores + permisos + manejadores, contexto);
  if (tipo === 'producto') contexto.borrarProducto({ producto_id: 'producto-prueba', producto: 'PRUEBA' }, []);
  else contexto.borrarLote({ producto: 'PRUEBA' }, { lote_id: 'lote-prueba', lote: 'PRUEBA', existencia: 0 });
  await new Promise(resolve => setImmediate(resolve));
  return { avisos, consultas, recargas, detalle };
}

for (const tipo of ['producto', 'lote']) {
  const bloqueado = await probar(tipo, { data: [], error: null });
  assert.equal(bloqueado.avisos[0].tipo, 'bad', tipo + ': cero filas no significa borrado');
  assert.equal(bloqueado.recargas, 0);
  assert.equal(bloqueado.detalle.innerHTML, 'Ficha existente');
  const borrado = await probar(tipo, { data: [{ id: 'prueba' }], error: null });
  assert.equal(borrado.avisos[0].tipo, 'ok');
  assert.equal(borrado.recargas, 1);
  assert.ok(borrado.consultas.some(x => Array.isArray(x) && x[0] === 'select' && x[1] === 'id'));
  const fallo = await probar(tipo, { data: null, error: { message: 'Fallo del servidor' } });
  assert.equal(fallo.avisos[0].tipo, 'bad');
}
const roles = vm.createContext({ window: {} });
vm.runInContext(permisos, roles);
for (const [rol, esperado] of [['admin', true], ['inventario', true], ['despacho', false]]) {
  roles.window.FARMACIA_PERFIL = { rol };
  assert.equal(roles.puedeBorrarCatalogo(), esperado);
}
console.log('Borrado confirmado, bloqueos y permisos: todas las comprobaciones correctas.');
