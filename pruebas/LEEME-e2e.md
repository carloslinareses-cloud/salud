# Pruebas de punta a punta (E2E)

Estas pruebas abren un **Chrome de verdad**, tocan los botones como los tocaría
una persona y comprueban que lo que sale en pantalla es lo que tiene que salir.
Son distintas de las pruebas unitarias (`unitarias.mjs`), que solo revisan
funciones sueltas sin abrir nada.

Antes vivían en la carpeta temporal de la sesión y se perdían al cerrar. Ahora
están en el repositorio y se pueden volver a correr el día que alguien toque el
código.

---

## Lo que hace falta para correrlas

1. **Google Chrome instalado.** Se busca solo en los sitios de siempre. Si lo
   tienes en otro lado:

       CHROME="D:/ruta/a/chrome.exe" node pruebas/e2e-asistencia.mjs

2. **puppeteer-core**, que es la biblioteca que maneja ese Chrome. Ya está
   instalada en esta computadora (en `C:/Users/carlo/node_modules`). En una
   máquina nueva:

       npm i -g puppeteer-core

3. **Node**, que ya lo usas para todo lo demás.

4. Para la limpieza de Protección Civil (solo si le pides escribir), la clave de
   servicio de Firebase, que está en `C:/Users/carlo/Documents/Alcaldia BDD/`.

No hace falta instalar ninguna biblioteca de pruebas: no se usa ninguna.

---

## 1. Control de asistencia — `salud/pruebas/e2e-asistencia.mjs`

    cd C:/Users/carlo/Documents/salud
    node pruebas/e2e-asistencia.mjs

**No escribe nada. Ni un marcaje, ni una fila, ni una cuenta.** Se puede correr
contra producción con toda tranquilidad, a cualquier hora.

Comprueba tres cosas:

- **El selector Farmacia / Asistencia** de la barra azul, en tres pantallas: la
  computadora en modo claro, la computadora en modo oscuro y el teléfono de
  375 px. Mira que se vea, que no se salga de la pantalla, que los botones se
  puedan tocar con el dedo y que al cambiar de sistema de verdad cambie la
  pantalla. Ese selector es la **única puerta** al control de asistencia: si se
  rompe, el módulo queda inalcanzable aunque por dentro esté perfecto.

  Para mirarlo sin tener que entrar con una cuenta real, la prueba enciende a
  mano el panel. Entonces la base **niega** los datos, que es justo lo correcto,
  y la prueba lo comprueba como un candado más.

- **Los candados de distancia**, contra la base de verdad. Simula a una persona
  parada en la puerta, a media distancia, a un kilómetro y a cinco kilómetros, y
  también a alguien cuyo GPS se equivoca por kilómetros. Todo con
  `asis_donde_estoy`, que calcula pero **no guarda**. Las distancias se arman a
  partir del radio que declara la propia sede, así que si mañana se cambia el
  radio en la configuración, la prueba sigue valiendo sin tocarla.

  A propósito **no** se prueban `asis_marcar_entrada` ni `asis_marcar_salida`:
  esas sí escriben y meterían un marcaje falso en el historial de una persona
  real. Eso se prueba a mano con el teléfono, una vez.

- **Entrar con cédula**, como hace la aplicación del teléfono. Comprueba que una
  cédula inventada (`12345678`, que no existe y no es de nadie) **no** entra.

  Si además quieres comprobar que una persona real sí entra, pásale la cédula y
  la clave por variables de entorno — nunca escritas en un archivo, porque este
  repositorio es público:

      CEDULA_PRUEBA=XXXXXXXX CLAVE_PRUEBA=XXXXXX node pruebas/e2e-asistencia.mjs

  Eso también es solo lectura: `asis_login` consulta, no guarda.

- **Que las tablas sigan cerradas** a la clave pública. La clave anónima está a
  la vista de cualquiera dentro de la página; si una de esas tablas se abriera,
  cualquiera podría bajarse el listado del personal.

Por omisión prueba **esta carpeta servida en local**, que es lo que hay que
revisar antes de publicar. Para probar el sitio ya publicado:

    PUBLICADO=si node pruebas/e2e-asistencia.mjs

---

## 2. Formulario público con fotos — `protcivil/pruebas/e2e-fotos.mjs`

    cd C:/Users/carlo/Documents/protcivil
    node pruebas/e2e-fotos.mjs

Así como está arriba, **no escribe nada**: ni manda el reporte ni sube fotos a
Cloudflare. Se puede correr cuando sea.

Abre `reportar-riesgo.html` en una pantalla de teléfono de 375 px y comprueba:

- Que la página se vea bien en el teléfono: sin barrido lateral, con los campos
  de al menos 44 px de alto (si son más chicos no se aciertan con el dedo) y con
  letra de al menos 16 px (con menos, el iPhone hace zoom solo al tocar el campo
  y la persona pierde de vista el formulario).
- Que el botón **"+"** de verdad abra el selector de fotos.
- Que **dos toques rápidos no metan 11 fotos**. Este error pasó de verdad:
  encoger una foto tarda segundos en un teléfono modesto, la persona tocaba el
  "+" otra vez creyendo que no había pasado nada, y entraban 11. La base solo
  acepta 10, así que la foto de más hacía rebotar el reporte entero, en silencio.
- Que al quitar una foto y reponerla no se duplique ni se pierda ninguna.
- Que las fotos que no sirven **avisen en cristiano** y suelten el sitio que
  habían reservado: las HEIC del iPhone, un archivo que no es imagen aunque diga
  que lo es, y una foto de más de 25 MB.
- Que al enviar pida, uno por uno, el nombre del propietario, la dirección
  exacta, y el nombre y el teléfono de quien reporta.

Las fotos de prueba **se dibujan en el navegador con un lienzo**, al vuelo. La
prueba no depende de ningún archivo suelto que alguien pueda borrar.

### Cuándo sí toca producción

| Variable | Qué pasa |
|---|---|
| *(nada)* | No escribe nada. La subida de fotos se contesta dentro de la propia prueba con una dirección falsa. |
| `PERMITIR_ESCRIBIR=si` | **Manda un reporte de verdad** al nodo `pc_informes` de la base real, y al terminar lo borra. |
| `SUBIR_FOTOS_REALES=si` | **Sube fotos de verdad** a Cloudflare R2. Ojo con esto (ver abajo). |

    PERMITIR_ESCRIBIR=si node pruebas/e2e-fotos.mjs

El borrado del reporte va en un `finally`: se ejecuta **aunque la prueba se caiga
a la mitad**, no al final. Borra todos los reportes cuyo propietario diga
"PRUEBA AUTOMATICA". Y si no encuentra la credencial de administrador, **se
niega a escribir**, porque si no podría borrar después no debe escribir.

> ⚠️ **`SUBIR_FOTOS_REALES=si` deja basura para siempre.** El Worker de fotos no
> tiene forma de borrar: solo sabe guardar y devolver. Lo que se suba se queda en
> el depósito `pc-fotos` y hay que quitarlo a mano desde el panel de Cloudflare.
> Por eso, por omisión, la subida se simula: así se prueba **toda** la lógica de
> la página (encoger, reservar el sitio, pintar, validar) sin ensuciar nada.

### Contra qué sitio prueba

Por omisión prueba el **sitio publicado**, y antes espera hasta dos minutos a que
GitHub Pages termine de publicar (si no, tocar el código y probar enseguida daba
un fallo falso). Para probar la carpeta tal como está, sin publicar:

    LOCAL=si node pruebas/e2e-fotos.mjs

O una dirección concreta:

    BASE=http://127.0.0.1:8080 node pruebas/e2e-fotos.mjs

---

## Cómo se leen los resultados

Las dos imprimen lo mismo que las pruebas unitarias: un ✓ por cada cosa que
salió bien, un ✗ por cada una que salió mal, y al final un resumen.

- **Termina en 0** → todo bien.
- **Termina en 1** → algo falló (y abajo dice qué esperaba y qué dio).
- **Termina en 2** → no se pudo ni empezar: falta Chrome, falta puppeteer-core,
  falta el SQL de asistencia en Supabase, o se pidió escribir sin poder limpiar
  después.

Las líneas con `·` son pruebas **saltadas a propósito** (por ejemplo, el envío
real cuando no se dio permiso). No son fallos, pero conviene mirarlas: dicen qué
se quedó sin comprobar.

---

## Ningún dato de personas reales

En estas pruebas no hay ni una cédula, ni un nombre, ni un teléfono de nadie:

- Cédula `12345678` — inventada, no existe.
- Teléfonos `0424-1234567` y `0414-7654321` — inventados.
- Todos los nombres empiezan por **PRUEBA AUTOMATICA**, que además es la marca
  que usa la limpieza para saber qué borrar.

Los dos repositorios son **públicos**: aquí no se escribe ninguna clave ni ningún
token. Lo que haga falta se pasa por variable de entorno en el momento de correr
la prueba.
