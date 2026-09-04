# Auditoría — creación de personal, documentos y nómina (2026-09-03)

Salió de configurar los permisos del rol `Administrador` y de arreglar el
«Faltan 2 datos» del listado (v2.971.3). Al barrer el resto del área aparecieron
**nueve** hallazgos; el mapeo del código y de las policies de nómina sumó cuatro
más, y uno de los nueve resultó falso. **Total: doce**, ninguno da error.

> **Estado al 2026-09-04.** Cerrados G1, G1b, G2, G3, G4, G6, G8, G10, G11, G12
> y G13 (v2.971.7 → v2.972.2). G7 era un falso positivo. Quedan abiertos **G5**
> (46 fichas sin sueldo: es carga de datos, no código) y **la mitad de G9** —
> mover 20 archivos de la ruta vieja, que necesita la llave de `service_role`.
> El detalle de cada cierre está en `CHANGELOG.md`.

El área son 25 archivos de `src/`, seis tablas y tres crons
(`auditoria/areas.mjs`, ids `personal` y `nomina`). Todo lo de acá se midió
contra **producción** el 2026-09-03.

---

## G1 · El expediente tiene tres puertas en la base y ninguna en el almacén

**Grave. Está pasando hoy.**

`employee_documents` (la tabla) exige `staff_detail`. `get_employee_identidad`
exige `staff_detail`. Pero el archivo —la foto del DUI, el contrato firmado— vive
en el bucket `documents`, y su policy es:

```sql
documents_authenticated_select  USING (bucket_id = 'documents')
documents_authenticated_update  USING (bucket_id = 'documents')
documents_authenticated_delete  USING (bucket_id = 'documents')
documents_authenticated_write   WITH CHECK (bucket_id = 'documents')
```

Ninguna pregunta quién es. **Cualquiera de las 48 cuentas del portal puede ver,
reemplazar y BORRAR cualquier documento del expediente de cualquier persona** —
y no hace falta adivinar la ruta: `employees_safe` publica la columna
`employee_documents` (el jsonb con las URLs) a toda sesión autenticada, o sea
que viaja en el arranque a todo el mundo.

En el mismo bucket viven los **25 documentos de sucursales**. Y el bucket
`empleados` (47 fotos) tiene exactamente las mismas cuatro policies.

Es la regla 3 de CLAUDE.md —`USING (true)` prohibido para UPDATE/DELETE— con
`bucket_id` haciendo de `true`. El portal ya sabe hacerlo bien en otros cuatro
buckets: `recetas` pide `bitacoras`, `sales-dte` pide `libros_iva`,
`purchase-dte` pide `facturas_compra` y hasta acota por sala,
`inventario-evidencia` pide permiso para escribir.

**Corrección:** que el SELECT pida `staff_detail.can_view` **o** que el objeto
sea del propio empleado, y que UPDATE/DELETE pidan `auth_can_edit_any`. Con la
carpeta `branches/` aparte, que responde a otro módulo.

---

## G2 · La lectura de la ficha se reparte en tres llaves; la escritura es una sola

**Grave. Latente: hoy nadie está en la combinación, y la pantalla de Permisos la
arma con dos clics.**

La pantalla ofrece tres módulos —Listado, Expediente, Salarios— y de verdad
separan **lo que se ve**. Pero las tres policies de escritura de `employees`
piden lo mismo:

```sql
employees_insert  WITH CHECK (staff_list.can_edit)
employees_update  USING      (staff_list.can_edit AND alcance)
employees_delete  USING      (staff_list.can_edit AND alcance)
```

Y el `GRANT` por columna quedó a medias: a `authenticated` se le **revocó el
SELECT** de las 12 columnas sensibles, pero conserva **INSERT y UPDATE** sobre
las doce — `base_salary`, `bank_name`, `account_number`, `dui`, `code` y
`kiosk_pin` incluidos.

O sea que «Listado de personal → GESTIONAR», con Expediente y Salarios apagados,
alcanza para **cambiarle a cualquiera el sueldo, la cuenta donde se le deposita
y el código con el que entra al portal** — sin poder verlos. El formulario no lo
ofrece (esconde el campo y no manda lo que no cargó), así que hace falta hablarle
a la API; pero el control que la pantalla promete no existe en la base.

**Corrección:** revocar INSERT/UPDATE de esas columnas a `authenticated` y
escribirlas por RPC `SECURITY DEFINER` con su llave —el gemelo de escritura de
`get_employee_salarios` y `get_employee_identidad`, que ya existen para leer.

---

## G3 · Cambiar la cuenta bancaria no deja rastro

**Media.**

`trg_audit_employee_sensitive` funciona (9 filas, la última del 28-ago) pero
mira **tres** columnas:

```sql
IF (NEW.base_salary IS DISTINCT FROM OLD.base_salary OR
    NEW.role_id ... OR NEW.status ...)
```

No mira `bank_name` ni `account_number` —la cuenta a la que se paga— ni `dui`,
`code` o `kiosk_pin`, que son la identidad y la credencial. Cambiar el número de
cuenta de alguien es invisible para la bitácora.

---

## G4 · Generar la quincena sin la llave del sueldo la escribe en cero

**Media. Latente.**

`generarQuincena` (`payrollSlice.js`) hace `deletePendingPayrollEntries(periodId)`
y después reinserta con `calcPayrollEntry(emp, …)`, que arranca en
`parseFloat(emp.base_salary || 0)`. `base_salary` llega por
`get_employee_salarios`, con llave `staff_salary`; el módulo que abre la pantalla
es `payroll`. **Son dos llaves distintas.**

Quien tenga Nómina y no Salarios borra el borrador anterior y lo reemplaza por
46 renglones en `$0.00`. Hay una advertencia («empleados sin salario»), pero
listaría a los 46 y se leería como un problema de datos.

Ya está corregida la mitad visible: `FormEditPayrollEntry` mostraba
`Salario diario: $0.00` y desde v2.971.3 muestra un guion.

---

## G5 · Hoy la nómina no se puede correr: 46 de 48 fichas no tienen sueldo

**Dato de estado, no defecto.**

| | |
|---|---:|
| fichas activas sin `base_salary` | **46** |
| fichas con cuenta bancaria | **1** |
| filas en `payroll_entries` | **0** |

La planilla nunca se generó. Antes de usarla hay que cargar sueldos y cuentas —
y conviene hacerlo **después** de G2, porque hoy esa carga viaja por columnas
que cualquier «Gestionar» del Listado puede reescribir.

---

## G6 · La autogestión está apagada para 43 de las 47 personas

**Configuración.** «Mi perfil» y «Mis documentos» sólo los tienen los tres del
área administrativa:

| cargo | personas | Mis avisos | Mi perfil | Mis documentos |
|---|---:|:--:|:--:|:--:|
| Dependiente de Farmacia | 21 | ✅ | ❌ | ❌ |
| Regente de Enfermería | 7 | ✅ | ❌ | ❌ |
| Jefe/a de Sala | 6 | ✅ | ❌ | ❌ |
| **Auxiliar de Bodega** | 5 | ❌ | *sin fila* | *sin fila* |
| Gerente General | 1 | ✅ | ❌ | ❌ |
| Compras y Logística · Mantenimiento | 2 | ❌ | ❌ | ❌ |
| Administrador · Talento Humano · Supervisión | 3 | ✅ | ✅ | ✅ |

Los cinco auxiliares de bodega no reciben **ni los comunicados internos**.

---

## G7 · ~~Al entrar se aterriza en «Acceso denegado»~~ — FALSO POSITIVO

**Se cae leyendo el resto del código, y conviene dejarlo escrito con su porqué.**
`isAuthenticated` es `!!user` (`AuthContext.jsx:1302`), así que en el mismo
render en que `user` se vuelve verdadero la ruta `/login` (`App.jsx:678`) pasa a
devolver `<Navigate to={defaultRedirect}>` y **desmonta `LoginView`**. El efecto
de `LoginView.jsx:480` nunca corre: es **código muerto**, y quien decide es
`defaultRedirect`, que sí calcula bien la primera pantalla con permiso (y espera
a que los permisos carguen, `arranqueSesion.js`).

La cadena de abajo es correcta salto por salto y aun así la conclusión era falsa,
porque le faltaba el salto que la desactiva. Es la misma lección que la tanda de
v2.971.3: *antes de creerle un número a una lectura, abrir el caso.*

<details><summary>La cadena que se creyó, para que no se vuelva a proponer</summary>

```
LoginView.jsx:480   sin staff_list y sin overview → setView('employee-detail')
App.jsx:338         setView → navigate('/employee-detail')
App.jsx:937         <Route path="employee-detail" → <Navigate to="/personal">
App.jsx:779         /personal → <PermissionGuard staff_list> → AccessDeniedView
```

Lo que faltaba mirar era justamente si «la vista se desmonta antes». Se
desmonta.

</details>

---

## G8 · «Mi perfil → Editar» no puede guardar

**Media.** `FormEditContact` llama `updateEmployee`, que hace
`from('employees').update(...)`, y `employees_update` exige
`staff_list.can_edit`. Quien tenga «Mi perfil» y no «Listado → Gestionar» no
puede corregirse ni el teléfono.

Lo bueno: `updateEmployeeReturning` usa `.select(...).single()`, así que cero
filas vuelve como **error visible** y no como un guardado falso — es el modo de
falla correcto de `feedback_sin_policy_de_update_el_write_devuelve_cero`. Falla,
pero lo dice.

Hoy afecta a 1 persona. Si se enciende «Mi perfil» para la sala (G6), pasa a
afectar a 43.

---

## G9 · La tabla de documentos está vacía y la que manda es la columna jsonb

**Menor, pero explica G1.**

`employee_documents` tiene **0 filas**. Los documentos viven en
`employees.employee_documents` (jsonb), que está en `employees_safe` y llega a
toda sesión. La policy que se le escribió a la tabla —`staff_detail`— no protege
nada, porque el dato está del otro lado. Es una llave sin cerradura, igual que
`staff_salary` antes del 2026-08-23.

Los dos escritores de la tabla existen y son alcanzables (adjuntar un documento
a un evento de RRHH). Uno de ellos, `systemSlice.js:827`, **descarta el `error`
del insert**: si alguna vez falla, el archivo queda en Storage, la fila no se
crea y la pantalla dice que se subió.

---

## G10 · La nómina tenía policy de lectura y ninguna de escritura

**Grave, y estaba pasando.** `payroll_entries` y `payroll_periods` tienen RLS
encendido y el GRANT completo, pero **sólo una policy de SELECT**. Crear el
período, generar la quincena, rehacerla y corregir un renglón fallaban siempre.
Eso explica las 0 filas de G5 mucho mejor que la falta de sueldos: nadie lo
reportó porque nadie llegó a intentarlo.

Cerrado en v2.972.1.

---

## G11 · La lectura de la nómina filtraba sueldos por sala

**Grave.** El segundo término del OR era
`EXISTS (… e.branch_id = auth_employee_branch_id())` **sin pedir ningún
permiso**. El día que existiera la primera quincena, cualquier dependiente vería
el líquido a pagar de sus compañeros y de su jefatura.

Medido en el branch con la policy vieja puesta: **veía el renglón**; con la
nueva, cero. Es la misma forma que G1 — una condición que parece un filtro
haciendo de permiso. Cerrado en v2.972.1.

---

## G12 · `branches.can_view` alcanzaba para escribir el expediente de una sala

**Estaba pasando.** `TabExpediente.jsx` no recibía `canEdit` y no tenía un solo
`disabled`: «Nuevo», «Subir Archivo» y los de reemplazar cada documento legal
estaban siempre encendidos, y la ruta sólo exige `can_view`. La cabecera de la
MISMA pantalla sí los escondía. Cerrado en v2.971.7.

---

## G13 · El PIN del kiosco se podía inventar

`kiosk_pin` es SHA-256 del código y vivía en **tres copias del navegador**; el
servidor lo guardaba tal cual sin recalcularlo, así que quien pudiera escribir
una ficha podía elegirle el PIN a cualquiera. Hoy lo deriva un trigger.

Comprobado **antes** de activarlo: la derivación en Postgres da el mismo valor
que la del navegador en las 46 fichas con PIN, **0 distintas**. Cerrado en
v2.972.0.

---

## Lo que se revisó y está bien

- **Los tres crons del área corrieron hoy**: `check-doc-expiry-daily` (13:00),
  `check-employee-doc-expiry-daily` (13:30) y
  `apply-scheduled-employee-events-daily` (11:00).
- **El bucket `documents` es PRIVADO.** La URL con `/object/public/` que se
  guarda en la base es sólo el identificador — el patrón que manda CLAUDE.md.
  El problema de G1 es la policy, no el bucket.
- **`bloqueo_global` es RESTRICTIVE** en las tres tablas, o sea que ANDea. Si
  fuera permisiva, cualquiera podría escribir cualquier ficha.
- **`get_employee_identidad` y `get_employee_salarios`** están bien escritas:
  compuerta envuelta en `(SELECT …)`, alcance respetado, y la identidad devuelve
  siempre lo propio (esconderle a alguien su propio DUI rompe una pantalla sin
  proteger a nadie).
- **`FormNovedad`** deja el salario en «—» cuando no lo tiene: muestra menos, no
  miente. **`timeClock.audit`** redacta el `employee_dui` antes de guardarlo.
- **`enforce_numeric_employee_code`** vigila el código en INSERT y en UPDATE.

---

## Lo que queda abierto

1. **G5** — 46 de 48 fichas sin sueldo y 1 sola con cuenta bancaria. Es carga de
   datos, no código, y ahora se puede hacer con las llaves en su sitio.
2. **La mitad de G9** — 20 archivos siguen en `employee-documents/unassigned/`,
   una ruta que no dice de quién son, así que sólo los ve «Expediente completo»
   y **nunca su propio dueño**. Dos tienen dueño (los DUIs de Carlos Renderos) y
   **18 son huérfanos** de pruebas. Moverlos necesita la llave de `service_role`,
   que no está en el `.env` local; la alternativa sin llave es volver a subirlos
   desde el expediente, que ya escribe en la ruta buena.
3. **Los adjuntos del alta** siguen cayendo en esa misma ruta vieja mientras la
   ficha no tiene id. Cerrarlo exige mover el archivo después del INSERT (misma
   llave) o diferir la subida, que es un rediseño del formulario — hoy sube al
   elegir el archivo porque de ahí sale la lectura del DUI.
