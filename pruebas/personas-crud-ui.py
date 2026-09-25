from pathlib import Path
import re
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[1]
PACIENTE = {
    'id': '11111111-1111-1111-1111-111111111111',
    'nombre': 'ANA PRUEBA PERSONAS', 'nacionalidad': 'V', 'cedula': '12345678',
    'cedula_cruda': '12345678', 'sexo': 'F', 'fecha_nac': '1980-01-01',
    'telefono': '', 'direccion': '', 'estado': 'activo', 'medicamentos': 1,
    'entregas': 1, 'ultima_entrega': None, 'patologias': '', 'n_patologias': 0,
    'fallecido': False, 'estado_vital_observacion': None
}
ESTILOS = re.search(r'<style>(.*?)</style>', (RAIZ / 'index.html').read_text(encoding='utf-8'), re.S).group(1)

def iniciar(page, rol, puede_eliminar=True):
    page.set_content('<style>' + ESTILOS + '</style><div id="raiz"></div>')
    page.evaluate('''(datos) => {
      window.FARMACIA_PERFIL = { rol: datos.rol };
      window.FARM = {
        sinAcentos: x => x, agrupaEntregas: () => [],
        horaCaracas: () => '', hoyCaracas: () => '2026-09-25'
      };
      window.FARMPICK = { caja: () => '' };
      window.estadoPrueba = { activo: true, puedeEliminar: datos.puede, llamadas: [] };
      window.pacientePrueba = datos.paciente;
      window.sbPrueba = {
        from(tabla) {
          const consulta = { tabla, head: false, filtros: [],
            select(_c, o) { this.head = !!(o && o.head); return this; },
            eq(c, v) { this.filtros.push([c,v]); return this; },
            order() { return this; }, range() { return this; }, or() { return this; },
            limit() { return this; }, maybeSingle() { this.uno = true; return this; },
            single() { this.uno = true; return this; },
            then(fn) {
              let data = [];
              if (this.tabla === 'v_pacientes_estado' || this.tabla === 'v_pacientes_ficha')
                data = window.estadoPrueba.activo ? [window.pacientePrueba] : [];
              if (this.tabla === 'pacientes')
                data = window.estadoPrueba.activo ? [] : [{...window.pacientePrueba,
                  estado:'inactivo', retirada_motivo:'Datos equivocados'}];
              if (this.tabla === 'v_alertas_retiro') data = [];
              const r = { data: this.uno ? (data[0] || null) : data,
                count: data.length, error: null };
              if (this.head) { r.data = null; r.count = 0; }
              return Promise.resolve(r).then(fn);
            }
          };
          return consulta;
        },
        rpc(nombre, args) {
          window.estadoPrueba.llamadas.push({nombre, args});
          if (nombre === 'persona_resumen_retiro') return Promise.resolve({data:{
            entregas:1, tratamientos:1, patologias:0, solicitudes:0,
            alertas_resueltas:0, movimientos:window.estadoPrueba.puedeEliminar ? 0 : 1,
            detalles:window.estadoPrueba.puedeEliminar ? 0 : 1,
            puede_eliminar:window.estadoPrueba.puedeEliminar }, error:null});
          if (nombre === 'persona_retirar') window.estadoPrueba.activo = false;
          if (nombre === 'persona_reactivar') window.estadoPrueba.activo = true;
          return Promise.resolve({data:{}, error:null});
        }
      };
    }''', {'rol': rol, 'puede': puede_eliminar, 'paciente': PACIENTE})
    page.add_script_tag(path=str(RAIZ / 'personas.js'))
    page.evaluate("window.PANTALLA_PERSONAS(window.sbPrueba, document.querySelector('#raiz'))")
    page.locator('[data-p="0"]').wait_for()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for rol in ('inventario', 'admin'):
        page = browser.new_page(viewport={'width':375,'height':800})
        errores = []
        page.on('pageerror', lambda e: errores.append(str(e)))
        iniciar(page, rol)
        page.locator('[data-p="0"]').click()
        page.locator('#peRetiroAbrir').click()
        page.locator('#peRetiroEliminar').wait_for()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        page.locator('#peRetiroEliminar').click()
        assert page.evaluate("window.estadoPrueba.llamadas.at(-1).nombre") == 'persona_resumen_retiro'
        page.locator('#peRetiroMotivo').fill('Datos incorrectos para nueva carga')
        page.locator('#peRetiroNombre').fill('ANA PRUEBA PERSONAS')
        page.locator('#peRetiroEliminar').click()
        page.get_by_text('La ficha y sus registros ligados se eliminaron.').wait_for()
        assert page.evaluate("window.estadoPrueba.llamadas.at(-1).args.p_accion") == 'eliminar'
        assert not errores, errores
        page.close()

    page = browser.new_page(viewport={'width':375,'height':800})
    iniciar(page, 'inventario', False)
    page.locator('[data-p="0"]').click()
    page.locator('#peRetiroAbrir').click()
    page.locator('#peRetiroDesactivar').wait_for()
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    assert page.locator('#peRetiroEliminar').count() == 0
    page.locator('#peRetiroMotivo').fill('Datos incorrectos con entrega real')
    page.locator('#peRetiroNombre').fill('ANA PRUEBA PERSONAS')
    page.locator('#peRetiroDesactivar').click()
    page.get_by_text('La ficha se retiró de la lista activa.').wait_for()
    page.locator('#peRetiradas').click()
    page.locator('[data-reactivar="0"]').wait_for()
    page.on('dialog', lambda dialog: dialog.accept('Ficha corregida para volver al listado'))
    page.locator('[data-reactivar="0"]').click()
    page.get_by_text('La persona volvió a la lista activa.').wait_for()
    assert page.evaluate("window.estadoPrueba.llamadas.at(-1).nombre") == 'persona_reactivar'
    page.close()

    page = browser.new_page()
    iniciar(page, 'despacho')
    assert page.locator('#peRetiradas').count() == 0
    page.locator('[data-p="0"]').click()
    assert page.locator('#peRetiroAbrir').count() == 0
    page.close()
    browser.close()
print('Interfaz verificada: Inventario y Administración eliminan, historial protegido desactiva y Despacho no ve el control.')
