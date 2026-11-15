# Preferencias explícitas y salud digestiva · versión 30

Implementación programada para el 15 de noviembre de 2026, 07:00 de Caracas. Conserva HTML/CSS/módulos ES, cinco pestañas y Supabase existente. Sin dependencias nuevas, API generativa, secretos, migraciones ni cambios en puntos o rachas.

## Preferencias y variantes

- Agregar y repetir aportan evidencia positiva mediante los registros reales de comida. Mostrar, ignorar o abrir/cancelar una sugerencia no genera una señal negativa ni modifica preferencias.
- La × se presenta como **«No me gusta»**. Guarda motivo explícito, alimento, fecha e identidad FDC/ID en las preferencias locales de la cuenta. Excluye ese alimento de recomendaciones, referencias habituales y entrenamiento de preferencias; no excluye su categoría. Los ocultamientos anteriores siguen respetándose. Se puede restaurar uno o todos.
- Las variantes toman como referencia alimentos registrados en la misma comida y de función culinaria compatible; comparan reparto energético de macros y ajustan cantidades a energía semejante dentro de porciones acotadas. Se muestra «Variante de…». Siguen aplicándose presupuesto calórico y límites nutricionales documentados. Son propuestas revisables, no equivalencias clínicas o planes prescritos.
- La tolerancia es una preferencia explícita por porciones pequeñas de un alimento concreto, restaurable. No se deduce automáticamente una intolerancia de los síntomas. Los fallos de lectura/escritura local se informan y no reemplazan preferencias ilegibles.

## Salud digestiva

- Se abre desde el mosaico Baño o desde su formulario. No añade una pestaña. Bristol exacto 1–7, dolor, hinchazón, esfuerzo y urgencia 0–10; vacío significa desconocido y cero ausencia declarada. Los registros anteriores mantienen su categoría agrupada sin inventar un valor exacto. «No fui hoy» conserva síntomas y borra el Bristol; los días sin registros no se interpretan como cero deposiciones. Se avisa de contradicciones entre «no fui» y deposiciones del mismo día.
- Bristol y síntomas del evento se guardan en `activity_logs.data`, usando las políticas RLS existentes y el tipo `bano`. No se añaden tipos de actividad, triggers o puntos. El reporte general conserva el detalle nuevo.
- Contexto diario, medicación declarada, probióticos y preferencias de tolerancia se conservan **solo en localStorage, separados por cuenta y dispositivo**. No se sincronizan con Supabase. Esto está explicado en pantalla; se ofrece exportación para consulta con deposiciones, alimentación disponible, sueño, síntomas, medicación y fichas/tomas declaradas. No se registra una actividad extra para estos datos ni se publica el historial personal.
- Catálogo digestivo versionado basado en identidades FDC de los básicos, con enlaces de procedencia y componentes cualitativos documentados. Distingue fermentación de cultivos vivos (desconocidos sin verificar etiqueta) y de probióticos con evidencia específica. No inventa gramos de prebióticos. Agrupa preparaciones de vegetales y muestra cobertura del catálogo y de fibra; «30 plantas» no es un umbral clínico. Los registros fuera del catálogo no se clasifican por conjeturas sobre su nombre.
- Fichas de probióticos editables: especie, cepa, UFC/dosis, dosis declarada, conservación, vencimiento, motivo, inicio/final y enlace de evidencia de PubMed/PMC/AGA/WGO. Tomas explícitas por día. Desconocido no se sustituye por una dosis; no se prescriben productos ni se aprueba automáticamente un producto por enlazar un estudio. Se advierte sobre vencimiento y consulta profesional en poblaciones vulnerables.
- Contexto diario con señales de alarma declaradas (sangre, dolor persistente, pérdida involuntaria de peso) y orientación de valoración médica; urgencia ante dolor intenso o sangrado abundante. No se diagnostican enfermedades, composición bacteriana, disbiosis o intolerancias.

## Análisis y límites

- Asociaciones entre dolor diario y fibra, sueño, estrés o medicación del día anterior, con tamaños de muestra. Fibra solo en días confirmados como completos con firma de registros todavía válida; desconocimiento de medicación no equivale a no tomarla. No hay ajuste causal completo: las comparaciones no establecen causas ni justifican eliminar grupos alimentarios.
- Modelo local k-NN de dolor diario con dolor, hinchazón y estrés previos. No usa la etiqueta del día objetivo. Al menos 32 pares utilizables permiten una evaluación inicial, no una garantía: predicciones secuenciales sobre 12 días posteriores, comparación contra promedio y persistencia, mejora mínima del 10 %, error máximo de dos puntos y mejora en ambas mitades de la evaluación. Se abstiene ante contexto alejado o señales de alarma. No pretende medir flora intestinal ni sustituir atención clínica.
- La información educativa refleja diferencias entre guías sobre probióticos, los límites del pequeño ensayo de fermentados de Stanford, el carácter observacional de American Gut y las limitaciones de las pruebas de microbioma. Una dieta baja en FODMAP se describe como intervención profesional temporal con reintroducción, no una restricción automática.
- Fuentes verificadas: [WGO](https://www.worldgastroenterology.org/UserFiles/file/guidelines/probiotics-and-prebiotics-english-2023.pdf), [AGA: probióticos](https://gastro.org/clinical-guidance/role-of-probiotics-in-the-management-of-gastrointestinal-disorders/), [AGA: distensión](https://gastro.org/news/new-clinical-practice-update-belching-bloating-distention/), [AGA: dieta](https://pubmed.ncbi.nlm.nih.gov/35337654/), [ISAPP: fermentados](https://pmc.ncbi.nlm.nih.gov/articles/PMC7925329/), [ISAPP: prebióticos](https://enviromicro-journals.onlinelibrary.wiley.com/doi/10.1111/jam.14424), [ensayo Stanford](https://pubmed.ncbi.nlm.nih.gov/34256014/), [American Gut](https://pubmed.ncbi.nlm.nih.gov/29795809/), [consenso de pruebas del microbioma](https://pmc.ncbi.nlm.nih.gov/articles/PMC12343204/), [NIDDK: señales de alarma](https://www.niddk.nih.gov/health-information/digestive-diseases/constipation/symptoms-causes).

## Validación

- `node --check` de todos los módulos. `tests/intelligence.mjs`, `tests/sleep-model.cjs` y `tests/gut.mjs`: modelos, datos faltantes, temporalidad, variantes, rechazos específicos, restauración, neutralidad, almacenamiento aislado por cuenta y catálogo.
- `tests/mobile.cjs`: Chrome/Playwright 390×844, servidor Python local, Supabase en memoria. Prueba cinco pestañas, contexto cero/desconocido, avisos, registro y edición de probióticos/tomas, escape de texto, exportación, Bristol, «no fui» con conservación de síntomas y ausencia de escrituras extra de actividades por funciones locales. Consola sin errores e inspección de capturas. No se probó Safari físico ni se modificó producción.
- Caché de todos los módulos y CSS en versión 30. **No hay SQL que ejecutar.**

---

# Modelos locales y micronutrientes · versión 29

Implementado el 15 de noviembre de 2026. Frontend estático, sin npm, build, APIs generativas, dependencias nuevas ni cambios en Supabase. No hay SQL que ejecutar.

## Micronutrientes

- Cobertura por nutriente: registros con valor / registros aplicables. Un cero explícito sigue siendo dato; vacío, negativo y nulo no lo son. Los estados parciales no indican carencia ni cumplimiento. Los suplementos no forman parte de esta suma y la interfaz lo aclara.
- Las estimaciones se activan en el desplegable de micronutrientes y aparecen aparte; no modifican `foods`, `food_logs`, metas, reportes ni ranking. Si el catálogo del alimento ofrece el dato, se utiliza esa referencia actual, escalada por cantidad y etiquetada. No se presenta como reconstrucción exacta del pasado.
- k-NN ponderado por distancia sobre calorías, proteína, carbohidratos y grasa, normalizados en escala logarítmica dentro de la categoría. Entrenamiento local en un Web Worker con los 110 básicos USDA; alternativa en el hilo principal si el navegador no admite el worker.
- Validación dejando fuera cada FDC, sin usar el nutriente objetivo como entrada. Se exige un mínimo de 30 pruebas, reducción del MAE de al menos el 10 % respecto a la mediana de categoría y error acotado respecto al promedio. También se exige categoría conocida, vecinos cercanos y al menos cinco errores de validación en esa categoría. Se abstiene para productos de marca, alimentos personalizados, cantidades desconocidas y referencias insuficientes.
- **Resultado del catálogo actual:** zinc habilitado, 65 pruebas, MAE 0,386 frente a 0,472 mg/100 g. Fibra, potasio, magnesio, calcio, hierro y B6 no superan el umbral y no se imputan con ML. La app muestra estos resultados; no se rebajaron los criterios para habilitar más modelos. El error orientativo es el percentil 90 de errores de categoría; no garantiza cobertura probabilística.
- Se excluyen de imputación vitaminas A, D, B12, folato y omega-3. La importación convierte unidades de masa y rechaza unidades incompatibles; folato total no sustituye DFE y EPA+DHA exige ambos componentes conocidos. Los registros históricos conservan sus valores y no pueden verificar retrospectivamente unidades o composición.
- Azúcares totales pasan a informativos, sin aplicarles el límite de añadidos. No se aplica el UL de vitamina A preformada al total RAE; se corrigen vitamina D a partir de 71 años y calcio a partir de 51. Las referencias AI no se etiquetan como EAR. EPA+DHA mantiene el objetivo orientativo existente de 500 mg, sin atribuirle DRI o EAR.

## Personalización y gasto

- Sugerencias bajo demanda en Hoy: hasta tres categorías, porciones revisables, margen calórico, proteína y nutrientes con cobertura completa. No se interpretan datos parciales como carencias; se excluyen alimentos crudos, harinas, alcohol y opciones incompatibles con límites disponibles. Se pueden ocultar alimentos y restaurarlos.
- Modelo categórico bayesiano de elección por comida, con suavizado hacia la frecuencia global. Mínimo de 40 registros en 14 fechas; separación temporal por días completos; se activa si reduce un 5 % la pérdida logarítmica sobre la frecuencia global en al menos 10 registros posteriores. Sin datos suficientes, se conserva la selección por metas. No usa datos de amigos.
- Modelo energético en Datos, con carga explícita del historial paginado de hasta 70 días. Regresión regularizada del balance acumulado de ingesta y peso hacia la referencia calculada con un peso anterior. Requiere 35 días completos consecutivos recientes, 18 pesos y una ventana suficiente para entrenamiento; evaluación temporal en los últimos seis pesos, sin entrenar con ellos antes de predecirlos.
- La activación exige mejorar el MAE al menos un 10 %, error máximo de 0,6 kg y gasto dentro de límites de plausibilidad. Se respetan el gasto en reposo y los pisos de la calculadora. La propuesta cambia como máximo 150 kcal, preserva proteína y grasa y pasa a los campos de revisión: nunca se guarda sola.
- La aproximación de 7700 kcal/kg no modela toda la fisiología ni separa agua de tejido; el modelo no reproduce el modelo dinámico del NIDDK. La limitación está visible. Días ausentes no se rellenan con cero; una edición invalida la confirmación de comida completa.
- Confirmaciones de días, estimaciones activadas y alimentos ocultos: `localStorage` separado por cuenta, sin sincronización entre dispositivos. Los historiales personales no se publican ni se usan para entrenar modelos compartidos. Un fallo de almacenamiento se informa. Nada suma puntos ni rachas.

## Verificación y fuentes

- `node --check` en todos los módulos; `node tests/intelligence.mjs` verifica abstención, validación, porciones, no mutación, huecos de datos, cambios posteriores, balance sintético y preferencias aprendidas.
- `tests/mobile.cjs`: Chrome/Playwright 390 × 844, servidor Python local y Supabase en memoria. Verifica unidades, cobertura, entrenamiento en worker, estimaciones separadas, ocultar/restaurar sugerencias, revisión de porciones, confirmaciones de ingesta, modelo energético habilitado con datos sintéticos y propuesta sin escrituras, además de los flujos anteriores. Sin errores de consola. Capturas revisadas; no sustituye Safari en un iPhone físico ni valida precisión clínica.
- Fuentes: [USDA: documentación](https://fdc.nal.usda.gov/data-documentation/), [FDA: azúcares añadidos y totales](https://www.fda.gov/food/nutrition-facts-label/added-sugars-nutrition-facts-label), [FDA: folato DFE y vitamina A RAE](https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels), [NIH: vitamina A](https://ods.od.nih.gov/factsheets/VitaminA-HealthProfessional/), [NIH: vitamina D](https://ods.od.nih.gov/factsheets/VitaminD-Consumer/), [NIDDK: modelos de cambio de peso](https://www.niddk.nih.gov/research-funding/at-niddk/labs-branches/laboratory-biological-modeling/integrative-physiology-section/research/body-weight-planner).

---

# Revisión UX/UI · versión 28

Cambios del 14 de noviembre de 2026, limitados al frontend existente:

- **Jerarquía de Hoy:** calorías registradas y restantes separadas, meta explícita, saldo de cada macro y superficie con acento suave. Se conservan las cuatro comidas, los mosaicos y los micronutrientes plegables.
- **Legibilidad y tacto:** contraste reforzado de textos secundarios, botones de fecha y agregar comida de 44 × 44 px, filas de comida de al menos 44 px y pestaña activa con fondo además del color.
- **Arquitectura de información:** cerrar sesión pasa a Datos, junto a la cuenta. La barra principal conserva sus cinco destinos; Historial sigue dependiendo de Datos.
- **Accesibilidad:** etiquetas persistentes en el acceso, anuncios de estado, navegación con `aria-current` y calorías con semántica de medidor. La hoja bloquea la interacción del fondo, contiene el foco y lo devuelve al cerrar. Se cancela el cierre pendiente si se abre otra hoja.
- **Insights:** la ausencia de gym ya no cuenta como descanso. Se requieren al menos tres días con gym y energía y tres con descanso explícito y energía; cada día pesa igual aunque tenga varias mediciones. Se muestra el tamaño de muestra y se explica que la asociación no indica causa. El período excluye datos posteriores al día seleccionado. Se conserva la comparación de sueño y energía con su mínimo de dos noches por grupo.
- **Entrega:** caché de módulos y CSS en versión 28. Sin dependencias nuevas, servicios de IA, cambios de esquema ni migraciones que ejecutar.

Validación: `node --check` en todos los módulos de `js/`; `tests/mobile.cjs` con servidor Python local y Chrome mediante Playwright a 390 × 844, Supabase simulado en memoria. Incluye saldo calórico por encima de meta, macros, tamaño táctil, navegación de fechas, foco modal, muestras incompletas y promedio diario de insights, además de los flujos existentes de guardado. Capturas revisadas de Hoy, Datos y diario de sueño. Sin errores de consola. La prueba no sustituye Safari en un iPhone físico ni verifica la base de producción.

---

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
