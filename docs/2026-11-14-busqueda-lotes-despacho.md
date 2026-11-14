# Búsqueda por lote para Despacho

Los usuarios con rol Despacho tienen la opción **Buscar por lote**, junto a Entregar, Catálogo y Buscar medicamentos.

1. Abrir Buscar por lote.
2. Escribir el número completo del lote o una parte y pulsar Buscar. También se consulta al terminar de escribir.
3. Revisar medicamento, presentación, código, vencimiento, existencia y estado. Ver lotes abre el detalle de los lotes del mismo medicamento. En móvil, la tabla se desplaza horizontalmente para consultar todas las columnas.

La consulta distingue lotes vencidos, sin existencia, dados de baja o con datos por confirmar. No selecciona un lote para entregar ni cambia existencias. El registro de entrega conserva su flujo y su validación originales.

Se mantienen montadas las pantallas al cambiar de opción: volver a Entregar conserva el formulario y regresar a Buscar por lote conserva la consulta. Los resultados se paginan de 25 en 25. Una consulta vacía, sin coincidencias o con error se identifica con su mensaje; se puede reintentar y las respuestas anteriores no sustituyen una búsqueda más reciente.

## Alcance técnico

- Se consulta `farmacia.v_existencia_lote` con la sesión y los permisos existentes de Despacho. No se cambian perfiles, políticas ni funciones SQL.
- El filtro se aplica al código de lote mediante `ilike`, sin construir expresiones OR con texto introducido por el usuario. Los comodines SQL se escapan y los datos mostrados se codifican como texto.
- La pantalla solo ofrece consultas: no contiene controles para ajustar, guardar o borrar inventario.
- Las revisiones de `app.js` y `lotes-medicamentos.js` en el HTML se actualizan a `20261114-despacho-lotes`.

## Comprobación

`node pruebas/lotes-medicamentos.mjs` y `node pruebas/sesiones-unitarias.mjs` pasan. La prueba `node pruebas/busqueda-lotes-despacho-browser.mjs --local` usa una cuenta existente de Despacho y comprueba:

- Lote real, códigos parciales, minúsculas, caracteres especiales y paginación.
- Detalle de lotes, ausencia de coincidencias, error simulado y recuperación.
- Conservación de las pantallas al alternar con Entregar.
- Escritorio y móvil, claro y oscuro, acceso con teclado y ausencia de desborde de la página.

Sin `--local` se comprueba la publicación real. Las sesiones de prueba son temporales y se cierran con alcance local; las escrituras REST de negocio se bloquean. No se crean usuarios, pacientes, entregas ni ajustes para estas comprobaciones.
