# Product

## Register

product

## Users

Todo el personal de FarmaSalud/Farmalasa — desde gerentes generales y administradores en oficina central, hasta supervisores de tienda, personal de RRHH y empleados operativos de farmacia. Se usa durante toda la jornada laboral, en distintos dispositivos (escritorio en oficina, tablet en tienda, móvil en campo). El contexto varía: un gerente revisa KPIs a primera hora, un empleado consulta su horario o marca asistencia, un supervisor aprueba solicitudes entre turnos.

## Product Purpose

Portal interno de operaciones para una cadena de farmacias. Centraliza RRHH (asistencia, horarios, solicitudes, vacaciones, planilla), comercial (cotizaciones, facturación, ventas, productos) y comunicación interna (avisos, encuestas). El acceso está controlado por roles (RBAC). Éxito = el personal completa sus tareas sin fricción, sin formación especializada, desde cualquier dispositivo.

## Brand Personality

Moderno, ágil, fresco — la herramienta se siente como una app de Apple, no como un ERP corporativo. Eficiencia sin frialdad; profesionalismo sin rigidez. La empresa es cercana y orientada a las personas; el software debe reflejarlo.

## References

Apple apps nativas de iOS — glassmorphism con propósito (no decorativo), jerarquía de lectura clara, interacciones fluidas, tipografía legible a cualquier tamaño. La profundidad visual comunica significado, no estética.

## Anti-references

- ERP gris y corporativo (SAP, Oracle, sistemas de nómina anticuados) — demasiado frío, sin jerarquía visual, interfaz de escritorio emulada en web
- SaaS genérico con hero metrics (gradiente azul, número grande, label pequeño, tarjetas iguales repetidas) — sin identidad, sin diferenciación
- Aplicación médica clínica (blanco esterilizado, verde hospitalario) — demasiado aséptico para una empresa que trabaja con personas

## Design Principles

1. **Velocidad sobre decoración.** Cada efecto visual debe justificarse por la claridad que aporta. Si un blur, sombra o animación no ayuda a leer o navegar más rápido, no existe.
2. **Jerarquía gana cada píxel.** Datos densos sin caos — el contraste de escala y peso dirige la lectura, no el número de tarjetas ni los bordes.
3. **Glass con propósito, no glass como decoración.** La translucidez y el blur comunican profundidad real (capas, modales, overlays). No se usan como motivo visual por defecto.
4. **El rol define la experiencia.** La UI adapta lo que muestra según quién eres. Un empleado y un gerente ven dashboards distintos; ese filtro debe sentirse natural, no técnico.
5. **Los estados son ciudadanos de primera clase.** Loading, vacío, error y éxito tienen el mismo cuidado de diseño que el estado "feliz". No son afterthoughts.

## Accessibility & Inclusion

WCAG AA. Contraste mínimo 4.5:1 en texto, 3:1 en elementos UI. Navegación por teclado funcional. Tamaños de fuente generosos para operadores que leen en movimiento. Soporte para `prefers-reduced-motion`. El glassmorphism nunca debe comprometer la legibilidad del texto sobre él.
