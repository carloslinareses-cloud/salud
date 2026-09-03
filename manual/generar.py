# -*- coding: utf-8 -*-
"""Arma el manual en HTML con las capturas incrustadas.

Para rehacerlo cuando la aplicación cambie:
  1. Volver a tomar las capturas.
  2. python manual/generar.py
  3. Exportar a PDF con Chrome.
"""
import io, base64, os, sys

IMG = os.environ.get('CAPTURAS',
    'C:/Users/carlo/AppData/Local/Temp/claude/c--Users-carlo-Documents-alcaldia-admin/'
    '84a168aa-ff1e-4055-a2ad-be2bb472ef53/scratchpad/capturas/img/opt/')

def fig(archivo, pie):
    with open(IMG + archivo, 'rb') as f:
        d = 'data:image/jpeg;base64,' + base64.b64encode(f.read()).decode()
    return ('<figure><img src="' + d + '" alt="' + pie + '">'
            '<figcaption>' + pie + '</figcaption></figure>')

ESTILO = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Manual de la Farmacia Municipal</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@500;600;700&family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
@page { size: Letter; margin: 16mm 15mm; }
:root{
  --navy:#0a2351; --navy2:#1a4f8a; --gold:#a8780c;
  --ink:#16213a; --soft:#4b5670; --faint:#7d8699;
  --line:#dfe3ec; --rail:#f4f6fa;
  --ok-bg:#eff7f2; --ok-l:#a3c8b2; --ok-i:#1b6640;
  --warn-bg:#fff7ea; --warn-l:#e0be86; --warn-i:#8a5a06;
}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;color:var(--ink);background:#fff;
  font-family:"Source Sans 3",system-ui,sans-serif;font-size:10.6pt;line-height:1.52}
h1,h2,h3,h4{font-family:"Zilla Slab",Georgia,serif;margin:0;text-wrap:balance;
  break-after:avoid;page-break-after:avoid}
p{margin:0}p+p{margin-top:8px}

.portada{min-height:242mm;display:flex;flex-direction:column;justify-content:center;
  page-break-after:always;text-align:center;padding:0 10mm}
.portada .icono{font-size:56pt;line-height:1}
.portada .ente{font-size:11pt;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
  color:var(--gold);margin-top:16px}
.portada h1{font-size:34pt;font-weight:700;margin-top:10px;line-height:1.05}
.portada .baja{font-size:13pt;color:var(--soft);margin-top:12px}
.portada .barra{height:5px;width:150mm;margin:26px auto;border-radius:3px;
  background:linear-gradient(to right,#f4c20d 0%,#f4c20d 33.33%,
    #1a4f8a 33.33%,#1a4f8a 66.66%,#cf142b 66.66%,#cf142b 100%)}
.portada .web{font-family:"IBM Plex Mono",monospace;font-size:11pt;color:var(--navy2);margin-top:8px}
.portada .pie{margin-top:34px;font-size:9.5pt;color:var(--faint)}

section{page-break-before:always;padding-top:2mm}
.eyebrow{font-family:"IBM Plex Mono",monospace;font-size:8.5pt;font-weight:500;
  letter-spacing:.12em;text-transform:uppercase;color:var(--gold)}
h2{font-size:19pt;font-weight:700;margin-top:4px;letter-spacing:-.01em}
.regla{height:2px;width:42px;background:var(--gold);margin:9px 0 14px;border-radius:2px}
h3{font-size:12.5pt;font-weight:600;margin-top:18px}
h3+p{margin-top:6px}
.sub{color:var(--soft)}

ol.pasos{list-style:none;counter-reset:p;margin:14px 0 0;padding:0}
ol.pasos>li{counter-increment:p;position:relative;padding:0 0 14px 40px;
  break-inside:avoid;page-break-inside:avoid}
ol.pasos>li::before{content:counter(p);position:absolute;left:0;top:-1px;
  width:26px;height:26px;border-radius:50%;display:grid;place-items:center;
  font-family:"IBM Plex Mono",monospace;font-size:11pt;font-weight:500;
  border:2px solid var(--gold);color:var(--gold)}
ol.pasos>li>b{display:block;font-family:"Zilla Slab",serif;font-size:11.5pt;font-weight:600}
ol.pasos>li span{display:block;color:var(--soft);margin-top:2px}

.aviso{border-left:4px solid;border-radius:0 8px 8px 0;padding:11px 14px;margin-top:13px;
  break-inside:avoid;page-break-inside:avoid;font-size:10pt}
.aviso>b:first-child{display:block;font-family:"Zilla Slab",serif;margin-bottom:3px}
.aviso.ok{background:var(--ok-bg);border-color:var(--ok-l);color:var(--ok-i)}
.aviso.warn{background:var(--warn-bg);border-color:var(--warn-l);color:var(--warn-i)}

table{border-collapse:collapse;width:100%;margin-top:13px;font-size:9.8pt}
th,td{padding:6px 9px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
thead{display:table-header-group}
thead th{background:var(--rail);font-family:"Zilla Slab",serif;font-weight:600;
  font-size:9pt;text-transform:uppercase;letter-spacing:.03em;color:var(--soft)}
tr{break-inside:avoid;page-break-inside:avoid}

ul.lista{margin:9px 0 0;padding-left:17px;color:var(--soft)}
ul.lista li{margin-top:5px}
ul.lista li::marker{color:var(--gold)}

.caja{border:1px solid var(--line);border-radius:9px;padding:13px 15px;margin-top:13px;
  background:var(--rail);break-inside:avoid;page-break-inside:avoid}
.caja h4{font-size:11pt;font-weight:600;margin-bottom:5px}
.caja b,.aviso b,td b,ol.pasos>li span b{display:inline}
.dato{font-family:"IBM Plex Mono",monospace;font-size:10pt}

figure{margin:14px 0 0;break-inside:avoid-page;page-break-inside:avoid}
figure img{width:100%;height:auto;max-height:112mm;object-fit:contain;object-position:top;
  display:block;border:1px solid var(--line);border-radius:8px;background:#fff}
figcaption{margin-top:5px;font-size:8.8pt;color:var(--faint);font-style:italic}
footer{margin-top:22px;padding-top:12px;border-top:1px solid var(--line);
  font-size:8.6pt;color:var(--faint)}
</style>
</head>
<body>
"""

CUERPO = """
<div class="portada">
  <div class="icono">&#128138;</div>
  <div class="ente">Alcald&iacute;a del Municipio Bolivariano Crist&oacute;bal Rojas</div>
  <h1>Farmacia Municipal</h1>
  <div class="baja">Manual del sistema de inventario y entrega de medicamentos</div>
  <div class="barra"></div>
  <div class="web">salud.alcaldiadecharallave.com</div>
  <div class="pie">Direcci&oacute;n de Salud P&uacute;blica &middot; Charallave, estado Miranda</div>
</div>

<section>
  <p class="eyebrow">Presentaci&oacute;n</p>
  <h2>Qu&eacute; hace este sistema</h2>
  <div class="regla"></div>

  <p>Lleva el control completo de la farmacia municipal: <b>lo que entra, lo que sale y lo que
  queda</b>. Todo el personal trabaja sobre una sola herramienta, cada uno con lo que le
  corresponde seg&uacute;n su perfil.</p>

  <p>Funciona desde el tel&eacute;fono o desde la computadora, con cualquier navegador.
  No hay que instalar nada.</p>

  <h3>Lo que aporta</h3>
  <ul class="lista">
    <li><b>El inventario siempre cuadra.</b> La existencia se calcula sola a partir de los
      movimientos registrados.</li>
    <li><b>No se entregan medicamentos vencidos.</b> Al despachar, el sistema propone siempre
      el lote que vence primero.</li>
    <li><b>Queda constancia de qui&eacute;n entreg&oacute; qu&eacute;, a qui&eacute;n y
      cu&aacute;ndo.</b></li>
    <li><b>Avisa antes de que algo se venza</b>, con 30 y 90 d&iacute;as de anticipaci&oacute;n.</li>
  </ul>

  <h3>Las tres piezas</h3>
  <table>
    <thead><tr><th>Pieza</th><th>Qu&eacute; es</th><th>Ejemplo</th></tr></thead>
    <tbody>
      <tr><td><b>Producto</b></td><td>El medicamento o insumo</td><td>LOSART&Aacute;N 50mg</td></tr>
      <tr><td><b>Lote</b></td><td>Cada compra que llega, con su n&uacute;mero y su vencimiento</td>
          <td>Lote 25002, vence 12/2027</td></tr>
      <tr><td><b>Movimiento</b></td><td>Cada entrada, salida, ajuste o baja</td>
          <td>Salieron 30 el 15/09</td></tr>
    </tbody>
  </table>
  <p style="margin-top:10px" class="sub">Un mismo producto puede tener varios lotes al mismo
  tiempo, cada uno con su fecha. Por eso el sistema siempre indica <b>de cu&aacute;l lote</b>
  sacar.</p>
</section>

<section>
  <p class="eyebrow">Acceso</p>
  <h2>C&oacute;mo entrar</h2>
  <div class="regla"></div>

  <div class="caja">
    <h4>La direcci&oacute;n</h4>
    <p class="dato">salud.alcaldiadecharallave.com</p>
  </div>

  __FIG_ENTRAR__

  <ol class="pasos">
    <li><b>Reg&iacute;strate la primera vez</b>
      <span>Escribe tu correo y la contrase&ntilde;a que quieras, y pulsa
      &laquo;Reg&iacute;strate aqu&iacute;&raquo;.</span></li>
    <li><b>El administrador te asigna tu perfil</b>
      <span>&Eacute;l define qu&eacute; vas a hacer: entregar medicamentos, recibir mercanc&iacute;a
      o administrar.</span></li>
    <li><b>Cambia tu contrase&ntilde;a al entrar</b>
      <span>El sistema te la pide la primera vez, para que tu clave sea solo tuya.</span></li>
  </ol>

  <div class="aviso warn">
    <b>Si olvidas tu contrase&ntilde;a</b>
    El administrador te la restablece, y el sistema te pedir&aacute; elegir una nueva al entrar.
  </div>

  <h3>Los tres perfiles</h3>
  <table>
    <thead><tr><th>Perfil</th><th>Puede hacer</th><th>No puede</th></tr></thead>
    <tbody>
      <tr><td><b>Despacho</b><br><span class="sub">3 personas</span></td>
          <td>Entregar medicamentos a pacientes y a centros de salud. Consultar existencias.
              Registrar un paciente nuevo.</td>
          <td>Recibir mercanc&iacute;a, crear medicamentos, corregir existencias.</td></tr>
      <tr><td><b>Inventario</b><br><span class="sub">1 persona</span></td>
          <td>Registrar lo que llega, crear medicamentos y lotes, dar de baja vencidos,
              corregir existencias tras un conteo.</td>
          <td>Entregar medicamentos.</td></tr>
      <tr><td><b>Administrador</b><br><span class="sub">1 persona</span></td>
          <td>Todo lo anterior, m&aacute;s crear y desactivar usuarios, ver la actividad de todos
              y consultar la bit&aacute;cora.</td>
          <td>Modificar la bit&aacute;cora.</td></tr>
    </tbody>
  </table>
</section>

<section>
  <p class="eyebrow">Perfil despacho</p>
  <h2>Entregar a una persona</h2>
  <div class="regla"></div>
  <p class="sub">Es la pantalla que m&aacute;s se usa. Est&aacute; pensada para atender
  r&aacute;pido, desde el tel&eacute;fono, con la persona esperando.</p>

  <ol class="pasos">
    <li><b>Busca a la persona</b>
      <span>Escribe su c&eacute;dula o parte de su nombre. Con tres letras basta.</span></li>
  </ol>
  __FIG_BUSCAR__

  <ol class="pasos" style="margin-top:16px">
    <li><b>El&iacute;gela de la lista</b>
      <span>Debajo de su nombre aparece su tratamiento cr&oacute;nico, para saber qu&eacute; le
      corresponde.</span></li>
    <li><b>Escribe el medicamento</b>
      <span>El sistema muestra los lotes disponibles ordenados por el que vence primero, con las
      unidades que quedan de cada uno.</span></li>
  </ol>
  __FIG_LOTE__

  <ol class="pasos" style="margin-top:16px">
    <li><b>Elige el lote y pon la cantidad</b>
      <span>Se pueden agregar varios medicamentos a la misma entrega.</span></li>
    <li><b>Pulsa &laquo;Registrar la entrega&raquo;</b>
      <span>Se descuenta del inventario y queda registrado con tu nombre.</span></li>
  </ol>
  __FIG_ENTREGA__

  <div class="aviso ok">
    <b>Si la persona no est&aacute; registrada</b>
    Aparece el bot&oacute;n &laquo;Registrar persona nueva&raquo;. Con el nombre y la c&eacute;dula
    basta para atenderla en el momento; el tel&eacute;fono es opcional.
  </div>
</section>

<section>
  <p class="eyebrow">Perfil despacho</p>
  <h2>Entregar a un centro de salud</h2>
  <div class="regla"></div>
  <p class="sub">Para los despachos a un CDI, un ambulatorio o un consultorio popular.</p>

  <ol class="pasos">
    <li><b>Cambia a &laquo;A un centro (CDI)&raquo;</b>
      <span>Es el bot&oacute;n de arriba de la pantalla.</span></li>
    <li><b>Busca el centro</b><span>Escribe parte de su nombre.</span></li>
    <li><b>Anota qui&eacute;n recibe</b>
      <span>Nombre, apellido y c&eacute;dula de quien firma. Es la constancia del traspaso, y el
      sistema la exige.</span></li>
    <li><b>Carga los renglones y registra</b>
      <span>Medicamento, lote y cantidad, igual que con una persona.</span></li>
  </ol>
  __FIG_CDI__
</section>

<section>
  <p class="eyebrow">Perfil inventario</p>
  <h2>Registrar la mercanc&iacute;a que llega</h2>
  <div class="regla"></div>

  <ol class="pasos">
    <li><b>Entra a &laquo;Registrar lo que llega&raquo;</b></li>
    <li><b>Busca el medicamento</b>
      <span>Si es la primera vez que llega, se crea desde la misma pantalla con
      &laquo;+ Es uno nuevo&raquo;.</span></li>
    <li><b>Copia el n&uacute;mero de lote de la caja</b>
      <span>Tal como viene impreso. Permite rastrear el medicamento si el fabricante lo
      retira.</span></li>
    <li><b>Pon la fecha de vencimiento</b>
      <span>Es lo que permite avisar a tiempo y ordenar por el que vence primero.</span></li>
    <li><b>Escribe cu&aacute;ntas unidades llegaron y registra</b>
      <span>Quedan disponibles de inmediato para quien despacha.</span></li>
  </ol>
  __FIG_RECIBIR__

  <div class="caja">
    <h4>Un mismo medicamento, varios lotes</h4>
    <p class="sub">Si llegan 200 losartanes en marzo y 300 en agosto, son dos lotes distintos con
    dos vencimientos distintos. El sistema los maneja por separado y siempre despacha primero el
    que vence antes.</p>
  </div>
</section>

<section>
  <p class="eyebrow">Perfil inventario</p>
  <h2>Vencimientos y conteos</h2>
  <div class="regla"></div>

  <h3>Las alertas</h3>
  <p>Es lo primero que aparece al entrar: lotes vencidos, unidades vencidas, los que vencen en 30
  d&iacute;as y los que vencen en 90. Debajo, cada uno con su lote, su fecha y sus unidades.</p>
  __FIG_ALERTAS__

  <div class="aviso ok">
    <b>C&oacute;mo aprovecharlas</b>
    Revisar la lista de &laquo;vencen en 30 d&iacute;as&raquo; una vez por semana. Esos son los que
    hay que sacar primero. Si un medicamento se vence con existencia alta, es se&ntilde;al de que
    se est&aacute; pidiendo m&aacute;s de lo que se entrega.
  </div>

  <h3>Dar de baja un lote vencido</h3>
  <ol class="pasos">
    <li><b>B&uacute;scalo en la lista de vencidos</b>
      <span>Pulsa &laquo;Dar de baja&raquo; en su rengl&oacute;n.</span></li>
    <li><b>Confirma</b><span>Queda registrado qui&eacute;n lo hizo y cu&aacute;ndo.</span></li>
    <li><b>Sep&aacute;ralo f&iacute;sicamente del anaquel</b></li>
  </ol>

  <h3>Corregir la existencia tras un conteo</h3>
  <ol class="pasos">
    <li><b>Entra a &laquo;Corregir existencia&raquo;</b></li>
    <li><b>Busca el lote</b><span>Muestra cu&aacute;nto tiene registrado el sistema.</span></li>
    <li><b>Escribe cu&aacute;ntas unidades hay realmente</b>
      <span>El sistema calcula la diferencia. Se escribe el total real, no la diferencia.</span></li>
    <li><b>Indica el motivo</b><span>Conteo f&iacute;sico, rotura, derrame. Queda registrado.</span></li>
  </ol>
  __FIG_AJUSTE__
</section>

<section>
  <p class="eyebrow">Perfil administrador</p>
  <h2>El panel de control</h2>
  <div class="regla"></div>

  <h3>Tablero</h3>
  <p>Los n&uacute;meros del d&iacute;a: entregas realizadas, lotes vencidos, los que vencen en 30
  d&iacute;as y los pacientes pendientes de completar. Debajo, cu&aacute;nto entreg&oacute; cada
  persona y la actividad reciente.</p>
  __FIG_TABLERO__

  <h3>Bit&aacute;cora</h3>
  <p>El registro de todo lo que ocurre en el sistema: qui&eacute;n, qu&eacute;, cu&aacute;ndo y
  qu&eacute; cambi&oacute;. Se filtra por tipo de acci&oacute;n y por persona.</p>
  __FIG_BITACORA__

  <h3>Usuarios</h3>
  <p>Aqu&iacute; se activa a quien se registr&oacute;, se le asigna su perfil o se le retira el
  acceso.</p>
  __FIG_USUARIOS__
  <div class="aviso warn">
    <b>Los usuarios se desactivan, no se borran</b>
    As&iacute; su historial de entregas se conserva completo y sigue siendo consultable.
  </div>

  <h3>Pacientes por completar</h3>
  <p>Pacientes cuyo registro necesita que se confirme la c&eacute;dula. Se escribe la correcta y el
  paciente queda activo.</p>
  __FIG_REVISAR__
</section>

<section>
  <p class="eyebrow">Reglas del sistema</p>
  <h2>Lo que el sistema no permite</h2>
  <div class="regla"></div>
  <p class="sub">Estas reglas est&aacute;n en la base de datos, no en la pantalla.</p>

  <table>
    <thead><tr><th>No se permite</th><th>Motivo</th></tr></thead>
    <tbody>
      <tr><td><b>Entregar de un lote vencido</b></td>
          <td>Es medicamento. Ni siquiera aparece en la lista al buscar.</td></tr>
      <tr><td><b>Dejar la existencia en negativo</b></td>
          <td>Si se intenta sacar m&aacute;s de lo que hay, el sistema indica cu&aacute;nto queda.</td></tr>
      <tr><td><b>Borrar un movimiento</b></td>
          <td>Se corrige registrando el movimiento contrario, para conservar la trazabilidad.</td></tr>
      <tr><td><b>Registrar una entrega a nombre de otra persona</b></td>
          <td>El sistema firma con el usuario que est&aacute; en sesi&oacute;n.</td></tr>
      <tr><td><b>Entregar sin destinatario</b></td>
          <td>Toda entrega va a una persona o a un centro de salud.</td></tr>
      <tr><td><b>Que un despachador cree medicamentos o ajuste existencias</b></td>
          <td>Corresponde al perfil de inventario.</td></tr>
      <tr><td><b>Cambiarse el perfil uno mismo</b></td>
          <td>Los perfiles los asigna el administrador.</td></tr>
      <tr><td><b>Modificar la bit&aacute;cora</b></td>
          <td>Su valor est&aacute; en que no se puede alterar.</td></tr>
    </tbody>
  </table>
</section>

<section>
  <p class="eyebrow">Consultas frecuentes</p>
  <h2>Si algo no funciona</h2>
  <div class="regla"></div>

  <table>
    <thead><tr><th>Mensaje</th><th>Qu&eacute; hacer</th></tr></thead>
    <tbody>
      <tr><td>&laquo;El correo o la contrase&ntilde;a no son correctos&raquo;</td>
          <td>Revisar may&uacute;sculas. Si persiste, pedir al administrador que restablezca la
              contrase&ntilde;a.</td></tr>
      <tr><td>&laquo;Tu usuario est&aacute; desactivado&raquo;</td>
          <td>Solicitar al administrador que lo active.</td></tr>
      <tr><td>&laquo;No hay conexi&oacute;n con el servidor&raquo;</td>
          <td>Es la conexi&oacute;n a internet. La operaci&oacute;n no se guard&oacute;: hay que
              repetirla.</td></tr>
      <tr><td>&laquo;Ese lote est&aacute; vencido&raquo;</td>
          <td>Buscar otro lote del mismo medicamento o consultar con inventario.</td></tr>
      <tr><td>&laquo;No hay suficiente. Quedan X&raquo;</td>
          <td>Si en el anaquel hay m&aacute;s unidades, corresponde una correcci&oacute;n por
              conteo.</td></tr>
      <tr><td>No aparece el medicamento</td>
          <td>Puede estar agotado o vencido. Consultar con inventario.</td></tr>
      <tr><td>No aparece el paciente</td>
          <td>Buscar con menos letras o por c&eacute;dula. Si no est&aacute;, registrarlo.</td></tr>
      <tr><td>Una entrega qued&oacute; mal registrada</td>
          <td>El administrador la anula y registra la correcci&oacute;n.</td></tr>
    </tbody>
  </table>

  <div class="caja">
    <h4>Una regla general</h4>
    <p>Si el sistema indica que una operaci&oacute;n no se pudo completar, <b>no se
    complet&oacute;</b>. Conviene repetirla antes que darla por hecha.</p>
  </div>

  <footer>
    Alcald&iacute;a del Municipio Bolivariano Crist&oacute;bal Rojas &middot; Direcci&oacute;n de
    Salud P&uacute;blica<br>
    Farmacia Municipal &middot; salud.alcaldiadecharallave.com
  </footer>
</section>

</body>
</html>
"""

FIGURAS = [
    ('__FIG_ENTRAR__',   '01-entrar.jpg',         'Pantalla de entrada al sistema.'),
    ('__FIG_BUSCAR__',   '02-buscar-paciente.jpg','B&uacute;squeda del paciente por nombre o c&eacute;dula.'),
    ('__FIG_LOTE__',     '03-elegir-lote.jpg',    'Lotes disponibles, ordenados por el que vence primero.'),
    ('__FIG_ENTREGA__',  '04-entrega-lista.jpg',  'La entrega armada, lista para registrar.'),
    ('__FIG_CDI__',      '05-entrega-cdi.jpg',    'Entrega a un centro de salud, con los datos de quien recibe.'),
    ('__FIG_RECIBIR__',  '07-recibir.jpg',        'Registro de mercanc&iacute;a que llega.'),
    ('__FIG_ALERTAS__',  '06-alertas.jpg',        'Alertas de vencimiento al entrar.'),
    ('__FIG_AJUSTE__',   '08-ajuste.jpg',         'Correcci&oacute;n de existencia tras un conteo f&iacute;sico.'),
    ('__FIG_TABLERO__',  '09-tablero.jpg',        'Tablero del administrador.'),
    ('__FIG_BITACORA__', '10-bitacora.jpg',       'Bit&aacute;cora, con filtros por acci&oacute;n y por persona.'),
    ('__FIG_USUARIOS__', '11-usuarios.jpg',       'Gesti&oacute;n de usuarios y perfiles.'),
    ('__FIG_REVISAR__',  '12-por-revisar.jpg',    'Pacientes cuyo registro hay que completar.'),
]

cuerpo = CUERPO
faltan = []
for marca, archivo, pie in FIGURAS:
    if os.path.exists(IMG + archivo):
        cuerpo = cuerpo.replace(marca, fig(archivo, pie))
    else:
        cuerpo = cuerpo.replace(marca, '')
        faltan.append(archivo)

salida = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'manual.html')
io.open(salida, 'w', encoding='utf-8', newline='').write(ESTILO + cuerpo)
print('manual escrito: %s  (%d KB)' % (salida, os.path.getsize(salida) // 1024))
if faltan:
    print('faltaron capturas:', ', '.join(faltan))
