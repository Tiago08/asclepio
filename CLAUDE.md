# Asclepio

App personal de salud y nutrición para 3 personas (el dueño, Santiago, y 2 amigos). Registro de comida con macros y micronutrientes, gym, baño, sueño, energía y notas. Ranking de rachas entre amigos. Interfaz en español.

Estado y pendientes: página "Asclepio" en Notion (https://app.notion.com/p/40d4ce9c8a3e81079260c703657d8823). Ahí están las fases 2 y 3.

## Stack

- Frontend estático en GitHub Pages: HTML, CSS y JavaScript con módulos ES. No hay build, ni npm, ni framework. Mantenlo así.
- Supabase: Auth (código por correo), Postgres con RLS, triggers.
- Cliente Supabase cargado desde `https://esm.sh/@supabase/supabase-js@2`.
- USDA FoodData Central para buscar alimentos; traducción con MyMemory y caché en localStorage.
- PWA instalable en iPhone (manifest, apple-touch-icon, safe-area).
- Repo público (Pages gratis lo exige): Tiago08/asclepio. Sitio: https://tiago08.github.io/asclepio/

## Estructura

- `index.html`: login, pestañas (Hoy, Historial, Ranking, Datos), hoja inferior para formularios.
- `css/styles.css`: tema oscuro, sin bordes duros, hoja inferior, tab bar fija.
- `js/app.js`: lógica principal y pantallas. `js/auth.js`, `js/foods.js`, `js/activity.js`, `js/report.js`, `js/config.js`, `js/supabaseClient.js`.
- `sql/`: esquema y migraciones que Santiago ejecuta a mano en el SQL Editor de Supabase.

## Reglas de trabajo

- Cache-busting: los imports y el CSS llevan `?v=N` (ahora `?v=5`). Cada vez que cambies archivos, sube N en todos los imports, en `index.html` y en `supabaseClient.js`. Si no, Chrome y la app instalada muestran archivos viejos.
- Todo el texto visible va en español.
- Los cambios de base de datos van siempre en un archivo nuevo en `sql/`, idempotente (`if not exists`, `on conflict`, etc.). Nunca edites el esquema ya ejecutado. Al terminar, di a Santiago qué archivo ejecutar y en qué orden.
- Tablas creadas por SQL necesitan `GRANT` a `authenticated` además de las políticas RLS (ya nos mordió: "permission denied for table").
- Cada tabla de datos del usuario lleva RLS con `auth.uid() = user_id`. El ranking solo expone nombre y racha.
- La clave `sb_publishable_...` y la de USDA en `js/config.js` son públicas por diseño. Nunca uses ni escribas una clave `service_role` ni secretos en el repo.
- iPhone: los campos de entrada deben tener 16 px o más de letra (si no, iOS hace zoom). Respeta safe-area y evita `position: fixed` sin probarlo en 390x844.

## Diseño

Estilo "cuaderno de laboratorio" oscuro, cómodo y poco "encajonado", como MyFitnessPal: tarjetas redondeadas, sin bordes duros, colores por categoría, hoja inferior con fondo difuminado. No añadir elementos que sobrecarguen la pantalla Hoy.

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

- Quitar el texto "Propio/USDA" en los resultados de búsqueda.
- Traducir al español los nombres que vienen de USDA.
- Zoom al tocar campos en iPhone (subir letra a 16 px).
