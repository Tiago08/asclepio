# Versión 27: score circular y consultas

El score de anoche usa dos círculos SVG y una animación CSS breve al cambiar la meta. No necesita librerías. Expone valor, mínimo y máximo a lectores de pantalla y respeta movimiento reducido.

## Cambios de rendimiento

- Hoy y estadísticas comparten la misma promesa de registros de 14 días. Antes pedían cuatro consultas en total (dos de actividades y dos de alimentos); ahora necesitan dos (una de cada tabla).
- Esa consulta se conserva en memoria 30 segundos, con clave de usuario y fechas. Se limpia al registrar, editar, borrar, deshacer y cerrar sesión. Una consulta fallida se elimina para permitir reintentar; una respuesta antigua no reemplaza otra posterior a la invalidación.
- El ranking se consulta al abrir su pestaña. Su historial de puntos paginado no compite con Hoy durante el arranque. Cambiar entre Semana y Total utiliza las filas ya descargadas; volver a entrar al ranking vuelve a consultar.
- La lectura del perfil y los datos complementarios arrancan en paralelo. Un usuario con perfil existente requiere una sola lectura de perfil; la creación de respaldo se usa solo si falta la fila.
- Después de registrar, la actualización de perfil se ejecuta en paralelo con la de las pantallas.
- Al cambiar rápidamente entre días, una respuesta anterior no repinta Hoy con otro día.

Se mantiene el frontend estático y no se añade persistencia de datos de salud en una caché nueva.

## Evidencia y límites

En `tests/mobile.cjs`, con Supabase sustituido en memoria y viewport 390×844, se comprueba al iniciar: una lectura de actividades compartida, una de perfil y cero lecturas de puntos. También se comprueba que cambiar el modo del ranking no hace otra consulta de puntos. Los registros guardados se vuelven a leer tras invalidar la caché. Se verifica la actualización del valor accesible del aro al cambiar el objetivo.

Pasan las pruebas completas de formularios y navegación, el modelo sintético de sueño y `node --check` en todos los módulos. Se revisó captura de Sueño en móvil. Estas mediciones son de número de consultas, no una promesa de milisegundos en producción: la latencia real depende de la conexión y Supabase.
