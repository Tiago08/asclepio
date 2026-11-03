# Asclepio — bitácora personal de salud

## Qué hay aquí

```
asclepio/
├── index.html            la app entera (login + pantalla principal)
├── manifest.json         para "agregar a inicio" en el teléfono
├── css/styles.css
├── icons/
├── js/
│   ├── config.js         tus claves de Supabase/USDA (ya están puestas)
│   ├── supabaseClient.js
│   ├── auth.js           login con magic link
│   ├── foods.js          búsqueda de alimentos (local + USDA) y registro
│   ├── activity.js       gym / baño / sueño / energía / notas
│   ├── report.js         exportar reporte de texto
│   └── app.js            arma todo lo anterior en la interfaz
└── sql/
    ├── schema.sql        tablas, seguridad (RLS), racha automática
    └── seed_foods.sql    los 53 alimentos venezolanos que me pasaste
```

## 1. Preparar Supabase (una sola vez)

En tu proyecto de Supabase → **SQL Editor**:

1. Pega el contenido completo de `sql/schema.sql` y dale **Run**.
2. Pega el contenido completo de `sql/seed_foods.sql` y dale **Run**.
   (Ya probé ambos en una base de datos Postgres real antes de mandártelos — tablas, permisos, cálculo de racha y los 53 alimentos quedaron correctos.)

Luego en **Authentication → URL Configuration**:
- **Site URL**: pon la URL donde vas a publicar la app en GitHub Pages (ej. `https://tu-usuario.github.io/asclepio/`). Si todavía no la tienes, publícala primero (paso 2) y vuelve a esto.
- **Redirect URLs**: agrega esa misma URL.

Sin esto, el link mágico del correo va a intentar regresar a una URL equivocada y el login no va a amarrar.

**Nota sobre el correo gratis de Supabase**: el servicio de correo que trae por defecto tiene un límite bajo (unos pocos correos por hora). Para ustedes 3 no debería ser problema en uso normal — la sesión queda guardada en el navegador, así que no van a estar pidiendo link a cada rato. Si en algún momento el login falla porque "se acabaron los correos", es por eso; se soluciona configurando un proveedor de correo propio (SMTP) más adelante, no es urgente ahora.

## 2. Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub (puede ser privado).
2. Sube el contenido de esta carpeta tal cual (no la carpeta `asclepio/` en sí, sino lo que está adentro, en la raíz del repo).
3. Settings → Pages → Source: "Deploy from a branch", branch `main`, carpeta `/ (root)`.
4. En un par de minutos tu app queda en `https://tu-usuario.github.io/nombre-del-repo/`.
5. Si no lo habías hecho en el paso 1, vuelve a Supabase y pon esa URL en Site URL / Redirect URLs.

## 3. Invitar a tus 2 amigos

No hay que crear sus cuentas a mano: les pasas el link de GitHub Pages, cada uno pone su correo, recibe su magic link, y al entrar por primera vez la app les crea su perfil solo. Van a aparecer automáticamente en el Ranking.

## 4. Uso diario

- Los botones grandes de arriba registran comida, gym, baño, sueño, energía o una nota.
- Al buscar una comida, busca primero en lo que ustedes ya cargaron (incluye los 53 alimentos venezolanos) y en paralelo en la base de datos de USDA (miles de alimentos con micronutrientes). Si no aparece, "agregar un alimento nuevo" lo guarda para todo el grupo.
- Los favoritos (tus comidas más registradas) aparecen arriba para loguearlas en un toque.
- Los anillos muestran tu progreso del día contra tus metas (editables en la pestaña **Datos**, por defecto 2000 kcal / 150 g proteína / 250 g carbos / 65 g grasa).
- **Datos → Generar y descargar reporte** te da un `.txt` de tu día o tu semana — ese es el archivo que me pasas para que te diga qué ajustar.

## Qué falta / posibles siguientes pasos

No lo armé en esta primera versión, pero queda fácil de agregar cuando lo necesites:
- Editar un registro ya guardado (hoy solo se puede borrar y volver a cargar).
- Notificaciones/recordatorios (GitHub Pages no puede mandar notificaciones push por sí solo).
- Gráficas de tendencia (hoy los insights son frases, no gráficas).

Avísame cuando lo tengas corriendo y probemos el flujo real.
