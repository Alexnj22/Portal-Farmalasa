// ─────────────────────────────────────────────────────────────────────────────
// EL MAPA DEL PORTAL — qué pieza pertenece a qué área
// ─────────────────────────────────────────────────────────────────────────────
//
// Este archivo NO puntúa nada. Sólo dice de quién es cada cosa: qué archivos,
// qué tablas, qué funciones del servidor y qué tareas programadas componen cada
// área. Los puntajes viven en `registro.json`, que se edita al auditar.
//
// Están separados a propósito. El mapa cambia cuando se agrega una pantalla —un
// hecho verificable, que el gate puede contrastar contra el disco—; el puntaje
// cambia cuando alguien AUDITA, que es un juicio con evidencia. Mezclarlos hace
// que regenerar el inventario borre las conclusiones, y es exactamente cómo un
// baseline termina "regenerándose para tapar un hallazgo".
//
// ── Por qué 25 áreas y no los 70 módulos de permisos ────────────────────────
// Un módulo de permiso es una LLAVE, no un circuito. `traslados` y
// `dash_traslados` son dos llaves de la misma puerta, y un traslado cruza seis
// pantallas, dos tablas y una edge function. Puntuar por llave da un tablero que
// no se puede leer y un candado que no protege nada: se congelaría la vista y
// quedaría libre la función que hace el trabajo.
//
// El área es la unidad que tiene sentido congelar porque es la unidad que tiene
// sentido probar: "un traslado sale de Bodega y llega a la sala" se verifica de
// una vez o no se verifica.
//
// ── Cómo se asigna un archivo ───────────────────────────────────────────────
// Gana el prefijo MÁS LARGO, no el primero. Así `src/views/productos/tabminmax/`
// puede ser de `minmax` aunque `src/views/productos/` sea de `productos`, y el
// orden en que se escriben las áreas deja de importar. Un archivo que no
// empareja con ningún prefijo lo reporta el gate como HUÉRFANO — y un huérfano
// no es un detalle: es código que ninguna auditoría está mirando.

export const EJES = [
    // ── Construcción: ¿está hecho? ──────────────────────────────────────────
    { id: 'flujo',        peso: 3, bloque: 'Construcción', nombre: 'Flujo y lógica',
      pregunta: '¿El circuito cierra de punta a punta, incluidos los casos que nadie prueba: doble clic, el que se arrepiente, el que llega tarde?' },
    { id: 'datos',        peso: 3, bloque: 'Construcción', nombre: 'Datos y verdad',
      pregunta: '¿Lo que muestra es cierto? Techo de 1000 filas, tipo real de la columna, catálogos que son su propio rótulo, unidades que no se suman, fechas sin hora.' },
    { id: 'bd',           peso: 2, bloque: 'Construcción', nombre: 'Base de datos',
      pregunta: '¿El esquema aguanta? PK, RLS con policy explícita, índice que cubra cada FK, funciones con search_path, migraciones archivadas.' },

    // ── Blindaje: ¿aguanta? ─────────────────────────────────────────────────
    { id: 'seguridad',    peso: 3, bloque: 'Blindaje', nombre: 'Seguridad y permisos',
      pregunta: '¿Quién puede hacer qué, y lo decide el SERVIDOR? Policies sin USING(true), auth_* envuelto en (SELECT), nada ejecutable por anon, el alcance de sala respetado.' },
    { id: 'resiliencia',  peso: 2, bloque: 'Blindaje', nombre: 'Resiliencia',
      pregunta: '¿Qué pasa cuando falla? Error de red, error de supabase-js ignorado, reintento, doble envío, sesión que se cierra sola, borrador de un formulario largo.' },
    { id: 'observabilidad', peso: 2, bloque: 'Blindaje', nombre: 'Observabilidad y auditoría',
      pregunta: '¿Se puede reconstruir lo que pasó? appendAuditLog, historial, alerta que llega sola y no espera a que alguien mire.' },

    // ── Experiencia: ¿se puede usar? ────────────────────────────────────────
    { id: 'vista',        peso: 2, bloque: 'Experiencia', nombre: 'Vista y UI',
      pregunta: '¿Respeta el canon visual? gate:design en verde para sus archivos, tokens y no colores crudos, LiquidSelect, DESIGN.md.' },
    { id: 'movil',        peso: 2, bloque: 'Experiencia', nombre: 'Móvil',
      pregunta: '¿Funciona con el teléfono en la mano? Canon §32.8/§32.9, gate:movil, barrido de la ruta, diálogos medidos.' },
    { id: 'ux',           peso: 2, bloque: 'Experiencia', nombre: 'UX, copy y accesibilidad',
      pregunta: '¿Habla del portal y no del sistema de origen? Pestaña en la URL, blanco de dedo de 44pt, acuse al toque, estados vacíos, foco y teclado.' },
    { id: 'eficiencia',   peso: 2, bloque: 'Experiencia', nombre: 'Fluidez y eficiencia',
      pregunta: '¿Se siente rápido? Forma del plan de la consulta, índices usados, peso del chunk, cadencia de las tareas programadas.' },

    // ── Confianza: ¿lo sabemos? ─────────────────────────────────────────────
    { id: 'pruebas',      peso: 2, bloque: 'Confianza', nombre: 'Pruebas',
      pregunta: '¿Hay una prueba que falle si esto se rompe? Unitaria de la matemática, e2e del camino crítico, y una regresión fabricada para cada detector.' },
    { id: 'doc',          peso: 1, bloque: 'Confianza', nombre: 'Documentación y memoria',
      pregunta: '¿Está escrito donde se va a leer? CLAUDE.md para la regla que evita daño, DESIGN.md para el patrón, docs/ para el circuito, memoria para la lección.' },
];

// El sello de sala no es un eje: es una CONDICIÓN. Un área con los doce ejes en
// verde y sin sello llega a 95%, nunca a 100. La diferencia entre "construido" y
// "funciona" la decide una corrida real, y hoy hay catorce ítems abiertos en
// memoria que dicen exactamente «falta probarlo en sala».
export const TOPE_SIN_SELLO = 95;

export const AREAS = [
    // ═══ CHASIS ═════════════════════════════════════════════════════════════
    {
        id: 'plataforma',
        nombre: 'Plataforma y chasis',
        resumen: 'Lo que sostiene a todo lo demás: el enrutador, el layout, el cliente de Supabase, el tema, los componentes comunes, el service worker.',
        modulos: [],
        rutas: ['(todas)'],
        archivos: [
            'src/App.jsx', 'src/main.jsx', 'src/supabaseClient.js', 'src/entorno.js', 'src/version.js',
            'src/components/common/', 'src/components/layout/', 'src/components/GlassViewLayout.jsx',
            'src/components/MotionProvider.jsx', 'src/components/UnifiedModal.jsx',
            'src/constants/moduleMap.js', 'src/constants/routeImporters.js', 'src/constants/menuSearchKeywords.js',
            'src/constants/tipoIconos.js', 'src/constants/empresa.js', 'src/constants/erp.js',
            'src/context/', 'src/store/staffStore.js', 'src/store/toastStore.js', 'src/store/utils.js',
            'src/store/slices/systemSlice.js',
            'src/hooks/', 'src/utils/',
            'src/data/constants.js', 'src/data/system.js',
            'public/', 'vite.config.js', 'index.html',
        ],
        tablas: ['banner_portal', 'module_locks', 'mv_refresh_state', 'job_watermarks'],
        edge: [],
        crons: [],
        docs: ['DESIGN.md', 'CLAUDE.md', 'docs/CHECKLIST-VISTA-NUEVA.md'],
    },

    // ═══ QUIÉN ENTRA Y QUÉ PUEDE ════════════════════════════════════════════
    {
        id: 'acceso',
        nombre: 'Acceso, identidad y kiosco',
        resumen: 'Cómo entra una persona al portal y cómo marca: contraseña, carné, carné de papel del día, PIN del kiosco, código SU, sesiones vivas y bloqueos.',
        modulos: ['kiosk_pin', 'carne_temporal', 'su_pin', 'sesiones', 'bloqueos'],
        rutas: ['/login', '/kiosk', '/carnes-del-dia', '/sesiones'],
        archivos: [
            'src/views/LoginView.jsx', 'src/views/TimeClockView.jsx', 'src/views/CarnesDelDiaView.jsx',
            'src/views/SesionesView.jsx', 'src/views/AccessDeniedView.jsx', 'src/views/NoAccessView.jsx',
            'src/components/timeclock/', 'src/components/sesiones/', 'src/components/personal/',
            'src/data/auth.js', 'src/data/kiosco.js', 'src/data/kioskAuth.js', 'src/data/carneTemporal.js',
            'src/data/sesiones.js',
            'src/hooks/useKioskDevice.js', 'src/hooks/useTimeClockEngine.js', 'src/hooks/useCapturaDeCarne.js',
            'src/utils/kioskGrace.js', 'src/utils/kioskSound.js', 'src/utils/kioskAutorizacion.js',
            'src/utils/carnePrint.js',
            'src/utils/entregarCarneDePapel.js', 'src/utils/arranqueSesion.js',
            'src/utils/timeClock.audit.js', 'src/utils/timeClock.helpers.js', 'src/utils/timeClock.rules.js',
            'src/components/forms/FormSetPassword.jsx', 'src/components/forms/FormChangeOwnPassword.jsx',
            'src/components/forms/FormDispositivos.jsx',
            'src/utils/attendanceQueue.js',
        ],
        tablas: ['kiosk_credentials', 'kiosk_devices', 'kiosk_pin_attempts', 'carnes_temporales',
                 'login_rate_limit', 'session_activity', 'session_last_seen', 'employee_auth_accounts',
                 'intentos_identidad', 'identidad_vales'],
        edge: ['ensure_user_by_code', 'set-employee-password', 'disable-employee-auth',
               'bulk-create-employee-users', 'emitir-carne-temporal',
               'renombrar-usuario-empleado'],
        crons: ['purgar-carnes-temporales', 'purge-sesiones-vencidas', 'purge-session-activity-daily'],
        docs: ['docs/PLAN-CREDENCIAL-DE-CARNE-2026-08-12.md', 'docs/planes-cerrados/PLAN-SESIONES-SEGURAS-2026-08-08.md',
               'docs/SEGURIDAD-AUTORIZACION-2026-08-04.md', 'docs/PLAN-CERRAR-AUTORIZACION-2026-08-09.md'],
    },
    {
        id: 'permisos',
        nombre: 'Permisos, cargos y candado de módulo',
        resumen: 'El registro de 156 llaves, quién las tiene, el alcance de sala, la herencia por ausencia y el candado de mantenimiento por módulo.',
        modulos: ['permissions', 'roles', 'maintenance'],
        rutas: ['/permisos', '/cargos', '/mantenimiento'],
        archivos: [
            'src/views/PermissionsView.jsx', 'src/views/RolesView.jsx', 'src/views/MaintenanceView.jsx',
            'src/components/mantenimiento/',
            'src/constants/permissionModules.js', 'src/constants/solicitudModulos.js',
            'src/data/permissions.js', 'src/data/moduleLocks.js',
            'src/utils/roles.js',
            'src/components/forms/FormRoleEmployees.jsx',
            'scripts/permissions-gate.mjs',
        ],
        tablas: ['role_permissions', 'roles'],
        edge: [],
        crons: [],
        docs: ['docs/planes-cerrados/AUDITORIA-PERMISOS-2026-08-03.md'],
    },

    // ═══ EL TABLERO ═════════════════════════════════════════════════════════
    {
        id: 'tablero',
        nombre: 'Tablero de inicio',
        resumen: 'La primera pantalla: 28 widgets acomodables, sus lanzadores de solicitud y las baldosas de instrumento.',
        modulos: ['overview', 'dash_kpi', 'dash_trend', 'dash_requests', 'dash_branches', 'dash_calendar',
                  'dash_announcements', 'dash_shifts', 'dash_absences', 'dash_sales', 'dash_birthdays',
                  'dash_cotizaciones', 'dash_facturacion', 'dash_top_productos', 'dash_inv_search',
                  'dash_annulment_req', 'dash_minmax_req', 'dash_inv_movement', 'dash_traslados',
                  'dash_cortes_sala', 'dash_bolsas_sala', 'dash_bitacoras', 'dash_recetas_pendientes',
                  'dash_facturas_sala', 'dash_meta_sala', 'dash_meta_sala_vista_completa',
                  'dash_vendedores', 'dash_vendedores_vista_completa'],
        rutas: ['/inicio'],
        archivos: [
            'src/views/DashboardView.jsx', 'src/views/dashboard/',
            'src/constants/dashboardTabs.js',
            'src/data/dashboard.js',
            'src/utils/acomodoWidgets.js',
        ],
        tablas: ['user_dashboard_prefs', 'dashboard_canon'],
        edge: [],
        crons: [],
        docs: ['docs/TABLERO-DONDE-QUEDA-CADA-WIDGET-2026-08-24.md'],
    },

    // ═══ GENTE ══════════════════════════════════════════════════════════════
    {
        id: 'personal',
        nombre: 'Personal y expediente',
        resumen: 'El listado de empleados, el expediente completo, documentos, eventos programados, autogestión y practicantes.',
        modulos: ['staff_list', 'staff_list_descargar', 'staff_detail', 'staff_salary',
                  'emp_profile', 'emp_documents'],
        rutas: ['/personal', '/personal/empleado/:id', '/mi-perfil', '/mis-documentos'],
        archivos: [
            'src/views/EmployeeDetailView.jsx',
            'src/views/personal/',
            'src/utils/estadoDePersona.js', 'src/utils/mandoDeSala.js', 'src/utils/directorioCsv.js',
            'src/data/estadosDePersonas.js',
            'src/components/common/AvatarConEstado.jsx',
            'src/views/employee/EmployeeProfileView.jsx', 'src/views/employee/EmployeeDocumentsView.jsx',
            'src/components/practicantes/',
            'src/data/employees.js', 'src/data/employeeSelfService.js', 'src/data/practicantes.js',
            // El régimen disciplinario del RIT Art. 83: la escalera, la
            // constancia y el reclamo del Art. 77. Va en Personal porque lo que
            // escribe es el expediente — aunque su efecto se sienta en el
            // kiosco y en la planilla.
            'src/data/disciplina.js', 'src/components/personal/SancionModal.jsx',
            'src/data/nationalities.js',
            'src/store/slices/employeeSlice.js', 'src/store/slices/practicantesSlice.js',
            'src/utils/ageUtils.js', 'src/utils/nameUtils.js', 'src/utils/staffHelpers.js',
            'src/utils/economicDependents.js', 'src/utils/educationCatalogs.js',
            'src/components/forms/EmployeeFormModal.jsx', 'src/components/forms/FormRehireEmployee.jsx',
            // Un documento que nombra a VARIAS personas —el acuse del Ministerio
            // por una recontratación—: el reparto y su cruce de nombres contra
            // el padrón. Va en Personal porque lo que escribe es el expediente.
            'src/components/forms/AsignarDocumentoAVarios.jsx', 'src/data/documentosCompartidos.js',
            // La foto que se toma con el teléfono y llega a la computadora: es
            // parte del alta de personal, aunque su pantalla viva fuera del menú.
            'src/data/capturaDeFoto.js', 'src/views/CapturaDeFotoView.jsx',
            // El lado del teléfono vive aparte del de la computadora por peso:
            // `FileField` importa el segundo desde los 21 adjuntos del portal.
            'src/data/capturaDesdeElTelefono.js', 'src/components/common/DialogoDeCaptura.jsx',
            'src/components/forms/FormAddCustomDocument.jsx', 'src/components/forms/FormDocumentViewer.jsx',
            'src/components/forms/FormEditContact.jsx', 'src/components/forms/FormUploadOnly.jsx',
            'src/components/forms/FormNovedad.jsx',
            'src/utils/documentExpiry.js', 'src/utils/fotoDocumento.js', 'src/utils/capturaDeFoto.js',
            'src/utils/expediente.js', 'src/utils/duiLeido.js',
            // El carné de dependiente pasó a ser un QR del CSSP: se guarda su
            // dirección, no una foto.
            'src/utils/carneDeDependiente.js', 'src/components/common/CarneDeDependiente.jsx',
            'src/utils/nupAfp.js',
            'src/data/recorteSugerido.js',
            // Preparar el documento SOLO al elegirlo: detectar las esquinas,
            // enderezar, ajustar al papel (carta, oficio o cédula) y dar el
            // acabado. `componerDocumento` es la tubería que comparten el
            // camino automático y el editor.
            'src/data/prepararDocumento.js', 'src/utils/componerDocumento.js',
            'src/utils/formatosDePapel.js',
            'src/utils/perspectiva.js',
            'src/utils/leerQrDeImagen.js',
            'src/components/common/VisorDeDocumento.jsx',
            'src/utils/contrato.js', 'src/utils/acreditaciones.js',
        ],
        tablas: ['employees', 'employee_branches', 'employee_documents', 'employee_events',
                 'practicantes', 'education_catalog_entries'],
        // `subir-foto-de-captura` la creó otra sesión el 2026-08-27 y quedó sin
        // mapear, lo que bloquea el gate para todo el mundo. Va acá porque el
        // efecto es una foto de PERSONAL: escribe en el bucket `empleados`.
        // Si esa sesión la ubica en otro lado, gana su decisión.
        edge: ['apply-scheduled-employee-events', 'check-employee-doc-expiry', 'leer-dui',
               'subir-foto-de-captura',
               // `soltar-captura` vacía el buzón del traspaso: el efecto es
               // sobre documentos de PERSONAL, así que vive con su gemela.
               'soltar-captura'],
        crons: ['apply-scheduled-employee-events-daily', 'check-employee-doc-expiry-daily',
                'soltar-capturas-abandonadas'],
        docs: ['docs/PERSONAL-EL-EXPEDIENTE-Y-LO-QUE-NO-SE-PUBLICA-2026-08-24.md'],
    },
    {
        id: 'asistencia',
        nombre: 'Asistencia y marcaciones',
        resumen: 'El monitor en vivo, la auditoría de tiempos, la consolidación diaria de horas y el banco de horas extra.',
        modulos: ['monitor', 'time_audit', 'time_audit_descargar'],
        rutas: ['/monitor', '/auditoria-de-tiempos'],
        archivos: [
            'src/views/AttendanceMonitorView.jsx', 'src/views/AttendanceAuditView.jsx',
            'src/data/attendanceAudit.js', 'src/views/asistencia/quincena.js',
        ],
        tablas: ['attendance', 'timesheets', 'overtime_bank'],
        edge: ['consolidate-timesheets'],
        crons: ['consolidate-timesheets-daily'],
        docs: ['docs/ASISTENCIA-COMO-SE-CUENTA-EL-TIEMPO-2026-08-24.md'],
    },
    {
        id: 'horarios',
        nombre: 'Horarios, turnos y vacaciones',
        resumen: 'El calendario semanal, el catálogo de turnos, los feriados, la cobertura entre salas y el plan anual de vacaciones.',
        modulos: ['schedules', 'schedules_tab_calendar', 'schedules_tab_shifts', 'schedules_tab_holidays',
                  'vacation_plan'],
        rutas: ['/horarios', '/vacaciones'],
        archivos: [
            'src/views/SchedulesView.jsx', 'src/views/schedule-tabs/', 'src/views/VacationPlanView.jsx',
            'src/data/schedules.js', 'src/data/vacationPlans.js',
            'src/store/slices/vacationPlanSlice.js',
            'src/utils/scheduleHelpers.js', 'src/utils/semana.js', 'src/utils/turnoDelDia.js',
            // `FormPlanificador`, `FormTurnos` y `FormAiSchedulerPreview` se
            // borraron el 2026-08-27: ningún `openModal` los abría.
            'src/components/forms/FormWfmAnalytics.jsx',
            'src/components/forms/GraficaAfluencia.jsx', 'src/components/forms/FormVacationRecall.jsx',
        ],
        tablas: ['employee_rosters', 'shifts', 'holidays', 'schedule_coverage',
                 'vacation_plans', 'vacation_plan_headers', 'wfm_snapshots'],
        edge: ['auto-copy-weekly-roster', 'generate-vacation-plan', 'wfm-ai-scheduler'],
        // `auto-copy-roster-saturday` se apagó el 2026-08-27: era un duplicado de
        // `auto-copy-weekly-roster` a las 06:00 UTC que copiaba ANTES de que la
        // alarma de las 15:00 preguntara si faltaban horarios — así que esa
        // alarma no podía sonar nunca, y ninguna corrección hecha el sábado se
        // propagaba.
        crons: ['auto-copy-weekly-roster', 'roster-missing-alert-saturday',
                'wfm_weekly_snapshot'],
        docs: ['docs/HORARIOS-LA-SEMANA-EL-DIA-Y-LA-COPIA-AUTOMATICA-2026-08-24.md'],
    },
    {
        id: 'nomina',
        nombre: 'Nómina',
        resumen: 'La planilla quincenal y las boletas impresas.',
        // `bonificaciones` vivía acá porque el nombre del slot vacío sonaba a
        // planilla. Al construirse el 2026-09-01 resultó ser otra cosa —una
        // campaña comercial de laboratorio— y se mudó a su área propia
        // (`promociones`) con su ruta. La bonificación ligada a la meta sigue
        // siendo del área `metas`, que es donde se calcula.
        modulos: ['payroll', 'payroll_descargar'],
        rutas: ['/nomina'],
        archivos: [
            'src/views/PayrollView.jsx',
            'src/data/payroll.js',
            'src/store/slices/payrollSlice.js',
            'src/components/forms/FormNewPayrollPeriod.jsx', 'src/components/forms/FormEditPayrollEntry.jsx',
        ],
        tablas: ['payroll_entries', 'payroll_periods'],
        edge: [],
        crons: [],
        docs: ['docs/NOMINA-COMO-SE-ARMA-UNA-QUINCENA-2026-08-24.md',
               'docs/FALTANTES-DE-CAJA-Y-DE-INVENTARIO-2026-08-27.md'],
    },
    {
        id: 'solicitudes',
        nombre: 'Solicitudes y aprobaciones',
        resumen: 'El centro de la sala y el de la persona: descartes, cargas, traslados, Min/Max, facturación, vacaciones, anticipos. Con su enrutador de aprobadores.',
        modulos: ['requests', 'requests_facturacion', 'requests_inventario', 'requests_minmax',
                  'requests_personales'],
        rutas: ['/solicitudes', '/solicitudes-personales'],
        archivos: [
            'src/views/RequestsView.jsx', 'src/views/solicitudes/',
            'src/data/requests.js', 'src/data/solicitudDeAviso.js',
            'src/store/slices/requestsSlice.js',
            'src/hooks/useDecidirSolicitud.js',
            'src/utils/minmaxSolicitud.js',
        ],
        tablas: ['approval_requests'],
        // Las dos funciones que APLICAN una solicitud aprobada no viven acá:
        // `aplicar-movimiento-inventario` es de inventario y
        // `aplicar-solicitud-facturacion` es de facturación. La regla es que una
        // función pertenece a donde produce el EFECTO, no a donde se dispara —
        // si no, la misma pieza queda congelada por dos áreas y descongelada por
        // cualquiera de las dos.
        edge: [],
        crons: [],
        docs: ['docs/SOLICITUDES-QUIEN-DECIDE-Y-QUIEN-LO-VE-2026-08-24.md'],
    },
    {
        id: 'comunicacion',
        nombre: 'Avisos, notificaciones y encuestas',
        resumen: 'Los comunicados internos, el push al teléfono, la campana del portal y la encuesta de clima organizacional.',
        modulos: ['announcements', 'emp_announcements', 'encuesta', 'encuesta_admin', 'entrevistas'],
        rutas: ['/avisos', '/mis-avisos', '/encuesta', '/encuesta-admin', '/entrevistas'],
        archivos: [
            'src/views/AnnouncementsView.jsx', 'src/views/employee/EmployeeAnnouncementsView.jsx',
            'src/views/EncuestaView.jsx', 'src/views/EncuestaAdminView.jsx',
            'src/data/notifications.js', 'src/data/pushSubscriptions.js', 'src/data/encuestas.js',
            'src/store/slices/notificationsSlice.js',
            'src/hooks/useNotificationsChannel.js', 'src/hooks/usePushSubscription.js',
            'src/utils/announcementAudience.js', 'src/utils/browserNotif.js', 'src/utils/notify.js',
            'src/utils/pushEquipo.js',
            'src/components/forms/FormAnnouncements.jsx',
        ],
        tablas: ['announcements', 'notifications', 'avisos_emitidos', 'push_subscriptions',
                 'surveys', 'survey_bloques', 'survey_preguntas', 'survey_responses'],
        edge: ['send-push-notification'],
        crons: ['purge-notifications-daily'],
        docs: ['docs/AVISOS-Y-PUSH-CUANDO-EL-CANAL-SE-ROMPE-2026-08-24.md'],
    },
    {
        id: 'sucursales',
        nombre: 'Sucursales',
        resumen: 'El expediente de cada sala: datos, inmueble, legal, servicios, horarios, gastos y su historial.',
        modulos: ['branches', 'branches_descargar'],
        rutas: ['/sucursales', '/sucursales/:id'],
        archivos: [
            'src/views/BranchesView.jsx', 'src/views/BranchDetailView.jsx', 'src/views/branch-tabs/',
            'src/data/branches.js',
            'src/store/slices/branchSlice.js',
            // Los formularios de `components/forms/` los abre UnifiedModal por
            // un `type`, así que ninguna vista los importa y un grep por nombre
            // no encuentra dueño. Se asignan a mano, uno por uno: dejarlos
            // huérfanos sería dejar sin auditar la mitad de la escritura del
            // portal — ahí es donde se GUARDAN los datos, no donde se ven.
            'src/components/forms/BranchHelpers.jsx', 'src/components/forms/BranchTabGeneral.jsx',
            'src/components/forms/BranchTabHorarios.jsx', 'src/components/forms/BranchTabInmueble.jsx',
            'src/components/forms/BranchTabLegal.jsx', 'src/components/forms/BranchTabServicios.jsx',
            'src/components/forms/FormBranchEmployees.jsx', 'src/components/forms/FormSucursal.jsx',
            'src/components/forms/FormLeadership.jsx', 'src/components/forms/FormServicePayment.jsx',
            'src/components/forms/FormSrsPermit.jsx', 'src/components/forms/FormPharmacyRegent.jsx',
            'src/components/forms/FormNursingRegents.jsx',
            'src/components/forms/FormPharmacovigilance.jsx',
        ],
        tablas: ['branches', 'branch_documents', 'branch_expenses', 'erp_sucursal_map'],
        edge: ['analyze-branch', 'check-doc-expiry'],
        crons: ['check-doc-expiry-daily'],
        docs: ['docs/SUCURSALES-EL-EXPEDIENTE-DE-CADA-SALA-2026-08-24.md'],
    },

    // ═══ COMERCIAL ══════════════════════════════════════════════════════════
    {
        id: 'ventas',
        nombre: 'Ventas',
        resumen: 'Lo vendido: anulaciones en vivo, ranking de vendedores, productos más vendidos, cuadre diario y lo que se cobra sin ser venta de productos.',
        modulos: ['ventas', 'ventas_tab_ventas', 'ventas_tab_vendedores', 'ventas_tab_productos',
                  'ventas_ver_cards', 'ventas_no_producto'],
        rutas: ['/ventas'],
        archivos: [
            'src/views/VentasView.jsx',
            'src/data/ventas.js',
            'src/components/common/AvisoSinProducto.jsx',
            // La costura con el sistema de puntos. Vive acá y no en Clientes
            // porque la sirve la misma función y el estado es de una VENTA;
            // la ficha del cliente es su segundo consumidor.
            'src/data/puntos.js',
        ],
        tablas: ['sales_invoices', 'sales_invoice_items', 'sales_invoice_changelog', 'sales_daily_stats',
                 'ventas_monthly_stats', 'sales_alert_log', 'sales_gap_resolutions',
                 'sales_invoice_resolutions', 'sales_null_resolutions', 'sales_observation_resolutions',
                 'sales_payment_confirmations', 'ventas_cuadre_hallazgos', 'clientes_sin_producto',
                 'product_last_sale', 'product_sales_rollup', 'product_sales_monthly_agg',
                 'puntos_enviados',
                 // El libro mayor del programa, en el portal (2026-09-01). Va con
                 // sus hermanas de puntos y no en Clientes porque el hecho que
                 // registra es el de una VENTA; la ficha es su segundo lector.
                 // Hoy están VACÍAS y nada las escribe: encender el programa son
                 // dos actos aparte —migrar los saldos y crear el cron— que
                 // todavía no se hicieron. Ver
                 // docs/PLAN-PUNTOS-EN-SUPABASE-2026-09-01.md
                 'puntos_cuenta', 'puntos_lote', 'puntos_salida', 'puntos_salida_lote',
                 'puntos_vencimiento_log', 'puntos_config'],
        edge: ['sync-dte-sales', 'sync-wfm-sales', 'check-sales-alerts', 'check-sales-reconciliation',
               'backfill-dte-sales', 'heal-dte-sync', 'sync-puntos', 'puntos-probe',
               // `puntos-vencer` la creó otra sesión el 2026-08-31 y quedó sin
               // mapear, lo que bloquea el gate —y el commit— para todo el
               // mundo. Va con sus hermanas de puntos, que es donde produce el
               // efecto. Si esa sesión la ubica en otro lado, gana su decisión.
               'puntos-consulta', 'puntos-vencer',
               // Escritas el 2026-09-01 y NO desplegadas: producción sigue
               // corriendo el circuito viejo. `puntos-motor` es el futuro cron
               // (acumular + canjes + anulaciones) y `puntos-traer-saldos` el
               // puente de una sola vez para la migración.
               'puntos-motor', 'puntos-traer-saldos'],
        crons: ['sync-dte-inv-all-1min', 'check-sales-alerts-5min', 'check-sales-reconciliation-daily',
                'close-ventas-month', 'refresh-sales-daily-stats', 'refresh-sales-daily-stats-full',
                'refresh-product-sales-rollup-daily', 'refresh-product-sales-monthly-agg',
                'refresh-primera-venta-daily', 'heal-dte-sync', 'dte-resync-mes-hora',
                'vacuum-sales-invoices',
                'dte-resync-month-popular', 'dte-resync-month-salud1', 'dte-resync-month-salud2',
                'dte-resync-month-salud3', 'dte-resync-month-salud4', 'dte-resync-month-salud5'],
        docs: ['docs/VENTAS-DE-DONDE-SALE-CADA-NUMERO-2026-08-24.md',
               'docs/PUNTOS-EL-CIRCUITO-Y-LO-QUE-FALTA-2026-08-29.md'],
    },
    {
        id: 'metas',
        nombre: 'Metas y cumplimiento',
        resumen: 'La meta mensual por sala: propuesta, confirmación en cadena, gastos, factor de cumplimiento y el bono que sale de ahí.',
        modulos: ['metas'],
        rutas: ['/metas'],
        archivos: [
            'src/views/metas/',
            'src/data/metas.js',
        ],
        tablas: ['metas_config', 'metas_factor_cumplimiento', 'metas_gasto', 'metas_gasto_cuota',
                 'metas_gasto_sala', 'metas_historial', 'metas_resultado', 'metas_sucursal'],
        edge: [],
        crons: ['metas-ciclo-diario'],
        docs: ['docs/PLAN-METAS-CIERRE-Y-GASTOS-2026-08-05.md'],
    },
    {
        id: 'promociones',
        nombre: 'Promociones',
        resumen: 'Los dos programas de bonificación de laboratorio. Por PRODUCTO: paga por unidad vendida, con el lote declarado y repartido por sala, su cierre automático y el aviso a la sala que se queda sin producto. Por LABORATORIO: si la sala vende el umbral del mes, cada persona gana el monto de ese nivel; el mes se congela al terminar. Y la LIQUIDACIÓN mensual, que junta los tres bonos en una hoja por persona y la congela al aprobarla.',
        modulos: ['promociones'],
        rutas: ['/promociones'],
        archivos: [
            'src/views/promociones/',
            'src/data/promociones.js',
            'src/data/liquidacion.js',
        ],
        tablas: ['promociones', 'promocion_renglon', 'promocion_renglon_tarifa',
                 'promocion_reparto', 'promocion_reparto_mov', 'promocion_excedente',
                 'promocion_historial',
                 'promocion_laboratorio', 'promocion_nivel', 'promocion_nivel_umbral',
                 'promocion_cierre_sala',
                 'liquidacion', 'liquidacion_detalle', 'liquidacion_historial'],
        edge: [],
        crons: ['promociones-ciclo-diario'],
        docs: ['docs/PLAN-PROMOCIONES-2026-09-01.md'],
    },
    {
        id: 'cortes-efectivo',
        nombre: 'Cortes de caja y bolsas de efectivo',
        resumen: 'El cierre de turno de cada caja, las diferencias y su resolución, y el recorrido del dinero físico hasta administración.',
        modulos: ['cortes_caja', 'bolsas', 'bolsas_conteo', 'bolsas_ver_montos', 'bolsas_ver_cards'],
        rutas: ['/cortes', '/bolsas'],
        archivos: [
            'src/views/CortesView.jsx', 'src/views/BolsasView.jsx', 'src/views/bolsas/',
            'src/views/MiCajaView.jsx',
            'src/components/cortes/', 'src/components/bolsas/', 'src/components/caja/',
            'src/data/cortes.js', 'src/data/bolsas.js',
            'src/hooks/useCerrarBolsa.js', 'src/hooks/useResolverCorte.js', 'src/hooks/useCortesDeAvisos.js',
            'src/utils/bolsaComprobante.js', 'src/utils/bolsasReparto.js', 'src/utils/corteComprobante.js',
            'src/utils/cortesDiagnostico.js', 'src/utils/cajasEspeciales.js',
            'src/utils/corteTicket.js', 'src/utils/abonoTicket.js', 'src/utils/movimientoTicket.js',
            'src/data/creditos.js', 'src/views/CuentasPorCobrarView.jsx',
        ],
        tablas: ['cortes_caja', 'cortes_caja_diferencia_personas', 'cortes_caja_diferencias',
                 'cortes_caja_eventos', 'cortes_caja_movimientos',
                 'cortes_caja_movimientos_historial', 'cortes_caja_aperturas',
                 'cortes_caja_vistazos',
                 'caja_vales_portal', 'caja_aperturas_del_portal', 'caja_movimientos_portal',
                 'caja_tipos_movimiento', 'abonos_de_cliente', 'creditos_abonos_portal',
                 'creditos_de_clientes', 'creditos_sync', 'pos_proveedores',
                 'bolsas', 'bancos', 'bolsas_conteos', 'bolsas_entidades', 'bolsas_entregas',
                 'bolsas_eventos', 'bolsas_movimientos',
                 'bolsas_operaciones', 'bolsas_tipos_salida', 'depositos_bancarios'],
        // `creditos-erp` va acá y no en Facturación: abonar a un crédito mete
        // EFECTIVO al cajón, y ese dinero cuenta para el corte del mismo día.
        edge: ['sync-cortes-caja', 'sync-aperturas-caja', 'anotar-vales-caja', 'hacer-corte-caja', 'operar-caja',
               'creditos-erp', 'sync-creditos', 'avisar-creditos-vencidos', 'leer-pago-de-credito'],
        crons: ['cortes-caja-30s', 'cortes-caja-repaso-diario', 'cortes-pendientes-0730-sv',
                'creditos-cada-10min', 'creditos-barrido-completo', 'creditos-vencidos-0800-sv'],
        docs: ['docs/CORTES-DE-CAJA-COMO-FUNCIONA-2026-08-14.md', 'docs/PLAN-BOLSAS-DE-EFECTIVO-2026-08-15.md',
               'docs/FALTANTES-DE-CAJA-Y-DE-INVENTARIO-2026-08-27.md'],
    },
    {
        id: 'facturacion-dte',
        nombre: 'Facturación, DTE y clientes',
        resumen: 'El documento electrónico: sello de Hacienda, anuladas, saltos de numeración, corrección de fichas de cliente y su reenvío. Más cotizaciones.',
        modulos: ['facturacion', 'facturacion_tab_anuladas', 'facturacion_tab_pendiente_mh',
                  'facturacion_tab_saltos', 'facturacion_tab_no_efectivo', 'facturacion_tab_observaciones',
                  'facturacion_ver_montos', 'clientes', 'clientes_ver_montos',
                  'cotizaciones', 'cotizaciones_descargar'],
        rutas: ['/facturacion', '/clientes', '/cotizaciones', '/mis-puntos'],
        archivos: [
            'src/views/FacturacionView.jsx', 'src/views/ClientesView.jsx', 'src/views/clientes/',
            'src/views/CotizacionesView.jsx',
            'src/data/facturacion.js', 'src/data/customers.js', 'src/data/cotizaciones.js',
            'src/data/datosPedidos.js', 'src/views/dashboard/WidgetDatoPedido.jsx',
            'src/data/elSalvadorGeo.js',
            'src/utils/clienteValidacion.js', 'src/utils/duiUtils.js', 'src/utils/nitUtils.js',
            'src/utils/dteIva.js', 'src/utils/dtePdfCodigo.js', 'src/utils/dteTypes.js',
            'src/utils/svCatalogs.js',
            'src/components/forms/FormClienteDetail.jsx', 'src/components/forms/FormSalesDteViewer.jsx',
            'scripts/migracion-clientes/',
            // La pantalla del CLIENTE, sin sesión. Va acá y no en Ventas porque
            // lo que muestra es el dato de una persona, y su puerta es la ficha.
            'src/views/MisPuntosView.jsx', 'src/data/misPuntos.js',
        ],
        tablas: ['customers', 'customers_changelog', 'customer_activity', 'clientes_por_revisar',
                 'cotizaciones', 'cotizacion_items', 'dte_correcciones_ficha', 'dte_excluidas_del_barrido',
                 'dte_datos_pedidos',
                 'dte_mh_intentos', 'sales_dte_documents', 'espejo_conflictos',
                 'puntos_consulta_intentos'],
        edge: ['regularizar-dte', 'sincronizar-fichas-clientes', 'push-cliente-erp',
               'aplicar-solicitud-facturacion', 'sync-sales-dte', 'sync-numero-control',
               'backfill-dte-related-docs', 'leer-dte-json', 'mis-puntos',
               // La dispara una sala desde Inicio, pero el EFECTO es fiscal:
               // escribe el correo en la ficha de origen y retransmite el DTE.
               'responder-dato-pedido'],
        crons: ['regularizar-dte-2230-sv', 'sincronizar-fichas-clientes-2130-sv', 'drain-cliente-erp-queue',
                'ccf-repaso-22h-sv', 'alerta-barrido-dte-8am-sv', 'sync-numero-control-daily',
                'refresh-customer-activity-daily'],
        docs: ['docs/RETOMAR-FACTURACION-Y-DTE-2026-08-09.md', 'docs/resumen-dte-el-salvador.md',
               'docs/RETOMAR-CLIENTES-2026-08-01.md'],
    },

    // ═══ PRODUCTO Y EXISTENCIA ══════════════════════════════════════════════
    {
        id: 'productos',
        nombre: 'Productos, presentaciones y laboratorios',
        resumen: 'El catálogo: ficha del producto, presentaciones, principios activos, precios y su historial, laboratorios y política de vencimiento.',
        modulos: ['productos', 'productos_tab_catalogo', 'productos_tab_presentaciones',
                  'productos_ver_costos', 'laboratorios'],
        rutas: ['/productos', '/laboratorios'],
        archivos: [
            'src/views/ProductosView.jsx', 'src/views/productos/TabCatalogo.jsx',
            'src/views/productos/TabLaboratorios.jsx', 'src/views/productos/TabPresentaciones.jsx',
            'src/views/productos/TabPoliticaVencimiento.jsx',
            'src/views/LaboratoriosView.jsx',
            'src/data/productos.js', 'src/data/presentaciones.js', 'src/data/laboratorios.js',
            'src/data/minmaxLabs.js',
            'src/utils/presentacion.js', 'src/utils/unidadesInventario.js',
        ],
        tablas: ['products', 'products_changelog', 'products_sync_log', 'presentaciones',
                 'product_active_principles', 'product_categories', 'product_locations',
                 'product_precios', 'product_precios_changelog', 'product_precios_history',
                 'laboratorios', 'lab_locations'],
        edge: ['sync-products', 'notify-new-products-daily'],
        crons: ['sync-products-10min', 'notify-new-products-daily', 'vacuum-products-hourly'],
        docs: ['docs/PRODUCTOS-LA-PRESENTACION-Y-EL-FACTOR-2026-08-24.md'],
    },
    {
        id: 'inventario',
        nombre: 'Inventario, conteo y ventas perdidas',
        resumen: 'La existencia por sala: consulta, gestión de stock, ajustes, conteo cíclico a ciegas y el registro de lo que no se pudo vender.',
        modulos: ['inventario', 'gestion_stock', 'conteo_inventario', 'conteo_ver_sistema',
                  'conteo_inventario_descargar', 'conteo_inventario_ver_montos', 'conteo_inventario_eliminar',
                  'ventas_perdidas', 'ventas_perdidas_descargar'],
        rutas: ['/inventario', '/gestion-stock', '/conteo-inventario', '/conteo-inventario/:id',
                '/ventas-perdidas'],
        archivos: [
            'src/views/InventarioView.jsx', 'src/views/GestionStockView.jsx',
            'src/views/ConteoInventarioView.jsx', 'src/views/inventario/',
            'src/views/VentasPperdidasView.jsx',
            'src/components/inventario/',
            'src/data/inventory.js', 'src/data/inventarioTab.js', 'src/data/inventoryMovements.js',
            // La subida de la evidencia fotográfica: la usan el descargue por daño,
            // la devolución de un pedido y el envío por avería. Va acá porque el
            // depósito es `inventario-evidencia` y de acá salieron sus reglas.
            'src/data/evidencia.js',
            'src/data/conteoInventario.js', 'src/data/ventasPerdidas.js',
            'src/store/slices/conteoInventarioSlice.js',
            'src/utils/conteoInventarioPrint.js',
        ],
        tablas: ['inventory', 'inventory_sync_huella', 'inventory_sync_log',
                 'conteos_inventario', 'conteo_inventario_items', 'conteo_inventario_item_history',
                 'ventas_perdidas'],
        edge: ['aplicar-movimiento-inventario', 'analyze-history'],
        crons: ['refresh-inv-mv-2min', 'crear-conteos-ciclicos-mensual', 'vacuum-inventory-hourly'],
        docs: ['docs/RETOMAR-AJUSTE-INVENTARIO-2026-08-06.md',
               'docs/FALTANTES-DE-CAJA-Y-DE-INVENTARIO-2026-08-27.md'],
    },
    {
        id: 'minmax',
        nombre: 'Min · Máx',
        resumen: 'El cálculo de mínimo y máximo por producto y sala: velocidad, clasificación ABC/XYZ, borradores, publicación y ajuste a mano.',
        modulos: ['minmax', 'minmax_tab_sucursal', 'minmax_ver_costos', 'minmax_descargar'],
        rutas: ['/minmax'],
        archivos: [
            'src/views/MinMaxView.jsx', 'src/views/productos/TabMinMax.jsx',
            'src/views/productos/tabminmax/',
            'src/data/stockParams.js', 'src/data/minmaxRequests.js',
        ],
        tablas: ['product_stock_params', 'product_stock_params_history', 'stock_config',
                 'minmax_change_requests', 'minmax_ignored', 'minmax_sync_log',
                 // La foto diaria de existencias. Vive acá y no en `inventario`
                 // porque su motivo de existir es el cálculo: sin saber qué días
                 // un producto estuvo en cero, la velocidad no puede distinguir
                 // «dejó de venderse» de «faltó», y esas dos piden lo contrario.
                 'inventory_daily'],
        edge: ['auto-calculate-minmax'],
        crons: ['auto-calculate-minmax-monthly',
                'inventory-daily-snapshot', 'inventory-daily-particiones'],
        docs: ['docs/PLAN-FACTOR-Y-MINMAX-2026-08-13.md', 'docs/planes-cerrados/PLAN-MINMAX-AJUSTE-A-MANO-2026-08-20.md',
               'docs/planes-cerrados/PLAN-MINMAX-Y-CANDADO-2026-07-29.md'],
    },

    // ═══ MOVIMIENTO DE PRODUCTO ═════════════════════════════════════════════
    {
        id: 'pedidos',
        nombre: 'Pedidos a sucursales',
        resumen: 'De la sugerencia al despacho: generar, confirmar, armar cajas, ruta de entrega, recepción firmada, diferencias y devolución.',
        modulos: ['pedidos', 'pedidos_tab_generar', 'pedidos_tab_historial', 'pedidos_tab_rutas',
                  'pedidos_tab_metricas', 'pedidos_tab_reglas', 'pedidos_descargar'],
        rutas: ['/pedidos'],
        archivos: [
            'src/views/PedidosView.jsx', 'src/views/pedidos/',
            'src/data/pedidos.js', 'src/data/devoluciones.js', 'src/data/diferencias.js',
            'src/data/dispatchRules.js', 'src/data/recepcion.js',
            'src/hooks/useResolverDiferencia.js',
            'src/utils/pedidoPrint.js', 'src/utils/hojasRecepcion.js', 'src/utils/avisoSalidaPedido.js',
            'src/utils/routeOptimizer.js', 'src/utils/decisionDiferencia.js',
        ],
        tablas: ['pedidos', 'pedido_items', 'pedido_apoyo', 'pedido_devolucion', 'pedido_item_eventos',
                 'pedido_pausa_historial', 'pedido_recepcion_extras', 'pedido_recepcion_firmas',
                 'pedido_sucursal_status', 'pedido_traslado_erp', 'pedido_traslado_linea',
                 'pedidos_snapshots', 'dispatch_rules', 'rutas', 'ruta_pedidos', 'ruta_locations',
                 'diferencia_opcion'],
        edge: ['trasladar-pedido-erp', 'devolver-pedido-erp', 'maps-proxy'],
        crons: ['continuar-traslados-pedido', 'reintentar-ingreso-pedido'],
        docs: ['docs/RESOLUCION-DIFERENCIAS-PEDIDOS.md', 'docs/INCIDENTE-RECEPCION-2026-08-14.md',
               'docs/planes-cerrados/PRUEBA-TRASLADO-2026-08-11.md'],
    },
    {
        id: 'traslados',
        nombre: 'Traslados entre salas',
        resumen: 'El producto que se mueve fuera del pedido: la sala pide, otra confirma, y el envío al revés. Incluye el área de vencidos, la sala de respaldo y lo que no llegó en la bolsa.',
        modulos: ['traslados', 'dash_traslados'],
        rutas: ['/traslados'],
        archivos: [
            'src/views/TrasladosView.jsx', 'src/views/traslados/',
            'src/data/traslados.js', 'src/data/envios.js', 'src/data/trasladoSwitch.js',
            'src/data/retiros.js', 'src/data/faltantes.js',
            'src/store/composicionTraslado.js',
        ],
        tablas: ['envio_linea', 'traslado_interruptor', 'retiros', 'retiro_bultos', 'bolsa_faltante'],
        edge: ['aplicar-traslado-inventario', 'enviar-producto-erp', 'barrer-traslados-recibidos',
                'avisar-bultos-viejos'],
        crons: ['barrer-traslados-recibidos', 'continuar-envios', 'avisar-envios-sin-decidir',
                'avisar-traslados-por-respaldo-0805-sv', 'avisar-bultos-viejos-daily'],
        docs: ['docs/planes-cerrados/RETOMAR-TRASLADOS-2026-08-06.md', 'docs/PLAN-SOLICITUD-A-VARIAS-SALAS-2026-08-20.md'],
    },

    // ═══ COMPRAS Y CONTABILIDAD ═════════════════════════════════════════════
    {
        id: 'compras',
        nombre: 'Compras y cuentas por pagar',
        resumen: 'Lo que entra por la puerta: la compra del sistema de origen, el documento que llega por correo, la carga a inventario, el proveedor y su plazo.',
        modulos: ['compras', 'compras_tab_facturas', 'compras_tab_productos', 'compras_ver_montos',
                  'facturas_sala', 'facturas_sala_ver_montos', 'cargar_compra', 'cuentas_por_pagar',
                  'proveedores', 'facturas_compra', 'facturas_compra_abrir', 'facturas_compra_descargar',
                  'facturas_compra_ver_montos'],
        rutas: ['/compras', '/facturas-sala', '/cuentas-por-pagar', '/cargar-compra', '/facturas-compra',
                '/proveedores'],
        archivos: [
            'src/views/ComprasView.jsx', 'src/views/purchases/',
            'src/data/compras.js', 'src/data/cargarCompra.js', 'src/data/cuentasPorPagar.js',
            'src/data/facturasCompra.js', 'src/data/facturasSala.js', 'src/data/proveedores.js',
            'src/components/forms/FormProveedorDetail.jsx', 'src/components/forms/FormPurchaseDteViewer.jsx',
            'src/components/forms/FormRegisterPayment.jsx',
        ],
        tablas: ['purchase_receipts', 'purchase_receipt_items', 'purchase_sync_log',
                 'purchase_dte_documents', 'purchase_dte_claims', 'purchase_dte_processed_messages',
                 'purchase_dte_review_queue', 'purchase_claim_avisos', 'purchase_claim_lines',
                 'purchase_claim_rules', 'compra_documento_leido', 'compra_pago_aplicado',
                 'compra_pagos', 'compra_producto_alias', 'compra_renglon_pendiente',
                 'proveedores', 'proveedores_categorias', 'proveedores_maestro', 'suppliers',
                 'email_sync_accounts', 'email_sync_log'],
        edge: ['sync-erp-purchases', 'sync-purchase-emails', 'check-purchases-reconciliation',
               'scrape-erp-proveedores', 'backfill-proveedores-dte', 'export-purchase-dte-manifest',
               'export-purchase-dte-zip', 'analyze-document', 'leer-boleta', 'erp-csv-probe'],
        crons: ['sync-purchases-10min', 'sync-purchase-emails-daily', 'check-purchases-reconciliation-daily',
                'purchases-fastbackfill-semanal', 'verificar-facturas-reclamadas-2h',
                'avisar-facturas-de-sala-0830-sv'],
        docs: ['docs/CONTABILIDAD-ALCANCE-2026-08-01.md', 'docs/LECTURA-DE-COMPROBANTES-Y-RECETAS-2026-08-20.md'],
    },
    {
        id: 'fiscal',
        nombre: 'Libros fiscales y cierre de período',
        resumen: 'Lo que se le presenta a Hacienda: libro de consumidor, contribuyente, compras, anulados, percepción, retención, renta, corte Z y el cierre del mes.',
        modulos: ['libros_iva', 'libros_iva_tab_consumidor', 'libros_iva_tab_contribuyente',
                  'libros_iva_tab_compras', 'libros_iva_tab_anulados', 'libros_iva_tab_percepcion',
                  'libros_iva_tab_retencion', 'libros_iva_tab_renta', 'libros_iva_descargar',
                  'libros_iva_ver_montos', 'libro_compras_completo', 'libro_compras_completo_descargar',
                  'libro_compras_completo_ver_montos', 'corte_z', 'corte_z_descargar', 'corte_z_ver_montos',
                  'cierre_periodo', 'resumen_fiscal'],
        rutas: ['/libros-iva', '/libro-compras-completo', '/corte-z', '/cierre-periodo', '/resumen-fiscal'],
        archivos: [
            'src/views/contabilidad/',
            'src/data/librosIva.js', 'src/data/libroComprasCompleto.js', 'src/data/cierrePeriodo.js',
            'src/data/resumenFiscal.js', 'src/data/corteZ.js',
            'src/utils/corteZPrint.js', 'src/utils/periodo.js', 'src/utils/f07Catalogos.js',
            'scripts/verificar-libros.mjs', 'scripts/corte-z-una-hoja.mjs',
        ],
        tablas: ['corte_z', 'periodos_fiscales', 'contabilidad_config'],
        edge: ['sync-corte-z', 'verificar-csv-libros'],
        crons: ['corte-z-mensual'],
        docs: ['docs/LIBROS-IVA-FORMATO-Y-HALLAZGOS-2026-08-01.md', 'docs/planes-cerrados/BLOQUE-D-CIERRE-DE-PERIODO.md',
               'docs/RETENCION-EN-LOS-LIBROS-2026-08-12.md', 'docs/ANEXOS-HACIENDA-2026-08-11.md',
               'docs/AUDITORIA-CONTABLE-COMPLETA-2026-08-12.md'],
    },

    // ═══ REGULATORIO Y OPERACIÓN ════════════════════════════════════════════
    {
        id: 'bitacoras',
        nombre: 'Bitácoras reguladas (SRS)',
        resumen: 'Los libros que exige el Consejo: dispensación bajo receta, temperatura y humedad, limpieza, y el cierre de mes que firma el regente.',
        modulos: ['bitacoras', 'bitacoras_tab_libro', 'bitacoras_tab_cierre', 'bitacoras_cerrar_mes',
                  'bitacoras_configurar', 'bitacoras_descargar', 'dash_bitacoras',
                  'dash_recetas_pendientes'],
        rutas: ['/bitacoras'],
        archivos: [
            'src/views/BitacorasView.jsx', 'src/views/bitacoras/',
            'src/components/bitacoras/', 'src/components/srs/',
            'src/data/bitacoras.js',
            'src/utils/bitacoraPrint.js',
        ],
        tablas: ['bitacora_areas', 'bitacora_cierres', 'bitacora_correcciones', 'bitacora_dispensaciones',
                 'bitacora_folios', 'bitacora_lecturas', 'bitacora_limpiezas',
                 'recetas', 'receta_items', 'medicos'],
        edge: ['consultar-profesional-cssp', 'srs-proxy', 'avisar-bitacora-por-vencer'],
        crons: ['bitacora-dispensaciones-1min', 'bitacora-dispensaciones-repaso-diario',
                'avisar-bitacora-por-vencer-30min'],
        docs: ['docs/PLAN-BITACORAS-SRS-2026-08-16.md',
               'docs/AUDITORIA-BITACORAS-SRS-2026-08-25.md'],
    },
    {
        id: 'impresion',
        nombre: 'Impresión en ticketera',
        resumen: 'El papel: la cola por sala, el agente que corre en la computadora de la caja, el vale, el comprobante y la hoja de prueba.',
        modulos: ['impresion'],
        rutas: ['/impresion'],
        archivos: [
            'src/views/ImpresionView.jsx',
            'src/components/impresion/',
            'src/data/impresion.js',
            'src/utils/ticketPrint.js', 'src/utils/ticketCampos.js',
            'scripts/agente-impresion/', 'scripts/publicar-agente.mjs',
        ],
        tablas: ['cola_impresion', 'impresion_dispositivos'],
        edge: [],
        crons: ['purgar-cola-impresion-diario'],
        docs: ['docs/IMPRESION-EN-TICKETERA-2026-08-13.md'],
    },
    {
        id: 'sistema',
        nombre: 'Sistema, salud y auditoría general',
        resumen: 'Las pantallas de quien mantiene el portal: bitácora de acciones, salud de las sincronizaciones, objetos huérfanos, respaldos y pruebas de dispositivo.',
        modulos: ['auditview', 'sync_health', 'orphan_objects', 'ios_test'],
        rutas: ['/auditoria-del-sistema', '/actualizacion-de-datos', '/objetos-huerfanos', '/prueba-ios', '/raw-test'],
        archivos: [
            'src/views/AuditView.jsx', 'src/views/SyncHealthView.jsx', 'src/views/OrphanObjectsView.jsx',
            'src/views/IOSTestView.jsx', 'src/views/RawTestView.jsx', 'src/views/NotFoundView.jsx',
            'src/data/audit.js', 'src/data/syncHealth.js', 'src/data/orphanObjects.js',
            'src/data/bannerPortal.js',
            'src/store/slices/auditSlice.js',
            'src/hooks/useSyncMonitor.js', 'src/hooks/useBannerPortal.js',
            'src/utils/cajaNegra.js',
            'src/components/forms/FormAuditDetail.jsx',
            'src/data/egreso.js',
        ],
        tablas: ['audit_logs', 'sync_log', 'sync_alert_log', 'backup_sync_log', 'orphan_objects_registry',
                 'security_config', 'export_log'],
        edge: ['check-sync-health-alerts', 'backup-critical-tables', 'oss-proxy', 'saly-ai'],
        crons: ['check-sync-health-alerts-20min', 'backup-critical-tables-weekly', 'purge-sync-logs-daily',
                'purge-cron-history-daily'],
        docs: ['docs/SISTEMA-LA-BITACORA-LOS-RESPALDOS-Y-LA-SALUD-2026-08-24.md',
               'docs/PLAN-BLINDAJE-ANTE-TERCEROS-2026-08-13.md'],
    },
];

// ── Índice invertido: prefijo de archivo → id de área ────────────────────────
// Se construye una vez y se consulta por longitud de prefijo descendente, para
// que el más específico gane sin depender del orden en que se escribieron.
const PREFIJOS = AREAS
    .flatMap(a => a.archivos.map(p => ({ prefijo: p, area: a.id })))
    .sort((x, y) => y.prefijo.length - x.prefijo.length);

export function areaDeArchivo(ruta) {
    const r = ruta.replace(/^\.\//, '');
    for (const { prefijo, area } of PREFIJOS) {
        if (prefijo.endsWith('/') ? r.startsWith(prefijo) : r === prefijo) return area;
    }
    return null;
}

export const PORAREA = Object.fromEntries(AREAS.map(a => [a.id, a]));
