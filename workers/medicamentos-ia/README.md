# Consulta de disponibilidad con Workers AI

Servicio de Salud para Administración e Inventario. Un campo recibe el medicamento;
el botón busca existencias utilizables y ordena opciones documentadas con Workers AI.
No busca libremente en Internet ni prescribe. La bibliografía internacional del
módulo sigue disponible aunque no haya stock o falle la IA.

## Referencias y límites clínicos

El build reutiliza las reglas y referencias públicas de la misma web: guía piloto
con fuentes NHS/FDA/MedlinePlus y relaciones explícitas OMS. El modelo solo devuelve
identificadores de opciones autorizadas. El servidor rechaza medicamentos inventados,
duplicados y propiedades adicionales; la interfaz muestra los hechos de las fuentes,
nunca texto clínico generado sin verificar. No recibe datos de pacientes.

Las alternativas automáticas del piloto se limitan a perfiles confirmados y formas
orales sólidas compatibles con la vía explícita de la referencia. Otras vías,
fórmulas, marcas o recubrimientos sin confirmar conservan la consulta bibliográfica
pero no se presentan como sustituciones. Cada cambio necesita valoración profesional.

## Autenticación y existencias

Se verifica el token Supabase del solicitante y su perfil activo de farmacia
(`admin` o `inventario`). Las lecturas usan ese mismo token y respetan RLS; el
servicio no utiliza `service_role`. CORS se limita al dominio Salud.

Cada consulta relee productos y lotes completos con paginación, límites y recuento
verificado. Excluye productos inactivos, insumos, saldos inconsistentes y lotes
retenidos, vencidos o sin fecha válida. Si falla la lectura, devuelve error y no
reutiliza cantidades anteriores. No escribe en las tablas de farmacia.

## Caché y cuotas

La base D1 exclusiva guarda rankings durante siete días. La clave incluye consulta,
composición e identidad de candidatos, referencias, modelo y versión del prompt.
No guarda cantidades, tokens ni pacientes. Las cantidades se verifican en cada
petición, incluso si el ranking viene de caché. Un agotado ya no aparece como opción
disponible. Los registros vencidos se limpian después de las consultas.

Máximo diez intentos nuevos de IA por día UTC, con reserva atómica y máximo seis
consultas por usuario y minuto. Las respuestas de caché no gastan inferencias. Un
fallo del modelo o cuota agotada devuelve las opciones documentales, identificado
como tal. El contexto se limita a 12 000 bytes y la salida a 256 tokens.

Se reutiliza la cuenta municipal de Tecnología y su plan existente, sin activar
suscripciones. El límite reduce consumo; no garantiza gratuidad si otros servicios
de la cuenta agotan la asignación compartida de Workers AI.

## Operación

- Configuración no secreta en `wrangler.jsonc`; bindings `AI` y `BD`.
- Configurar `SUPABASE_ANON_KEY` con `wrangler secret put` o la API oficial de
  secretos desde su fuente local. No introducir tokens administrativos en el cliente.
- Crear primero la D1 y aplicar `migraciones/0001_cache.sql` (idempotente).
- Ejecutar `node scripts/preparar-referencias.mjs` y `node pruebas/servicio.mjs`
  desde esta carpeta. Las pruebas usan SQLite en memoria y datos ficticios.
- Publicar primero el Worker con Wrangler y comprobar autenticación, inferencia
  real y segunda consulta de caché; después publicar el cliente de Salud.
- Tras cambiar las referencias, regenerar y publicar también este servicio.
- `MAX_INFERENCIAS_DIARIAS=0` desactiva inferencias nuevas y conserva consultas
  documentales y respuestas válidas de caché. El techo en código es diez.

Fuentes técnicas: [Workers AI](https://developers.cloudflare.com/workers-ai/),
[JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/),
[precios y asignación compartida](https://developers.cloudflare.com/workers-ai/platform/pricing/).
