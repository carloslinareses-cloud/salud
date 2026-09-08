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
/* max-width y no width: una captura chica (el boton del tema mide 230 px)
   estirada a todo el ancho se ve pixelada y ridicula. Que cada una salga
   a su tamano, sin pasarse del ancho de la pagina. */
figure img{max-width:100%;height:auto;max-height:112mm;object-fit:contain;object-position:top;
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
  queda</b>. Y lleva tambi&eacute;n la ficha de cada persona y de cada centro de salud a los que
  se despacha. Todo el personal trabaja sobre una sola herramienta, cada uno con lo que le
  corresponde seg&uacute;n su perfil.</p>

  <p>Funciona desde el tel&eacute;fono o desde la computadora, con cualquier navegador.
  No hay que instalar nada.</p>

  <div class="caja">
    <h4>Sobre las fotos de este manual</h4>
    <p>Todo lo que aparece en las im&aacute;genes es <b>inventado</b>: la persona, el centro y
    los medicamentos que empiezan por &laquo;EJEMPLO&raquo; no existen. Se hizo as&iacute; a
    prop&oacute;sito, porque este manual se imprime y se pasa de mano en mano, y no puede llevar
    el nombre, la c&eacute;dula ni el tel&eacute;fono de un paciente de verdad.</p>
  </div>

  <h3>Lo que aporta</h3>
  <ul class="lista">
    <li><b>El inventario siempre cuadra.</b> La existencia se calcula sola a partir de los
      movimientos registrados. No se escribe a mano en ninguna parte.</li>
    <li><b>No se entregan medicamentos vencidos.</b> Al despachar, el sistema propone siempre
      el lote que vence primero, y la base rechaza un lote vencido.</li>
    <li><b>Cada persona tiene su ficha:</b> sus patolog&iacute;as y las medicinas que necesita.
      Cuando vuelve, sale todo en pantalla y se entrega de un toque.</li>
    <li><b>Cada centro tiene su lista de insumos</b>, con cu&aacute;nto suele pedir. El pedido
      se arma solo.</li>
    <li><b>Queda constancia de qui&eacute;n entreg&oacute; qu&eacute;, a qui&eacute;n y
      cu&aacute;ndo.</b> Eso no se puede borrar.</li>
    <li><b>Avisa antes de que algo se venza</b>, con 30 y 90 d&iacute;as de anticipaci&oacute;n.</li>
  </ul>

  <h3>Las tres piezas del inventario</h3>
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

  <p>Se entra con el <b>correo</b> y la <b>contrase&ntilde;a</b> que da el administrador. Nadie
  se registra solo: al personal lo crea el administrador desde su panel.</p>

  <p>La primera vez que alguien entra, el sistema le <b>obliga a cambiar la
  contrase&ntilde;a</b>. La que dio el administrador es provisional y solo sirve para esa
  primera vez.</p>

  __FIG_ENTRAR__

  <h3>Los tres perfiles</h3>
  <table>
    <thead><tr><th>Perfil</th><th>Qu&eacute; ve</th><th>Qu&eacute; puede hacer</th></tr></thead>
    <tbody>
      <tr><td><b>Despacho</b></td><td>Solo la pantalla de Entregar</td>
          <td>Entregar a personas y a centros. Registrar a alguien nuevo en el momento.
              <b>No carga mercanc&iacute;a.</b></td></tr>
      <tr><td><b>Inventario</b></td><td>Solo la pantalla de Mercanc&iacute;a</td>
          <td>Registrar lo que llega, el cat&aacute;logo, las alertas, las fichas de personas y
              centros, el tablero de entregas y la correcci&oacute;n de existencia.
              <b>No despacha.</b></td></tr>
      <tr><td><b>Administrador</b></td><td>Las tres &aacute;reas</td>
          <td>Todo lo anterior, m&aacute;s los usuarios, la bit&aacute;cora y el historial.</td></tr>
    </tbody>
  </table>

  <div class="caja">
    <h4>Por qu&eacute; despacho e inventario est&aacute;n separados</h4>
    <p>Quien <b>carga</b> la mercanc&iacute;a no es quien la <b>saca</b>. Si la misma persona
    hiciera las dos cosas, nadie podr&iacute;a cuadrar el inventario contra ella. No es solo la
    pantalla: la base de datos tambi&eacute;n lo impide, as&iacute; que no hay forma de saltarlo.</p>
  </div>

  <h3>El administrador ve tres botones arriba</h3>
  __FIG_AREAS__
  <p class="sub">Cambia entre ellos sin perder lo que estaba haciendo: si arma una entrega, va a
  mirar la existencia y vuelve, su entrega sigue ah&iacute;.</p>

  <h3>Modo claro y modo oscuro</h3>
  __FIG_TEMA__
  <p>El bot&oacute;n de arriba a la derecha cambia entre los dos y se acuerda de lo que elija
  cada quien. Si no se toca, respeta el modo que tenga el tel&eacute;fono. Sirve para la calle:
  con sol, el modo claro se lee mucho mejor.</p>
</section>

<section>
  <p class="eyebrow">Entregar</p>
  <h2>Entregar a una persona</h2>
  <div class="regla"></div>

  <p>Es la pantalla que m&aacute;s se usa. Van cuatro pasos: <b>buscar a la persona</b>,
  <b>agregar lo que se lleva</b>, <b>registrar</b> e <b>imprimir el comprobante</b>.</p>

  <h3>1. Buscar a la persona</h3>
  <p>Se busca por <b>c&eacute;dula o por nombre</b>. La lista sale sin escribir nada, y cada
  rengl&oacute;n dice la edad, el tel&eacute;fono, cu&aacute;ntas medicinas necesita y
  cu&aacute;ndo retir&oacute; por &uacute;ltima vez: con dos personas del mismo nombre, eso es lo
  que las distingue.</p>
  __FIG_BUSCARPER__

  <h3>Si no est&aacute; registrada</h3>
  <p>Con el bot&oacute;n <b>+ Registrar persona</b> se le abre la ficha completa. Escribiendo la
  c&eacute;dula y pulsando <b>Buscar en el registro</b>, el sistema trae el nombre y la fecha de
  nacimiento del registro electoral: se teclea menos y se evitan las erratas.</p>
  <p>Ah&iacute; mismo se le anotan sus <b>patolog&iacute;as</b> y las <b>medicinas que
  necesita</b>. No hace falta: se puede registrar solo con los datos y anotarlas despu&eacute;s.</p>
  __FIG_REGPER__

  <div class="caja">
    <h4>El sexo no se adivina</h4>
    <p>Del registro electoral se toman <b>solo el nombre y la fecha de nacimiento</b>. El sexo se
    pregunta y se elige; si no se sabe, se deja en &laquo;No lo dice&raquo;. Deducirlo del nombre
    ser&iacute;a inventar un dato de una persona.</p>
  </div>

  <h3>2. Su ficha: patolog&iacute;as y tratamiento</h3>
  <p>Al elegirla salen sus <b>patolog&iacute;as</b> y su <b>tratamiento</b>. Cada medicina dice
  cu&aacute;ntas hay disponibles; <b>se toca y se agrega</b> a la entrega, con el lote que vence
  primero ya elegido. Las que no tienen existencia salen apagadas y dicen por qu&eacute;.</p>
  __FIG_FICHAPAC__
  <p class="sub">El l&aacute;piz corrige el nombre de un rengl&oacute;n y la equis lo quita.
  Quitar no borra nada: lo marca como inactivo y queda constancia de qui&eacute;n lo hizo.</p>

  <h3>3. Lo que se lleva</h3>
  <p>Lo agregado aparece arriba, con <b>&minus;</b> y <b>+</b> para ajustar la cantidad. El
  sistema no deja poner m&aacute;s de lo que hay en ese lote.</p>
  __FIG_CESTA__

  <h3>4. Registrar</h3>
  <p>Con <b>Registrar la entrega</b> se descuenta del inventario en el momento y queda anotado a
  nombre de quien despach&oacute;. Despu&eacute;s se ofrece el <b>comprobante</b> para imprimir.</p>

  <div class="caja">
    <h4>Nunca dice &laquo;guardado&raquo; si no se guard&oacute;</h4>
    <p>Si se cae el internet a mitad, el sistema lo dice claro: <i>&laquo;Se cay&oacute; la
    conexi&oacute;n y NO se registr&oacute; la entrega&raquo;</i>. Hay que volver a intentarlo.
    Y si se pulsa dos veces el bot&oacute;n, la entrega <b>no</b> se duplica.</p>
  </div>
</section>

<section>
  <p class="eyebrow">Entregar</p>
  <h2>Entregar a un centro de salud</h2>
  <div class="regla"></div>

  <p>Arriba se cambia a <b>A un centro (CDI)</b>. Son los CDI, ambulatorios, consultorios
  populares y dem&aacute;s sitios a los que la farmacia despacha.</p>

  <p>Al elegir el centro sale <b>lo que ese centro pide</b>: su lista de insumos con la cantidad
  que suele necesitar y cu&aacute;nto hay hoy de cada uno. Lo que se puede entregar hoy va
  primero. Con <b>+ Agregar los que hay en existencia</b> se arma el pedido entero de un toque.</p>
  __FIG_CENTROPED__

  <div class="caja">
    <h4>Si no alcanza, lo dice</h4>
    <p>Cuando el centro pide 120 y en la farmacia hay 40, el sistema <b>agrega los 40</b> y avisa
    de que no alcanz&oacute;. Nunca pone una cantidad que no existe.</p>
  </div>

  <h3>Qui&eacute;n recibe</h3>
  <p>Para un centro hay que anotar <b>el nombre y la c&eacute;dula de quien recibe</b>. Sin eso
  el sistema no deja registrar: es lo que respalda el acta.</p>

  <h3>El acta de entrega-recepci&oacute;n</h3>
  <p>Al terminar se ofrece el <b>acta</b> en PDF, con el cintillo institucional, el detalle de
  todo lo entregado con sus lotes y vencimientos, el total de unidades y las dos firmas.</p>
  __FIG_ACTA__
</section>

<section>
  <p class="eyebrow">Mercanc&iacute;a</p>
  <h2>Registrar lo que llega</h2>
  <div class="regla"></div>

  <p>Es la primera pesta&ntilde;a de Mercanc&iacute;a y la m&aacute;s r&aacute;pida. Pide cinco
  cosas y nada m&aacute;s:</p>

  <table>
    <thead><tr><th>Campo</th><th>Qu&eacute; se pone</th></tr></thead>
    <tbody>
      <tr><td><b>Insumo</b></td><td>El nombre del medicamento o insumo</td></tr>
      <tr><td><b>Presentaci&oacute;n y componentes</b></td><td>Caja de 30 tabletas de 500 mg</td></tr>
      <tr><td><b>Lote</b></td><td>El n&uacute;mero que trae la caja</td></tr>
      <tr><td><b>Vencimiento</b></td><td>La fecha de la caja</td></tr>
      <tr><td><b>Cantidad</b></td><td>Cu&aacute;ntas unidades entran</td></tr>
    </tbody>
  </table>

  <p style="margin-top:10px">Con <b>Enter</b> se baja al siguiente campo. Si el medicamento ya
  existe se le suma al que hay; si no, se crea. Si el lote ya existe con la misma fecha, se le
  suma. Debajo queda a la vista <b>lo &uacute;ltimo que se carg&oacute;</b>, para no dudar.</p>
  __FIG_REGLLEGA__

  <div class="caja">
    <h4>Si no pone la fecha de vencimiento</h4>
    <p>El sistema pregunta antes de guardar. Un lote sin fecha no se puede vigilar: no entra en
    las alertas y nadie sabr&aacute; cu&aacute;ndo se vence.</p>
  </div>
</section>

<section>
  <p class="eyebrow">Mercanc&iacute;a</p>
  <h2>El cat&aacute;logo y las alertas</h2>
  <div class="regla"></div>

  <h3>Cat&aacute;logo</h3>
  <p>Todo lo que existe, con su existencia al lado. Arriba hay cinco cifras que adem&aacute;s
  <b>funcionan como filtro</b>: se toca &laquo;Bajo el m&iacute;nimo&raquo; y la lista se acota a
  esos. Se descarga en Excel y en PDF.</p>
  __FIG_CATALOGO__
  <p class="sub">Cuando un medicamento viene en cajas, el sistema dice tambi&eacute;n
  <b>cu&aacute;ntas cajas son</b>: &laquo;240 unidades &mdash; 8 cajas&raquo;.</p>

  <h3>Alertas de vencimiento</h3>
  <p>Tres bloques: lo <b>vencido</b>, lo que vence en <b>30 d&iacute;as</b> y lo que vence en
  <b>90</b>. Desde aqu&iacute; se da de baja un lote vencido, y queda registrado con su motivo y
  con el nombre de quien lo hizo.</p>
  __FIG_ALERTAS__
</section>

<section>
  <p class="eyebrow">Mercanc&iacute;a</p>
  <h2>Las fichas de las personas</h2>
  <div class="regla"></div>

  <p>Entregar tiene su atajo para registrar a alguien en el momento. Esta pantalla es para
  hacerlo <b>en serio</b>: sentarse a pasar la gente del cuaderno al sistema, con todos sus datos.</p>

  <p>Se busca por <b>c&eacute;dula, nombre o patolog&iacute;a</b>. Cada rengl&oacute;n muestra
  sus patolog&iacute;as, cu&aacute;ntas medicinas necesita y cu&aacute;ntas veces ha retirado.</p>
  __FIG_PERSONAS__

  <p>Al abrir a una persona se le corrige todo: sus datos, sus patolog&iacute;as y sus medicinas.</p>
  __FIG_FICHAPERSONA__

  <div class="caja">
    <h4>Las patolog&iacute;as se eligen de una lista</h4>
    <p>No se escriben libres. Si cada quien escribiera lo suyo, la misma cosa entrar&iacute;a como
    &laquo;HIPERTENSION&raquo;, &laquo;HTA&raquo; y &laquo;TENSION ALTA&raquo;, y despu&eacute;s
    no habr&iacute;a manera de contar cu&aacute;ntos hipertensos hay. La pantalla ofrece primero
    <b>las que ya escribi&oacute; alguien</b> &mdash;con cu&aacute;nta gente las tiene&mdash; y
    luego las m&aacute;s comunes. Si de verdad no est&aacute;, se puede anotar tal cual.</p>
  </div>

  <div class="caja">
    <h4>Quitar no borra</h4>
    <p>Ni una patolog&iacute;a ni una medicina. Se marcan como inactivas y queda constancia en la
    bit&aacute;cora de qui&eacute;n lo hizo y cu&aacute;ndo. Es la ficha de salud de una persona.</p>
  </div>
</section>

<section>
  <p class="eyebrow">Mercanc&iacute;a</p>
  <h2>Los centros de salud</h2>
  <div class="regla"></div>

  <p>Aqu&iacute; se dan de alta los CDI, ambulatorios y consultorios, y se les arma
  <b>su lista de insumos</b>: qu&eacute; piden y cu&aacute;nto de cada cosa.</p>
  __FIG_CENTROS__

  <p>Al abrir un centro se ve todo: sus datos, su lista y <b>todo lo que se le ha entregado</b>,
  resumido por insumo y descargable en Excel y en PDF.</p>
  __FIG_FICHACENTRO__

  <p>La cantidad de cada insumo se escribe en la casilla y <b>se guarda sola al salir de
  ella</b>. La columna de la derecha dice si con lo que hay hoy <b>alcanza</b> o <b>no
  alcanza</b>, y arriba avisa cu&aacute;ntos renglones no se pueden cubrir. Mejor saberlo antes
  de salir a repartir.</p>

  <div class="caja">
    <h4>La cantidad no descuenta nada</h4>
    <p>Es lo que el centro <b>suele</b> necesitar, para proponerlo al armar la entrega. Lo
    &uacute;nico que descuenta del inventario es el rengl&oacute;n de la entrega.</p>
  </div>
</section>

<section>
  <p class="eyebrow">Mercanc&iacute;a y Administraci&oacute;n</p>
  <h2>Lo que se entreg&oacute;</h2>
  <div class="regla"></div>

  <p>Contesta con un toque qu&eacute; sali&oacute; de la farmacia <b>hoy, esta semana, este mes o
  entre dos fechas cualesquiera</b> (para un solo d&iacute;a, se pone la misma fecha en las dos
  casillas).</p>
  __FIG_ENTREGADO__

  <p>Arriba, cinco cifras: entregas, personas atendidas, centros, medicamentos distintos y
  unidades. Debajo, tres tablas &mdash;<b>qu&eacute; se entreg&oacute;</b>, <b>d&iacute;a por
  d&iacute;a</b> y <b>qui&eacute;n despach&oacute;</b>&mdash; y el detalle rengl&oacute;n por
  rengl&oacute;n.</p>

  <p>Todo se descarga en <b>Excel</b> y en <b>PDF</b>. Sale exactamente lo que se est&aacute;
  viendo: si hay un filtro puesto, el archivo lo lleva y lo dice en el t&iacute;tulo.</p>

  <div class="caja">
    <h4>Las entregas viejas no se suman en unidades</h4>
    <p>Las que vinieron de los cuadernos dicen a qui&eacute;n y qu&eacute;, pero <b>no
    cu&aacute;ntas unidades</b>: el papel casi nunca lo anotaba. Se cuentan como entregas y se
    listan, pero no entran en el total de unidades, y la pantalla lo explica. Sumarlas
    ser&iacute;a inventar n&uacute;meros.</p>
  </div>
</section>

<section>
  <p class="eyebrow">Mercanc&iacute;a</p>
  <h2>Corregir la existencia despu&eacute;s de un conteo</h2>
  <div class="regla"></div>

  <p>Es una hoja tipo Excel para arreglar muchas existencias de una vez, despu&eacute;s de contar
  f&iacute;sicamente. Se puede corregir <b>todo</b>: el nombre del medicamento, su
  presentaci&oacute;n, el n&uacute;mero de lote, el vencimiento y lo que se cont&oacute;.</p>
  __FIG_CONTEO__

  <p>Se corrigen los renglones que hagan falta, se escribe el motivo y se guardan
  <b>todos juntos</b>. Con <b>Enter</b> se baja al siguiente, como en una hoja de c&aacute;lculo.</p>

  <div class="caja">
    <h4>El nombre es del medicamento, no del lote</h4>
    <p>Si un medicamento tiene tres lotes, cambiarle el nombre en un rengl&oacute;n lo cambia en
    los tres. La cantidad y el n&uacute;mero de lote s&iacute; son de cada lote por separado.
    Si por error se le ponen dos nombres distintos al mismo medicamento, <b>no guarda nada</b> y
    lo dice.</p>
  </div>
</section>

<section>
  <p class="eyebrow">Administraci&oacute;n</p>
  <h2>El panel del administrador</h2>
  <div class="regla"></div>

  <h3>Tablero</h3>
  <p>Las cifras del d&iacute;a: entregas de hoy, lotes vencidos, lo que vence en 30 d&iacute;as y
  las personas por revisar. Debajo, <b>lo &uacute;ltimo que pas&oacute;</b> en lenguaje llano:
  qui&eacute;n hizo qu&eacute; y cu&aacute;ndo.</p>
  __FIG_TABLERO__
  <p class="sub">Desde ah&iacute; se puede <b>deshacer</b> algo que se cre&oacute; por
  equivocaci&oacute;n, siempre que no tenga historial todav&iacute;a. Si ya tiene, el sistema no
  lo deja y explica por qu&eacute;.</p>

  <h3>Entregas</h3>
  <p>El mismo tablero de &laquo;Lo que se entreg&oacute;&raquo; que hay en Mercanc&iacute;a, para
  tenerlo a mano sin cambiar de &aacute;rea.</p>
  __FIG_ENTREGASADM__

  <h3>Usuarios</h3>
  <p>Se crea al personal con todo listo: nombre, correo, qu&eacute; va a hacer y una
  contrase&ntilde;a provisional. <b>Nadie se registra solo.</b> El sistema le obliga a cambiar la
  contrase&ntilde;a la primera vez que entre.</p>
  __FIG_USUARIOS__
  <p class="sub">Tambi&eacute;n se desactiva a quien ya no trabaja, sin borrar lo que hizo.</p>

  <h3>Bit&aacute;cora, historial y por revisar</h3>
  <ul class="lista">
    <li><b>Bit&aacute;cora:</b> todo lo que ha pasado en el sistema, con qui&eacute;n lo hizo.
      <b>No se puede editar ni borrar</b>, ni siquiera por el administrador.</li>
    <li><b>Historial:</b> las entregas que vinieron de los cuadernos, para consultarlas.</li>
    <li><b>Por revisar:</b> las fichas que llegaron con algo raro (una c&eacute;dula ilegible,
      por ejemplo) para que una persona lo corrija a mano.</li>
  </ul>
</section>

<section>
  <p class="eyebrow">Papeles y listados</p>
  <h2>Lo que se imprime y lo que se descarga</h2>
  <div class="regla"></div>

  <table>
    <thead><tr><th>Documento</th><th>D&oacute;nde sale</th><th>Para qu&eacute;</th></tr></thead>
    <tbody>
      <tr><td><b>Comprobante</b></td><td>Al terminar una entrega a una persona</td>
          <td>Lo que se llev&oacute;, con las firmas</td></tr>
      <tr><td><b>Acta de entrega-recepci&oacute;n</b></td><td>Al terminar una entrega a un centro</td>
          <td>El documento que firma el centro</td></tr>
      <tr><td><b>Cat&aacute;logo</b></td><td>Mercanc&iacute;a &rarr; Cat&aacute;logo</td>
          <td>Excel y PDF de todo lo que hay</td></tr>
      <tr><td><b>Alertas</b></td><td>Mercanc&iacute;a &rarr; Alertas</td>
          <td>Vencidos y por vencer</td></tr>
      <tr><td><b>Lo entregado</b></td><td>Mercanc&iacute;a o Administraci&oacute;n</td>
          <td>Excel de varias hojas y PDF del per&iacute;odo</td></tr>
      <tr><td><b>Entregas de un centro</b></td><td>Mercanc&iacute;a &rarr; Centros &rarr; ficha</td>
          <td>Todo lo que ha recibido ese centro</td></tr>
    </tbody>
  </table>

  <p style="margin-top:10px">Todos llevan el cintillo institucional. Las fechas van en letra y en
  n&uacute;meros para que no haya dudas, y los Excel salen con el t&iacute;tulo, la fecha de
  generaci&oacute;n y los encabezados congelados.</p>
</section>

<section>
  <p class="eyebrow">Reglas del sistema</p>
  <h2>Lo que el sistema no permite</h2>
  <div class="regla"></div>

  <p>No son avisos: son candados en la base de datos. No se pueden saltar ni desde la pantalla ni
  de ninguna otra forma.</p>

  <ul class="lista">
    <li><b>No se entrega de un lote vencido.</b></li>
    <li><b>No se deja la existencia en negativo.</b></li>
    <li><b>Nadie firma una entrega a nombre de otro.</b> El sistema pone siempre a quien
      est&aacute; conectado, y si alguien lo intenta queda anotado el intento.</li>
    <li><b>La bit&aacute;cora no se edita ni se borra.</b></li>
    <li><b>Una entrega es a una persona o a un centro</b>, nunca a los dos ni a ninguno.</li>
    <li><b>A un centro no se le entrega sin anotar qui&eacute;n recibe.</b></li>
    <li><b>Solo se borra lo que no tiene historial.</b> Un medicamento que ya tuvo lotes o
      entregas no se borra: se desactiva.</li>
    <li><b>El d&iacute;a es el de Venezuela</b>, no el del servidor. Una entrega hecha a las
      nueve de la noche cuenta para el d&iacute;a de hoy.</li>
  </ul>
</section>

<section>
  <p class="eyebrow">Consultas frecuentes</p>
  <h2>Si algo no funciona</h2>
  <div class="regla"></div>

  <h3>&laquo;No me deja entrar&raquo;</h3>
  <p>Revise que el correo est&eacute; completo y sin espacios. Si dice que el correo o la
  contrase&ntilde;a no son correctos, p&iacute;dale al administrador que le ponga una nueva desde
  Usuarios. Si dice que no hay conexi&oacute;n, es el internet.</p>

  <h3>&laquo;No aparece un medicamento&raquo;</h3>
  <p>En Entregar solo salen los que tienen existencia y no est&aacute;n vencidos. Para verlo todo,
  vaya a Mercanc&iacute;a &rarr; Cat&aacute;logo, que muestra tambi&eacute;n los que est&aacute;n
  en cero.</p>

  <h3>&laquo;La persona no tiene medicinas anotadas&raquo;</h3>
  <p>Puede que nunca se le anotaran. Si ha retirado antes, su tratamiento sale igual: lo que
  dec&iacute;a el cuaderno se pas&oacute; a su ficha. Si aun as&iacute; est&aacute; vac&iacute;a,
  an&oacute;telas con <b>+ Anotar una medicina que necesita</b>.</p>

  <h3>&laquo;Dice que no hay suficiente&raquo;</h3>
  <p>Est&aacute; pidiendo m&aacute;s de lo que queda en ese lote. Mire la existencia real en el
  cat&aacute;logo: si el n&uacute;mero no cuadra con lo que hay en el estante, hay que contar y
  corregirlo en <b>Corregir existencia</b>.</p>

  <h3>&laquo;Se fue el internet a mitad&raquo;</h3>
  <p>Si no dijo &laquo;Entrega registrada&raquo;, <b>no se registr&oacute;</b>. Vuelva a
  intentarlo cuando haya se&ntilde;al. El sistema nunca dice que guard&oacute; algo que no
  guard&oacute;, y si pulsa dos veces no se duplica.</p>

  <h3>&laquo;Me equivoqu&eacute; al registrar&raquo;</h3>
  <p>Av&iacute;sele al administrador. Desde su tablero puede quitar lo que se cre&oacute; por
  error, siempre que no tenga historial. Una entrega ya hecha no se borra: se anula, y queda
  constancia.</p>

  <h3>Desde el tel&eacute;fono</h3>
  <p>Funciona igual. Las tablas se convierten en tarjetas y todos los botones son grandes para
  acertar con el dedo.</p>
  __FIG_TELEFONO__
</section>

<section>
  <p class="eyebrow">Cierre</p>
  <h2>En resumen</h2>
  <div class="regla"></div>

  <ul class="lista">
    <li>Se entra en <b>salud.alcaldiadecharallave.com</b> con el correo y la contrase&ntilde;a
      que da el administrador.</li>
    <li><b>Entregar</b> es para despachar; <b>Mercanc&iacute;a</b> para cargar, revisar y llevar
      las fichas; <b>Administraci&oacute;n</b> para los usuarios y la auditor&iacute;a.</li>
    <li>La existencia <b>se calcula sola</b>. Si no cuadra con el estante, se cuenta y se corrige
      en Corregir existencia, dejando el motivo.</li>
    <li>Cada persona y cada centro tienen su ficha. Mientras m&aacute;s completa est&eacute;,
      m&aacute;s r&aacute;pido se atiende.</li>
    <li>Lo que no se registra, no existe. Y lo que se registra, queda.</li>
  </ul>

  <p style="margin-top:16px" class="sub">Manual de la Farmacia Municipal &middot; Direcci&oacute;n
  de Salud P&uacute;blica &middot; Alcald&iacute;a del Municipio Bolivariano Crist&oacute;bal
  Rojas.</p>
</section>
"""

FIGURAS = [
    ('__FIG_ENTRAR__',       '01-entrar.jpg',            'La pantalla de acceso.'),
    ('__FIG_TEMA__',         '02-tema.jpg',              'El bot&oacute;n que cambia entre modo claro y oscuro.'),
    ('__FIG_AREAS__',        '03-areas.jpg',             'Las tres &aacute;reas que ve el administrador.'),
    ('__FIG_BUSCARPER__',    '04-buscar-persona.jpg',    'Buscar a la persona por c&eacute;dula o por nombre.'),
    ('__FIG_REGPER__',       '05-registrar-persona.jpg', 'Registrar a alguien nuevo, con sus patolog&iacute;as y sus medicinas.'),
    ('__FIG_FICHAPAC__',     '06-ficha-paciente.jpg',    'Sus patolog&iacute;as y su tratamiento, listos para tocar y entregar.'),
    ('__FIG_CESTA__',        '07-cesta.jpg',             'Lo que se lleva, con la cantidad ajustable.'),
    ('__FIG_CENTROPED__',    '08-centro-pedido.jpg',     'Lo que pide un centro, con cu&aacute;nto necesita y cu&aacute;nto hay.'),
    ('__FIG_REGLLEGA__',     '09-registrar-llega.jpg',   'Registrar lo que llega: cinco campos y listo.'),
    ('__FIG_CATALOGO__',     '10-catalogo.jpg',          'El cat&aacute;logo, con las cifras que tambi&eacute;n filtran.'),
    ('__FIG_ALERTAS__',      '11-alertas.jpg',           'Vencidos y por vencer, en tres bloques.'),
    ('__FIG_PERSONAS__',     '12-personas-lista.jpg',    'La lista de personas, buscable tambi&eacute;n por patolog&iacute;a.'),
    ('__FIG_FICHAPERSONA__', '13-ficha-persona.jpg',     'La ficha completa: datos, patolog&iacute;as y medicinas.'),
    ('__FIG_CENTROS__',      '14-centros-lista.jpg',     'Los centros de salud a los que se despacha.'),
    ('__FIG_FICHACENTRO__',  '15-ficha-centro.jpg',      'La ficha del centro: su lista y lo que ha recibido.'),
    ('__FIG_ENTREGADO__',    '16-lo-entregado.jpg',      'Lo que se entreg&oacute; en el per&iacute;odo, con Excel y PDF.'),
    ('__FIG_CONTEO__',       '17-corregir-existencia.jpg','La hoja para corregir la existencia despu&eacute;s de contar.'),
    ('__FIG_TABLERO__',      '18-tablero.jpg',           'Las cifras del d&iacute;a en el panel del administrador.'),
    ('__FIG_ENTREGASADM__',  '19-entregas-admin.jpg',    'El mismo tablero de entregas, dentro de Administraci&oacute;n.'),
    ('__FIG_USUARIOS__',     '20-usuarios.jpg',          'Crear un usuario: queda listo para entrar.'),
    ('__FIG_TELEFONO__',     '21-telefono.jpg',          'La misma pantalla desde un tel&eacute;fono.'),
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
