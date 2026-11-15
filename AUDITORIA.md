# Revisión de Asclepio · versión 24

Revisión del 14 de noviembre de 2026: código, navegación y guardado con Supabase simulado; permisos SQL en Postgres 16 local. No se inspeccionó ni modificó la base de producción.

## Cambios y fallos corregidos

| Área | Hallazgo y solución |
| --- | --- |
| Alimentos | Los campos numéricos dependían del idioma del navegador. Cantidades, porciones, macros y micros aceptan coma o punto, sin reformatear mientras se escribe. Los valores inválidos y porciones incompletas se bloquean antes de guardar. |
| Objetivos | La calculadora mostraba todos los pasos a la vez. Ahora presenta datos, objetivo y revisión por separado. La propuesta se transfiere a los campos editables y requiere guardar; el estado pendiente se muestra explícitamente. |
| Cálculo | Se rechazaron datos fuera de rango y edades no adultas para la fórmula de metas. El redondeo ya no puede dejar las calorías por debajo del piso calculado. Se compara la propuesta completa, no solo sus calorías. |
| Historial de metas | Antes se ignoraban errores al guardar el historial. Ahora se informa el fallo y se permite reintentar. Al crear el primer historial se conserva una base con las metas previas. Perfil e historial siguen siendo dos escrituras: un fallo parcial se informa explícitamente. |
| Sueño | Se impedirá guardar horas vacías, intervalos nulos o mayores a 16 h y minutos despierto inválidos. Estos minutos se descuentan de la duración. Al editar se eliminan resultados derivados antiguos antes de recalcular. |
| Teléfono | El intervalo entre dejar el teléfono y dormir no es una medición clínica de latencia; la interfaz y el reporte ahora lo describen correctamente. Se mantiene la clave histórica para compatibilidad. |
| Semana de sueño | Puntaje orientativo propio, con componentes visibles y mínimo de 3 noches completas. No suma al ranking. Las noches sin registrar no se califican. Referencia por edad y detalle al tocar las barras. |
| Ranking | Se paginan los puntos; ya no se corta el total al superar el límite de respuesta. |
| Peso | Protección contra doble toque al guardar y recuperación tras eliminar, sin reemplazar un peso nuevo del mismo día. |
| Otros | Decimales en electrolitos; errores de creación del perfil visibles; caché de módulos y CSS en versión 24. |
| Privacidad | El SQL anterior permitía leer metas ajenas y actualizar rachas propias. La migración limita perfiles al propietario, ofrece una vista del ranking de solo lectura y limita las columnas actualizables. Los triggers siguen escribiendo las rachas y los puntos. |

El catálogo de alimentos sigue compartido: los tres pueden encontrar y registrar alimentos creados por cualquiera. No se cambiaron sus políticas de edición. Peso, perfil físico, metas históricas, hábitos, comida y actividad conservan sus políticas por usuario.

## Sueño: interpretación y fuentes

La puntuación no es un instrumento clínico validado ni una medición de fases del sueño. Es una regla de la app: duración hasta 50 puntos, regularidad hasta 30 y calidad declarada hasta 20. El detalle de la regla está dentro de Sueño. La regularidad usa distancias circulares entre horas para tratar correctamente medianoche.

Las recomendaciones se limitan a hábitos de horario, luz, cafeína, pantallas y ambiente; no se añadieron suplementos ni tratamientos. Fuentes consultadas y enlazadas dentro de la app:

- [CDC: About Sleep](https://www.cdc.gov/sleep/about/).
- [Huberman Lab: Toolkit for Sleep](https://www.hubermanlab.com/newsletter/toolkit-for-sleep).

## Aplicación en Supabase

Ejecutar **solo `sql/privacidad_perfiles.sql`**, después de las migraciones existentes (`schema`, `fase2`, `fase2b`, `puntos`, `fase3`). No hace falta volver a ejecutar esas migraciones anteriores. La nueva migración no borra datos y admite repetición.

El frontend usa `ranking_profiles` y conserva una alternativa compatible mientras esa vista todavía no existe. **La privacidad de las metas no cambia en producción hasta ejecutar el SQL.**

## Verificación

- `node --check` de todos los archivos de `js/`.
- `tests/mobile.cjs`: Chromium con viewport 390×844, eventos de entrada reales sobre formularios, Supabase sustituido en memoria y servidor Python local. Comprueba valores guardados, cálculos, errores, estado pendiente, navegación y consola.
- `tests/privacy.sql`: Postgres 16 aislado, roles `authenticated` y `anon`, dos usuarios simulados. Verifica lectura privada, catálogo compartido, ranking visible, escrituras de rachas y puntos bloqueadas y triggers operativos. Migración ejecutada dos veces.
- Inspección de capturas de Datos, calculadora y Sueño. No reemplaza una prueba en un iPhone físico ni comprueba entrega de correos, configuración SMTP o políticas que se hayan modificado directamente en producción.

Para repetir las pruebas móviles: iniciar `python -m http.server 8765 --bind 127.0.0.1` y ejecutar `node tests/mobile.cjs` con Playwright disponible externamente. Se admite `NODE_PATH` para el runtime y `CHROME_PATH` para un Chromium instalado; no se agrega npm ni un build a la app. `SCREENSHOT_DIR` es opcional.
