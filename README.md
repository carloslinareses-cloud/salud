# Farmacia — Alcaldía del Municipio Bolivariano Cristóbal Rojas

Control de inventario de la farmacia municipal.

- **Sitio:** https://salud.alcaldiadecharallave.com
- **Qué hace:** registra la mercancía que entra, descuenta lo que se entrega y
  mantiene la existencia al día por producto y por lote.

## Perfiles de usuario

| Perfil | Qué puede hacer |
|---|---|
| Administrador | Crea y desactiva usuarios, ve todo, revisa la auditoría |
| Inventario | Registra la mercancía que llega, crea productos y lotes |
| Despacho | Entrega medicamentos y descuenta del stock, consulta existencias |

## Cómo se publica

Sitio estático en GitHub Pages. Al hacer `git push origin main` se publica solo.

## Pruebas

Viven en la carpeta `pruebas/`. **Córrelas antes de publicar.** No hacen falta
bibliotecas: se corren con Node a secas, desde la carpeta del proyecto.

### Pruebas unitarias (rápidas, no tocan la base de datos)

Son las que hay que correr siempre. Tardan un segundo y no necesitan internet,
ni claves, ni tocar nada de producción.

```bash
cd C:/Users/carlo/Documents/salud
node pruebas/unitarias.mjs              # funciones compartidas (comunes.js)
node pruebas/asistencia-unitarias.mjs   # control de asistencia (asistencia.js)
```

| Archivo | Qué cuida |
|---|---|
| `pruebas/unitarias.mjs` | Fechas, cédulas, nombres de medicamentos, vencimientos de lotes, períodos del tablero y la hora de Caracas. |
| `pruebas/asistencia-unitarias.mjs` | Que lo que se pinta en pantalla vaya limpio (`esc`), los mensajes de error en cristiano, la clave que se le sugiere a cada persona, los metros del GPS, que los reportes se traigan **todas** las filas y no las primeras mil, la hora de Venezuela, y que la pantalla de asistencia diga los mismos números que `sql/25-asistencia.sql`. |

Si todo está bien terminan diciendo `Pasaron las N pruebas.` Si algo falla,
imprimen qué esperaban y qué dio, y salen con error (sirve para un `&&`).

**Cuando una prueba falle, el sospechoso es el código, no la prueba.** Cada
bloque de pruebas lleva escrito arriba qué error real evita; léelo antes de
cambiar nada.

Las páginas son HTML y JavaScript sueltos, sin módulos: para poder probar una
función que vive dentro de un archivo como `asistencia.js`, las pruebas sacan su
texto del archivo de verdad y lo evalúan. Por eso **nunca hay que pegar una
copia de la función dentro de la prueba**: una copia seguiría pasando aunque el
original se rompa.

### Pruebas de punta a punta (lentas, contra el sitio real)

Manejan el navegador de verdad (Puppeteer) o llaman a la API de Supabase.
Necesitan credenciales y crean datos de prueba —todo lo que crean empieza por
`ZZZ` y lo borran al terminar—. Se corren solo cuando se toca la pantalla que
prueban:

```bash
npm install puppeteer-core
node pruebas/ciclo-admin.mjs      # el ciclo completo: crear, entregar, auditar
node pruebas/personas.mjs         # fichas, patologías y medicinas
node pruebas/tablero-tratamiento.mjs
node pruebas/reportes.mjs
node pruebas/centros.mjs
node pruebas/e2e-asistencia.mjs   # control de asistencia, con Chrome de verdad
python pruebas/e2e.py             # permisos y candados contra la API (pide SUPABASE_TOKEN)
```

Lo que necesita cada una (Chrome, cédula de prueba, si va contra el sitio
publicado) está explicado en `pruebas/LEEME-e2e.md`.

### Cómo saber si las pruebas sirven de algo

Una prueba que pasa siempre no cuida nada. La forma de comprobarlo es
**romper el código a propósito** y ver que se ponga en rojo: invierte una
comparación, cambia un número, quita una rama. Si todo sigue en verde, la
que está mal es la prueba. **Deja el código como estaba después.**

Así se encontraron tres huecos que ya están tapados: la pantalla llegaba a
escribir `a null m del sitio` sin que nadie se quejara; la `esc()` de
`asistencia.js` —que es una copia propia, distinta de la de `comunes.js`—
no la miraba ninguna prueba; y `porTandas()`, que es lo que hace que un
reporte traiga todas las filas y no las primeras mil, tampoco.
