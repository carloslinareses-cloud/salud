# Consulta de medicamentos · piloto

Se abre en **Mercancía (Inventario) → Consulta de medicamentos** y en **Administración → Consulta de medicamentos**. La pantalla tiene un solo campo: escribir el nombre del medicamento. Las opciones disponibles aparecen directamente debajo, o «No hay». Ambas entradas utilizan el mismo módulo y las mismas tablas de Salud. No genera PDF, modifica inventario, prescribe ni registra entregas.

Corrección del 17/10/2026 solicitada por Carlos: retiro de esta consulta las tablas del inventario, cifras, filtros, selector de tipo, casilla de opciones, paginación y fichas de lotes. El inventario existente continúa en Catálogo. Las comprobaciones de composición y existencias permanecen internas; las fuentes y precauciones se pueden ampliar en «Información de la consulta».

El catálogo completo y todos sus lotes se leen por páginas verificando el total exacto. Al entrar y cada 30 segundos mientras la consulta está visible, se vuelven a leer `productos` y `v_existencia_lote`. Si la lectura falla o cambia la cantidad durante la paginación, se retiran las propuestas y aparece Reintentar.

El corte de revisión del 17/10/2026 contiene 419 registros y 546 lotes. La clasificación visual identifica 74 insumos y 345 medicamentos o fórmulas que requieren identificación; no cambia la categoría original, que actualmente llama medicamento también a muchos insumos. Las cantidades son por registro y por su unidad; no se suman presentaciones o dosis diferentes ni se confunden registros con principios activos únicos.

## Cómo se determina la existencia

- **Vigente:** saldo positivo de un lote disponible, con fecha de vencimiento conocida igual o posterior al día de Venezuela.
- **Vencida:** saldo de lotes disponibles cuya fecha ya pasó.
- **Sin fecha:** se informa aparte y se excluye de las propuestas hasta verificar el vencimiento.
- **Retenida / dada de baja:** se informa aparte y se excluye de las propuestas.
- Los saldos negativos bloquean las propuestas para el producto afectado. Un registro sin lotes conserva existencia cero, sin desaparecer del catálogo.

La existencia vigente es una comprobación de saldo y fecha; no confirma por sí sola calidad, conservación, identidad física ni aptitud para un paciente.

## Lectura de los resultados

- **Lista de opciones:** aparecen directamente los nombres y presentaciones de otros registros contemplados en los criterios de referencia y con existencia vigente, bajo la presentación consultada.
- **No hay:** el piloto no encuentra otra opción de referencia disponible. No significa que no exista un tratamiento médico fuera del alcance del piloto.
- **No se pueden confirmar opciones:** fórmula, concentración o vía incompleta o contradictoria; no se inventan datos de las etiquetas.

Solo se comparan principios expresos. Paracetamol y acetaminofén se reconocen como el mismo principio. La fuerza, forma y vía deben concordar para mostrar una referencia del mismo medicamento. Una concentración en gramos puede normalizarse a miligramos; nunca se convierten números de tabletas, dosis a administrar o pautas de tratamiento. Los jarabes y suspensiones necesitan concentración explícita en mg/ml. Las cremas necesitan porcentaje expreso. No se infieren vías para inyectables o gotas. Las formulaciones modificadas y combinaciones se excluyen.

La opción adicional de referencia clínica se limita a algunos analgésicos orales para dolor o fiebre en adultos y a cetirizina/loratadina para síntomas alérgicos en adultos. Es una lista para valoración profesional, no una autorización de sustitución. No se equipara efecto analgésico con antiinflamatorio ni se indica combinar AINE. Se advierten los factores que debe revisar el profesional. No se proponen moléculas distintas para antibióticos, anticoagulantes, antiepilépticos o tratamientos crónicos.

Torsilax contiene diclofenaco, paracetamol, carisoprodol y cafeína; no se incluye como reemplazo simple del diclofenaco. El nombre escrito «Torcilax» requiere verificar el producto real.

## Referencias y límites

Los criterios se contrastaron con las fuentes siguientes el 17/10/2026. Estas referencias no certifican intercambiabilidad regulatoria de productos venezolanos ni sustituyen un protocolo aprobado por el equipo clínico de Salud.

- [FDA: requisitos de medicamentos genéricos](https://www.fda.gov/drugs/generic-drugs/generic-drugs-questions-answers)
- [NHS: diclofenaco y otras opciones analgésicas](https://www.nhs.uk/medicines/diclofenac/common-questions-about-diclofenac/)
- [NHS: precauciones de AINE](https://www.nhs.uk/medicines/nsaids/)
- [NHS: antihistamínicos](https://www.nhs.uk/medicines/antihistamines/)
- [Fabricante Neo Química: composición de Torsilax](https://www.neoquimica.com.br/nossas-marcas/bula/torsilax)

Para ampliar las reglas o proponer otros tratamientos se requiere revisión clínica específica. El código y las fuentes de este piloto permanecen separados del catálogo original. Las pruebas cubren datos contradictorios, combinaciones, formulaciones, concentraciones, lotes, paginación, permisos de entrada y fallos de carga. La comprobación de navegador consulta el inventario real desde una sesión temporal administrativa y solo realiza lecturas de medicamentos; no crea pacientes, movimientos, entregas ni productos.
