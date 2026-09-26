from pathlib import Path
import re
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[1]
estilos = re.search(r'<style>(.*?)</style>', (RAIZ/'index.html').read_text(encoding='utf-8'), re.S).group(1)
fuente = (RAIZ/'tablero-entregas.js').read_text(encoding='utf-8').replace(
    'window.TABLERO_ENTREGAS = function', 'window.ClaseTableroPrueba = Tablero; window.TABLERO_ENTREGAS = function')

with sync_playwright() as p:
    navegador = p.chromium.launch(headless=True)
    for rol in ('admin','inventario'):
        pagina = navegador.new_page(viewport={'width':375,'height':800})
        pagina.set_content('<style>'+estilos+'</style><div id="raiz"><div id="prGestion"></div></div>')
        pagina.add_script_tag(content=fuente)
        pagina.evaluate('''rol => {
          window.FARMACIA_PERFIL={rol}; window.llamadas=[];
          window.entrega={id:'entrega',tipo_destinatario:'institucion',institucion_id:'centro',
            fecha:'2026-01-01',origen:'sistema',recibe_nombre:'PERSONA PRUEBA',observacion:'Original'};
          window.FARM={hoyCaracas:()=> '2026-09-26'};
          const resultados={entregas:window.entrega, entrega_detalle:[{lote_id:'lote',cantidad:2}],
            v_existencia_lote:[{lote_id:'lote',producto:'MEDICINA PRUEBA',estado:'disponible',situacion:'vigente',existencia:10}]};
          window.t=Object.create(window.ClaseTableroPrueba.prototype);
          t.raiz=document.querySelector('#raiz'); t.pfx='pr'; t.cargar=()=>{};
          t.sb={from(tabla){const q={select(){return q},eq(){return q},single(){return q},range(){return q},
            then(fn){return Promise.resolve({data:resultados[tabla]||[],error:null}).then(fn)}};return q},
            rpc(nombre,args){window.llamadas.push({nombre,args});return Promise.resolve({data:'nuevo',error:null})}};
        }''', rol)
        pagina.evaluate("t.abrirGestion('entrega')")
        pagina.locator('#prEditFecha').wait_for()
        pagina.locator('#prEditFecha').fill('2026-01-02')
        pagina.locator('#prEditObservacion').fill('Observación corregida')
        pagina.locator('#prEditReceptor').fill('RECEPTOR CORREGIDO')
        pagina.locator('#prEditMotivo').fill('Corrección autorizada de prueba')
        pagina.locator('#prEditGuardar').click()
        pagina.get_by_text('Corrección registrada.').wait_for()
        datos=pagina.evaluate('window.llamadas.at(-1).args.p_datos')
        assert datos['fecha']=='2026-01-02' and datos['recibe_nombre']=='RECEPTOR CORREGIDO'
        assert datos['observacion']=='Observación corregida'

        pagina.evaluate("t.gestionHistorica({...window.entrega,origen:'migracion_excel'})")
        assert pagina.evaluate('document.documentElement.scrollWidth <= innerWidth')
        pagina.locator('#prHistTexto').fill('Medicamento histórico corregido')
        pagina.locator('#prHistMotivo').fill('Corrección del cuaderno de prueba')
        pagina.locator('#prHistGuardar').click()
        pagina.get_by_text('Entrega histórica corregida.').wait_for()
        assert pagina.evaluate('window.llamadas.at(-1).nombre')=='entrega_historica_corregir'
        pagina.evaluate("t.gestionHistorica({...window.entrega,origen:'migracion_excel'})")
        pagina.locator('#prHistMotivo').fill('Anulación de registro duplicado')
        pagina.locator('#prHistAnular').click()
        pagina.get_by_text('Entrega histórica anulada.').wait_for()
        assert pagina.evaluate('window.llamadas.at(-1).nombre')=='entrega_anular'
        pagina.close()
    navegador.close()
print('Interfaz de entregas verificada para Administración e Inventario a 375 px.')
