# Búsqueda por lote para Despacho

Los usuarios con rol Despacho tienen un botón destacado **Buscar por lote** al principio de la pantalla Entregar. También se mantiene la opción junto a Entregar, Catálogo y Buscar medicamentos. El botón abre la consulta y coloca el foco en el buscador.

1. Abrir Buscar por lote. Se cargan directamente los lotes registrados en Inventario.
2. Escribir el número completo del lote, una parte o el nombre del medicamento y pulsar Buscar. También se consulta al terminar de escribir. Borrar el texto muestra otra vez todos los lotes.
3. Revisar medicamento, presentación, código, vencimiento, existencia y estado. Ver lotes abre el detalle de los lotes del mismo medicamento. En móvil, la tabla se desplaza horizontalmente para consultar todas las columnas.
4. Pulsar Actualizar para consultar entradas nuevas conservando el filtro. Volver a esta pantalla desde Entregar también renueva la consulta.

La consulta distingue lotes vencidos, sin existencia, dados de baja o con datos por confirmar. No selecciona un lote para entregar ni cambia existencias. El registro de entrega conserva su flujo y su validación originales.

Se mantienen montadas las pantallas al cambiar de opción: volver a Entregar conserva el formulario y regresar a Buscar por lote conserva el filtro y vuelve a leer Inventario. Los resultados se paginan de 25 en 25. No tener lotes, una búsqueda sin coincidencias y un fallo de lectura se distinguen por su mensaje; se puede reintentar y las respuestas anteriores no sustituyen una búsqueda más reciente.

## Alcance técnico

- Se consulta `farmacia.v_existencia_lote` con la sesión y los permisos existentes de Despacho. No se cambian perfiles, políticas ni funciones SQL.
- El filtro consulta código o nombre mediante `ilike`. Se escapan los comodines SQL y se entrecomillan los valores del filtro OR según la gramática de PostgREST, escapando también comillas y barras. Los datos mostrados se codifican como texto.
- La pantalla solo ofrece consultas: no contiene controles para ajustar, guardar o borrar inventario.
- El HTML carga `app.js?v=20261114-boton-lote` y `lotes-medicamentos.js?v=20261114-lotes-inventario`.

## Comprobación

`node pruebas/lotes-medicamentos.mjs` y `node pruebas/sesiones-unitarias.mjs` pasan. La prueba `node pruebas/busqueda-lotes-despacho-browser.mjs --local` usa una cuenta existente de Despacho y comprueba:

- Lista inicial, cinco altas recientes reales de Inventario por código y por medicamento, limpiar el filtro, códigos parciales, minúsculas, caracteres especiales y paginación.
- Detalle de lotes, ausencia de coincidencias, error simulado y recuperación.
- Conservación del formulario de Entregar y del filtro de lotes al alternar, reconsulta al regresar y botón Actualizar.
- Escritorio y móvil, claro y oscuro, acceso con teclado y ausencia de desborde de la página.

Sin `--local` se comprueba la publicación real. Las sesiones de prueba son temporales y se cierran con alcance local; las escrituras REST de negocio se bloquean. No se crean usuarios, pacientes, entregas ni ajustes para estas comprobaciones.

La auditoría de lectura del 14 de noviembre contrastó 625 lotes: todos existen en la vista, Inventario y Despacho leen los mismos registros y los cinco más recientes devuelven las mismas existencias. La regresión previa dejó reproducida la pantalla vacía al abrir. La corrección actúa sobre la búsqueda y la renovación de los resultados; no modifica los lotes guardados ni sus cantidades.
