# Saly, ayuda en pantalla — definición (2026-11-04)

Decidido con el usuario en tres rondas de preguntas. Lo que no está acá no se
decidió: preguntar antes de inventarlo.

> «Me gustaría que Saly sea capaz de ver el entorno, qué está pasando, para
> orientar y despejar dudas de lo que hay en pantalla.»

Saly sigue siendo la misma: abstracta, sin género, con emociones que decide el
CÓDIGO (ver memoria `project_saly_es_un_espiritu_de_luz_sin_genero`).

## Lo decidido

| tema | decisión |
|---|---|
| quién | **todo el personal**, cada uno sobre lo que ya ve con sus permisos |
| cuándo | **cuando la llaman** (botón con su figura en cada pantalla) **+ avisos discretos**: cambia de emoción y ofrece explicar, nunca abre nada sola |
| qué la hace reaccionar | un **error** en pantalla · un **botón que no deja seguir** (y por qué) · un **número fuera de lo normal** (faltante, bajo su mínimo) · **mucho rato sin avanzar** en un formulario |
| qué hace | **explicar**, **llevarte** (abrir la pantalla correcta, resaltar el botón) y **llenar por ti** (filtros y formularios) |
| al llenar | los campos que llenó quedan **resaltados con su color**; **nunca** aprieta Guardar, Aprobar ni Enviar — eso lo hace siempre la persona |
| qué ve | **la pantalla actual + más filas de esa misma vista**, pedidas con la sesión y los permisos de quien pregunta. Nunca consulta con la llave del servidor ni otros módulos |
| forma | **burbuja flotante** en una esquina, con sus expresiones; la respuesta sale como globo |
| memoria | **siempre, por persona, resumida**: un resumen de lo que ya preguntó y entendió + los últimos mensajes |
| registro | se anota pregunta, pantalla y 👍/👎; visible sólo para administración, para ver qué confunde y corregir pantallas |
| cuando no sabe o es de criterio | **lo dice y sugiere a quién preguntar** («eso lo aprueba tu supervisor/a»). No inventa, no opina sobre decisiones |
| voz | **corta y paso a paso**: 2–4 frases; si hay que hacer algo, pasos numerados y el botón señalado |
| privacidad | **DUI, NIT, teléfonos, correos y salarios se tapan** («[dato oculto]») **antes** de salir hacia la IA |
| tope | **30 preguntas por persona al día**; al llegar, avisa que descansa hasta mañana |
| primero | **Cortes de caja y Mi caja**, **Mín·Máx y pedidos**. Después el resto |
| app del teléfono | **primero el portal**; la app la recibe en la compilación siguiente, ya probada. No toca el build en revisión |

## Costo estimado

~$0.004 por pregunta (pantalla ~6k tokens + guía del módulo + resumen, a
precios de 2.5-flash de `_shared/gemini.ts`). 50 personas × 5 preguntas/día ≈
**$30–35/mes**. El tope de 30 al día acota el peor caso.

## Lo que NO hace — y por qué

- **No consulta la base por su cuenta.** El chat viejo leía empleados,
  asistencia y turnos de toda la empresa con la llave del servidor y sin
  permiso; se borró el 2026-11-04 (v2.1430.1). Ésta ve sólo lo que la persona
  ya ve, así que no puede mostrar de más por construcción.
- **No guarda, aprueba, anula ni envía nada.** Prellena y señala.
- **No decide su emoción**: la decide el código desde lo que hay en pantalla.

## Piezas a construir (borrador, a confirmar con la vista previa)

1. **Lector de pantalla**: texto visible de la vista (títulos, tabla, filtros,
   avisos, botones deshabilitados con su `title`), con el tapado de datos.
2. **Guía por módulo**: un texto corto con las reglas reales (MIN = velocidad ×
   25; el corte compara esperado contra contado; los cuatro frenos del cierre).
3. **Contrato por vista**: cada vista declara qué más filas puede pedir, qué
   filtros/campos se pueden llenar y qué cuenta como «fuera de lo normal».
4. **Burbuja** (`SalyIcono`/`SalyAvatar` + `.saly-toque`).
5. **Función `saly-ayuda`** con JWT: tope diario, memoria resumida, registro.
6. **Tabla de registro y de memoria** con RLS (la persona ve lo suyo;
   administración, el registro).

Antes de tocar el portal: **vista previa** de la burbuja y de una respuesta.
