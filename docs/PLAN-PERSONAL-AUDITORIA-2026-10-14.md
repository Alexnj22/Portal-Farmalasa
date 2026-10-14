# Plan — auditoría de Personal (2026-10-14)

Auditoría del alta, la edición, el expediente y el listado de personal. Tres
revisiones de código + consultas de solo lectura contra producción. Los gates
del área y las 660 pruebas estaban en verde: ninguno de estos defectos lanza un
error, por eso sobrevivieron.

Estado: `[ ]` abierto · `[x]` cerrado. **Cerrado el 2026-10-14** (migraciones
`20261014155330`, `20261014155511`; `apply-scheduled-employee-events` v16).

## Fase 1 — Seguridad (base + credenciales)

- [x] **S1** `escalera_disciplinaria` es DEFINER, ejecutable por `authenticated`
  y no pregunta permiso: cualquier sesión lee el historial disciplinario de
  cualquiera. → guarda: propio, `staff_detail.can_view` o quien puede sancionar.
- [x] **S2** `escalera_disciplinaria` cuenta sanciones `CANCELLED`/`SUPERSEDED`.
  → **Resuelto por S3, no por exclusión.** Una sanción no se cancela: se
  revoca por el reclamo del Art. 77, y ésa ya se excluye. Con S3 ninguna sesión
  puede marcar una sanción CANCELLED/SUPERSEDED (0 en producción), así que
  excluirlas abriría un atajo para sacarla de la escalera.
- [x] **S3** Las sanciones se ofrecen a «Editar»/«Cancelar» en el historial como
  cualquier novedad; «Editar» las reinserta por fuera de `registrar_sancion`
  con la firma que trae el navegador. → sin esos botones para
  AMONESTACION/SUSPENSION (la sanción se corrige por rectificación o reclamo).
- [x] **S4** El CSV del directorio exporta el código de carné (= contraseña)
  con el permiso de `ventas`. → la columna sale del archivo.
- [x] **S5** El borrador del alta guarda `code` en `localStorage`. → `code`
  entra en `SENSITIVE_FIELDS`.
- [x] **S6** Policy `documents_select` (bucket `documents`): la rama por sala
  compara `split_part(e.name, …)` —el nombre de la persona— en vez de la ruta
  del objeto. Latente (todos los cargos con expediente son ALL). → `objects.name`.

## Fase 2 — Datos que se pierden o se tergiversan

- [x] **D1** Cancelar una novedad de SALARIO/CÓDIGO no revierte: se lee la ficha
  de `employees_safe`, que no trae `base_salary`/`code`. → leer esas columnas
  por su canal (salario/credenciales) antes de comparar.
- [x] **D2** Editar una novedad marca la original SUPERSEDED antes de crear la
  nueva; si la nueva falla, desaparece. → crear primero, reemplazar después; y
  `registerEmployeeEvent` relanza en vez de devolver `null`.
- [x] **D3** Falla la subida de la foto → se escribe `photo_url = null` y se
  pierde la foto anterior. → si falla, error y no se toca la foto.
- [x] **D4** Falla la subida al reemplazar un documento → la entrada se salta
  entera y se pierde el anterior. → error, no se guarda.
- [x] **D5** Enlazar con ficha existente: si `fetchSalarios` falla, se mandan
  sueldo/banco en `null` y se borran. → el error se propaga.
- [x] **D6** Errores ignorados: `updateEmployeeRow`, sucursales adicionales
  (delete+insert), evento REHIRE, `disable-employee-auth` (`invoke` no rechaza).

## Fase 3 — Validaciones que bloquean fichas válidas

- [x] **V1** Editar una ficha de adulto sin DUI es imposible (31 activas).
  → el DUI se exige en el alta, no en cada edición.
- [x] **V2** NUP de 9 dígitos (= DUI, vigente desde 2023) se rechaza en el
  store; el formulario lo acepta (7 fichas). → misma regla que `revisarNup`.
- [x] **V3** Horas de recontratación sin rango; teléfono de emergencia fuera de
  `motivoNoGuardable`.

## Fase 4 — Listado y estados

- [x] **L1** Sin `staff_detail` (Administrador) la vista calcula estados con un
  historial vacío. → usar el estado remoto (`get_estados_de_personas`) como el aro.
- [x] **L2** La caché de estados pierde `faltan`.
- [x] **L3** El gemelo JS de estados no excluye la suspensión revocada.
- [x] **L4** «Falta documento de identidad» ignora `DUI_COMPLETO`.
- [x] **L5** Error al cargar historial/practicantes/ficha → pantalla vacía sin aviso.
- [x] **L6** Filtro de sucursal ignora `employee_branches`.
- [x] **L7** Inactivos en «Todos» y en el reparto de jefatura.
- [x] **L8** Edad / cumpleaños con el reloj del equipo en vez de `hoySV()`.

## Fase 5 — Expediente y bitácora

- [x] **E1** Cancelar/editar novedad sin `appendAuditLog`.
- [x] **E2** La sanción recién puesta no refresca el historial (`onGuardado`).
- [x] **E3** `SancionModal`: el peldaño propuesto se congela.
- [x] **E4** Cron de cambios programados busca el cargo por rótulo exacto. →
  `role_id` en el evento + coincidencia normalizada de respaldo.
- [x] **E5** Recontratación: sin fecha fin/base legal/motivo para plazo; arrastra
  `contract_start_date` y prórrogas.
- [x] **E6** Soportes de novedad invisibles («Ver Respaldo Legal» depende de un
  `document_id` que nada escribe).
- [x] **E7** Alta en varios pasos: si `guardarDatosProtegidos` falla, la ficha
  queda a medias y el reintento choca con su propio código.

## Queda abierto (fuera de este plan)

- **El código de carné ES el código de vendedor.** Quien ve Ventas recibe el
  código de toda la planilla (`get_vendedores`), y ese código es la contraseña
  de la cuenta de carné. S4/S5 lo sacaron del CSV y del disco, pero el arreglo
  de fondo es darle al carné un secreto propio — ya anotado en `systemSlice`.
  Es decisión del usuario: cambia cómo entra la gente.
- ~~Una novedad de SALARIO con un monto no numérico se registraba sin cambiar
  el sueldo.~~ Cerrado en v2.1287.3: se rechaza.
- ~~La etiqueta «Suspendido» esperaba a la próxima carga.~~ Cerrado en
  v2.1287.3: la sanción entra a la copia en memoria al guardarse.
- ~~Recontratar como SERVICIOS no pedía fecha de fin.~~ Cerrado en v2.1287.3:
  la regla existía en el alta (`contratoConPlazo`) y ahora la sigue también la
  recontratación.
