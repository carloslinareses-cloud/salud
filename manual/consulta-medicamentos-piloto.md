# Consulta de medicamentos · piloto

## Revisión analítica del 17 de octubre

La búsqueda conserva un campo único en Inventario y Administración. Ahora distingue **otros nombres del mismo principio**, **coincidencias de principio/concentración/forma** y **opciones de otro principio para valoración profesional**. No declara bioequivalencia ni compatibilidad individual de pacientes.

El caso comunicado por Carlos era aspirina: buscar `aspirina`, `AAS`, `ASA`, `ácido acetilsalicílico`, `Asaprol` o `Caloxpirina` relaciona los nombres de las fórmulas simples documentadas. Se conservan nombres, concentraciones y presentaciones originales del inventario. Buscar 81 mg no mezcla registros de 100 mg. Los envases de Caloxpirina y Asaprol confirman 81 mg y recubrimiento entérico; no se presupone que otras tabletas tengan el mismo recubrimiento. Aspirina Plus y otras combinaciones no se tratan como aspirina simple. No se propone reemplazar aspirina antiagregante por analgésicos. También se relacionan paracetamol/acetaminofén y metamizol/dipirona sin equiparar vías, sales o formulaciones.

La guía incluye criterios documentados para dolor/fiebre, alergia, inhibidores de ácido gástrico y estatinas. Las opciones de distinto principio llevan indicación, límites y fuente visibles. No se calculan dosis equivalentes. No se generalizan sustituciones entre antibióticos, anticoagulantes, antiepilépticos u otros tratamientos fuera de los criterios documentados. Los términos desconocidos después de un principio activo bloquean la comparación en vez de ignorarse.

La disponibilidad distingue **Disponible**, **Sin existencia utilizable**, **No registrado en inventario** y **Existencia por confirmar**. El agotamiento no elimina referencias. Un nombre no evaluado o una presentación incompleta se explican como tales; no se afirma que no exista un tratamiento. Las referencias no crean productos ni movimientos en la base. Fuentes y precauciones se incluyen en el módulo. La guía sigue siendo acotada y no exhaustiva.

Además, Corregir existencia permite buscar por nombre del medicamento o número de lote, conserva los filtros y la paginación y no modifica existencias al buscar. Administración tiene acceso a la misma pantalla mediante Corregir existencia, conservando una única hoja y sus cambios pendientes.

Las secciones siguientes describen las etapas anteriores del piloto; esta revisión actualiza los estados y la interpretación de sus resultados.

Se abre en **Mercancía (Inventario) → Consulta de medicamentos** y en **Administración → Consulta de medicamentos**. La pantalla tiene un solo campo: escribir el nombre del medicamento. Las opciones disponibles aparecen directamente debajo, o «No hay». Ambas entradas utilizan el mismo módulo y las mismas tablas de Salud. No genera PDF, modifica inventario, prescribe ni registra entregas.

Corrección del 17/10/2026 solicitada por Carlos: retiro de esta consulta las tablas del inventario, cifras, filtros, selector de tipo, casilla de opciones, paginación y fichas de lotes. El inventario existente continúa en Catálogo. Las comprobaciones de composición y existencias permanecen internas; las fuentes y precauciones se pueden ampliar en «Información de la consulta».

Ampliación del mismo día: las opciones documentadas se muestran **con y sin existencia**. Agotarse no elimina el medicamento de la lista de referencia. Las opciones de otros registros del catálogo se calculan conservando concentración y vía; una guía independiente permite consultar también medicamentos de referencia que nunca han figurado en el inventario. Cada resultado lleva **Disponible** o **Sin existencia**. Disponible requiere un lote positivo, vigente y con información suficiente; Sin existencia incluye también ausencia en el catálogo o falta de una presentación verificada utilizable. No afirma que el producto exista comercialmente en otra farmacia o en Venezuela. No se añaden productos ficticios a la base: las referencias solo existen en memoria y en el archivo de criterios.

El catálogo completo y todos sus lotes se leen por páginas verificando el total exacto. Al entrar y cada 30 segundos mientras la consulta está visible, se vuelven a leer `productos` y `v_existencia_lote`. Si la lectura falla o cambia la cantidad durante la paginación, se retiran las propuestas y aparece Reintentar.

El corte de revisión del 17/10/2026 contiene 419 registros y 546 lotes. La clasificación visual identifica 74 insumos y 345 medicamentos o fórmulas que requieren identificación; no cambia la categoría original, que actualmente llama medicamento también a muchos insumos. Las cantidades son por registro y por su unidad; no se suman presentaciones o dosis diferentes ni se confunden registros con principios activos únicos.

## Cómo se determina la existencia

- **Vigente:** saldo positivo de un lote disponible, con fecha de vencimiento conocida igual o posterior al día de Venezuela.
- **Vencida:** saldo de lotes disponibles cuya fecha ya pasó.
- **Sin fecha:** no se cuenta como disponible hasta verificar el vencimiento.
- **Retenida / dada de baja:** no se cuenta como disponible.
- Los saldos negativos bloquean las propuestas para el producto afectado. Un registro sin lotes conserva existencia cero, sin desaparecer del catálogo.

La existencia vigente es una comprobación de saldo y fecha; no confirma por sí sola calidad, conservación, identidad física ni aptitud para un paciente.

## Lectura de los resultados

- **Lista de opciones:** aparecen directamente los nombres y presentaciones de opciones documentadas, bajo la presentación consultada, con Disponible o Sin existencia. Los disponibles se ordenan primero; los duplicados de principio, fuerza y forma no se repiten y conservan la etiqueta del registro utilizable.
- **No hay:** la guía no tiene otra opción verificada para esa consulta; no significa simplemente que el almacén esté vacío ni que no exista un tratamiento médico fuera del alcance de la guía.
- **No se pueden confirmar opciones:** fórmula, concentración o vía incompleta o contradictoria; no se inventan datos de las etiquetas.

Solo se comparan principios expresos. Paracetamol y acetaminofén se reconocen como el mismo principio. La fuerza, forma y vía deben concordar para mostrar una referencia del mismo medicamento. Una concentración en gramos puede normalizarse a miligramos; nunca se convierten números de tabletas, dosis a administrar o pautas de tratamiento. Los jarabes y suspensiones necesitan concentración explícita en mg/ml. Las cremas necesitan porcentaje expreso. No se infieren vías para inyectables o gotas. Las formulaciones modificadas y combinaciones se excluyen.

La opción adicional de referencia clínica se limita a algunos analgésicos orales para dolor o fiebre en adultos y a antihistamínicos orales documentados para síntomas alérgicos en adultos. La guía independiente incluye paracetamol, ibuprofeno, naproxeno, diclofenaco, cetirizina, loratadina, fexofenadina y acrivastina. Permite buscar estos nombres aunque no estén en el catálogo; no introduce concentraciones o pautas inventadas. Es una lista para valoración profesional, no una autorización de sustitución ni una lista exhaustiva de todos los tratamientos posibles. No se equipara efecto analgésico con antiinflamatorio ni se indica combinar AINE. Se advierten los factores que debe revisar el profesional. No se proponen moléculas distintas para antibióticos, anticoagulantes, antiepilépticos o tratamientos crónicos.

Torsilax contiene diclofenaco, paracetamol, carisoprodol y cafeína; no se incluye como reemplazo simple del diclofenaco. El nombre escrito «Torcilax» requiere verificar el producto real.

## Referencias y límites

Los criterios se contrastaron con las fuentes siguientes el 17/10/2026. Estas referencias no certifican intercambiabilidad regulatoria de productos venezolanos ni sustituyen un protocolo aprobado por el equipo clínico de Salud.

- [FDA: requisitos de medicamentos genéricos](https://www.fda.gov/drugs/generic-drugs/generic-drugs-questions-answers)
- [NHS: diclofenaco y otras opciones analgésicas](https://www.nhs.uk/medicines/diclofenac/common-questions-about-diclofenac/)
- [NHS: precauciones de AINE](https://www.nhs.uk/medicines/nsaids/)
- [NHS: antihistamínicos](https://www.nhs.uk/medicines/antihistamines/)
- [Fabricante Neo Química: composición de Torsilax](https://www.neoquimica.com.br/nossas-marcas/bula/torsilax)

Para ampliar las reglas o proponer otros tratamientos se requiere revisión clínica específica. El código y las fuentes de este piloto permanecen separados del catálogo original. Las pruebas cubren datos contradictorios, combinaciones, formulaciones, concentraciones, lotes, paginación, permisos de entrada y fallos de carga. La comprobación de navegador consulta el inventario real desde una sesión temporal administrativa y solo realiza lecturas de medicamentos; no crea pacientes, movimientos, entregas ni productos.
