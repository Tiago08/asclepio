# Asclepio

App personal de salud y nutrición para 3 personas (el dueño, Santiago, y 2 amigos). Registro de comida con macros y micronutrientes, gym, baño, sueño, energía y notas. Ranking de rachas entre amigos. Interfaz en español.

Estado y pendientes: página "Asclepio" en Notion (https://app.notion.com/p/40d4ce9c8a3e81079260c703657d8823). Ahí están las fases 2 y 3.

## Stack

- Frontend estático en GitHub Pages: HTML, CSS y JavaScript con módulos ES. No hay build, ni npm, ni framework. Mantenlo así.
- Supabase: Auth (código por correo), Postgres con RLS, triggers.
- Cliente Supabase cargado desde esm.sh con versión fija y en un solo archivo: `https://esm.sh/@supabase/supabase-js@2.119.0/es2022/supabase-js.bundle.mjs` (si cambia la versión, cámbiala también en el `modulepreload` de `index.html`).
- Buscador de comida con 3 pestañas: Frecuentes, Locales (tus alimentos y los básicos, máx. 8) y USDA. Lo escrito se mantiene al cambiar. Si la pestaña la eligió la app: al escribir pasa a Locales; con 0 resultados salta a USDA y con 1–2 busca en USDA por detrás (la pestaña muestra cuántos). Si la tocó el usuario, no cambia sola. Cantidad en gramos o porciones caseras, y "Agregar rápido" (kcal y macros a mano, sin crear alimento). Nada de funciones con IA (costo extra).
- USDA FoodData Central para buscar alimentos. La búsqueda se pasa a inglés con el diccionario de `js/foodDict.js` (o MyMemory si la palabra no está), y los nombres se traducen al español con MyMemory y caché en localStorage.
- PWA instalable en iPhone (manifest, apple-touch-icon, safe-area).
- Repo público (Pages gratis lo exige): Tiago08/asclepio. Sitio: https://tiago08.github.io/asclepio/

## Estructura

- `index.html`: login, pestañas (Hoy, Hábitos, Historial, Ranking, Datos), hoja inferior para formularios.
- `css/styles.css`: tema oscuro, sin bordes duros, hoja inferior, tab bar fija.
- `js/app.js`: lógica principal y pantallas. `js/auth.js`, `js/foods.js` (búsqueda, traducción y orden por relevancia), `js/foodDict.js` (diccionario español → búsqueda en inglés), `js/basics.js` (110 básicos con valores de USDA por fdcId y porciones caseras; salen primero al buscar, como los "Best Match" de MyFitnessPal), `js/activity.js`, `js/report.js`, `js/config.js`, `js/supabaseClient.js`, `js/health.js` (fase 2: metas por día, perfil físico y cálculo de metas, peso, suplementos, agua y electrolitos, combos), `js/habits.js` (fase 3: hábitos), `js/micros.js` (fase 3: metas de micronutrientes mín/meta/máx por sexo y edad, valores DRI del NIH).
- Micronutrientes: las 15 columnas fijas siguen igual; los nuevos (magnesio, zinc, B6, folato, omega-3) van en `micros` (JSONB) de `foods` y `food_logs`. Para agregar otro, súmalo a `MICRO_FIELDS` en `foods.js` (y a `basics.js` si quieres valores de los básicos), sin tocar la tabla.
- Datos privados (peso, edad, altura) van en tablas propias con RLS, nunca en `profiles` (esa tabla la ven los 3).
- Agua, suplementos y peso no cuentan para la racha (decisión de Santiago). Los hábitos no dan puntos ni cuentan para la racha (tampoco): no les pongas trigger hacia `daily_points`.
- Puntos del ranking: tabla `daily_points` (solo el total por persona y día, la ven los 3), la llenan triggers de `sql/puntos.sql`. Agua y suplementos sí dan puntos. Los valores están en `calc_day_points` (SQL) y `POINTS_INFO` (`app.js`): si cambias uno, cambia el otro. El ranking ordena por puntos de la semana (desde el lunes) o totales; sin la tabla, cae a solo rachas.
- Baño "no fui hoy" se guarda como `activity_logs` tipo `bano` con `data.fue = false` (igual que el descanso de Gym).
- Comidas: Desayuno, Almuerzo, Merienda, Cena (`MEALS` en `app.js`). "Snack" es el nombre viejo de Merienda: se acepta en la tabla y se muestra como Merienda. Hoy agrupa la comida por estas cuatro.
- Objetivo de peso: ritmo en kg/semana (`pace_kg_week` en `body_profiles`, `PACES` en `health.js`); 1 kg ≈ 7700 kcal y nunca por debajo del gasto en reposo ni de 1500/1200 kcal.
- Gym y Sueño son uno por día: tocar el mosaico con registro lo abre para editar (no crea otro). Los registros de "Otros" e Historial se tocan para editar. Todo borrado y todo registro de comida ofrece "Deshacer" en el aviso.
- Frecuentes: `searchFavorites` trae `_last` (cantidad y texto de la última vez); el chip registra eso y el paso de cantidad arranca igual. Comida vacía hoy que ayer tuvo algo muestra "↻ Repetir ayer" (usa `recentEntries`, los últimos 14 días).
- En las hojas, los botones fijos (`form-actions sticky`) van siempre al final: un enlace debajo queda tapado.
- Días anteriores: `viewDate` (app.js) es el día que se ve en Hoy y Hábitos; las flechas de la fecha de arriba van hasta `MAX_BACK_DAYS` (7) atrás, para que nadie rellene días viejos y suba en el ranking. Todo lo que se registra en Hoy usa `viewDate`, no `todayStr()`. Con un día pasado sale el aviso `.past-banner` con "Volver a hoy". Historial tiene "Abrir este día" para esos 7 días.
- Sueño: se guarda en el día en que te despiertas (como Apple Salud) y se muestra como noche: "Anoche" en el mosaico, "noche del 7 al 8 nov" en el formulario, la línea de tiempo y el reporte (`nightLabel`). No pide hora: `log_time` = hora de despertar.
- Micronutrientes: sección plegable en Hoy, cerrada por defecto (se recuerda en localStorage). Los que no traen datos van al final.
- `sql/`: esquema y migraciones que Santiago ejecuta a mano en el SQL Editor de Supabase. Orden: schema, fase2, fase2b, puntos, fase3.

## Reglas de trabajo

- Cache-busting: los imports y el CSS llevan `?v=N` (ahora `?v=20`). Cada vez que cambies archivos, sube N en todos los imports, en `index.html` y en `supabaseClient.js`. Si no, Chrome y la app instalada muestran archivos viejos. Además `app.js` compara su `?v` con el del `index.html` publicado al abrir o volver a la app y se recarga solo si hay versión nueva (por eso el `?v` de `app.js` en `index.html` siempre debe subir).
- Todo el texto visible va en español.
- Los cambios de base de datos van siempre en un archivo nuevo en `sql/`, idempotente (`if not exists`, `on conflict`, etc.). Nunca edites el esquema ya ejecutado. Al terminar, di a Santiago qué archivo ejecutar y en qué orden.
- Tablas creadas por SQL necesitan `GRANT` a `authenticated` además de las políticas RLS (ya nos mordió: "permission denied for table").
- Cada tabla de datos del usuario lleva RLS con `auth.uid() = user_id`. El ranking solo expone nombre y racha.
- La clave `sb_publishable_...` y la de USDA en `js/config.js` son públicas por diseño. Nunca uses ni escribas una clave `service_role` ni secretos en el repo.
- iPhone: los campos de entrada deben tener 16 px o más de letra (si no, iOS hace zoom). Respeta safe-area y evita `position: fixed` sin probarlo en 390x844.

## Diseño

Estilo "cuaderno de laboratorio" oscuro, cómodo y poco "encajonado", como MyFitnessPal: tarjetas redondeadas, sin bordes duros, colores por categoría, hoja inferior con fondo difuminado. No añadir elementos que sobrecarguen la pantalla Hoy.

Gestos (como iOS): la hoja inferior se cierra deslizándola hacia abajo (o tocando la barrita, el fondo o Esc). En Hoy, tocar un alimento abre "Mover a otra comida" (con "Eliminar" abajo) y deslizarlo a la izquierda lo elimina, con "Deshacer" en el aviso. Los gestos con el dedo usan eventos táctiles (`touchmove` con `preventDefault`), no pointer events: Chromium e iOS cancelan el pointer a los pocos píxeles. En Playwright, después de un arrastre vertical simulado por CDP los toques dejan de generar `click` (pasa igual sin estos gestos): prueba los toques antes de los arrastres.

## Pruebas

Antes de dar algo por terminado:
1. `node --check` de cada archivo de `js/`.
2. Probar en Playwright con viewport de iPhone (390x844), con el módulo de Supabase simulado en memoria y servidor local (`python3 -m http.server`).
3. Revisar que no haya errores en la consola.

Para la base de datos, probar el SQL en un Postgres local antes de entregarlo.

## Cómo trabaja Santiago

- Prefiere pasos claros y detallados, y que expliques el porqué de cada cambio. Es estudiante de ingeniería electrónica: las analogías con hardware le ayudan.
- Hacer solo lo que pide y cuando lo pide. Las fases 2 y 3 se hacen cuando él lo ordene, una por una.
- Antes de un cambio grande o con varias opciones, pregunta. Pregunta siempre antes de borrar datos o cambiar el esquema ya en uso.
- Descartado, no lo propongas: función RPC para el reporte, caché IndexedDB, selector de tipo de día.

## Pendientes de la fase actual (esperan orden)

- Ninguno por ahora.
