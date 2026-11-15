# Sueño personal · versión 26

El diario se guarda en `activity_logs.data`, con las políticas privadas existentes. No requiere SQL. La selección de factores y el horario objetivo se guardan por usuario en localStorage del dispositivo. Cambiar de dispositivo conserva los registros; hay que volver a elegir las preferencias.

## Experiencia

- Puntaje de anoche: duración frente al objetivo elegido (60 puntos), continuidad según minutos despierto (20) y calidad declarada (20). Es una regla descriptiva propia, no ML ni una escala clínica. Los minutos despierto vacíos se asumen cero y se avisa en la tarjeta.
- Horario orientativo: hora elegida de despertar menos duración objetivo y un margen. Empieza en 30 minutos; con tres registros de hora de intentar dormir usa la media de tiempo para conciliar el sueño más minutos despierto de hasta 14 noches recientes.
- Diario configurable: hora de intentar dormir, despertares, descanso, somnolencia, cafeína, alcohol, siesta, cena, estrés, ejercicio tarde, pantallas, ruido y calor. Campos opcionales, vacíos conservados como desconocidos. No se precargan respuestas de la noche anterior.
- Asociaciones: compara descanso declarado (1–5) con respuestas sí/no, al menos ocho noches en cada grupo. Se muestran tamaños de grupo y se identifican como exploratorias. No son efectos causales ni tienen significación estadística establecida.

## ML experimental

Regresión ridge escrita en JavaScript, sin dependencias ni API de pago, entrenada de nuevo a partir de los datos de la cuenta al abrir Sueño. No persiste ni comparte pesos entre personas.

Predice descanso al despertar (campo separado de calidad). Variables candidatas: duración, estrés, cafeína previa, alcohol, siesta y ejercicio tarde. No se usan como entrada el descanso ni la somnolencia posterior. Los factores requieren un 80 % de cobertura en las primeras noches de entrenamiento. Se normalizan e imputan con estadísticas calculadas exclusivamente en cada conjunto de entrenamiento; un vacío no se convierte en respuesta «no».

Se exigen 40 noches anteriores completas dentro de una ventana de 180 días. Las diez últimas se evalúan cronológicamente; para cada una se entrena solo con las anteriores. Se compara error absoluto medio con el promedio histórico anterior. Se habilita únicamente si el error es al menos un 10 % menor. Ese umbral es una regla experimental de producto; diez noches de prueba no garantizan generalización.

La estimación mostrada es retrospectiva para anoche: usa sus hábitos y duración conocidos, pero excluye su descanso declarado y todos los registros de esa fecha o posteriores del entrenamiento. Si faltan sus entradas seleccionadas, no predice. El error histórico mostrado no es un intervalo de confianza. El modelo no estima etapas, recuperación fisiológica ni necesidades médicas de sueño.

Los registros existentes sin el nuevo campo de descanso no se reinterpretan como etiquetas de entrenamiento. Al comienzo aparecerá «Recopilando datos». Si el modelo no supera al promedio se informa y no muestra predicción.

## Pruebas

`node tests/sleep-model.cjs`: señal sintética, ausencia de mejora con etiquetas constantes, separación temporal, exclusión de la etiqueta objetivo, datos faltantes, puntaje y grupos de asociaciones. Los datos sintéticos verifican comportamiento del software; no validan eficacia en personas.

`tests/mobile.cjs`: viewport 390×844, Supabase en memoria, edición del diario, vacíos preservados, cambio de objetivo y puntaje, preferencias, navegación y consola. `node --check` para todos los módulos.
