import { describe, it, expect, vi } from 'vitest';
import { partirPorLlave, CAMPOS_TRAS_LLAVE, SENSITIVE_FIELDS } from '../../src/store/utils';

// ═══════════════════════════════════════════════════════════════════════════
// El reparto de un payload de ficha entre la tabla y la RPC.
//
// Desde el 2026-09-03 `authenticated` no tiene INSERT ni UPDATE sobre diez
// columnas de `employees`: el sueldo y la cuenta (llave `staff_salary.can_edit`)
// y la identidad previsional (llave `staff_detail.can_edit`). Antes las tres
// llaves separaban sólo la LECTURA y cualquiera con «Listado → Gestionar» podía
// cambiarle a otro el sueldo y la cuenta donde se le deposita, sin poder verlos.
//
// El modo de falla que estas pruebas cuidan NO es silencioso, y por eso importa:
// una de esas columnas en el `update` normal devuelve `permission denied for
// column …` y se lleva puesto el guardado ENTERO. Un campo mal repartido no
// pierde ese campo — deja la ficha sin poder guardarse.
// ═══════════════════════════════════════════════════════════════════════════

describe('partirPorLlave — qué va por la tabla y qué por la RPC', () => {
    it('saca las diez columnas con llave y deja el resto', () => {
        const { dbPayload, protegido } = partirPorLlave({
            first_names: 'ANA', phone: '7000-0000', branch_id: 4,
            base_salary: 365, dui: '01234567-8', isss_number: '123456789',
        });
        expect(dbPayload).toEqual({ first_names: 'ANA', phone: '7000-0000', branch_id: 4 });
        expect(protegido).toEqual({ base_salary: 365, dui: '01234567-8', isss_number: '123456789' });
    });

    it('sin campos protegidos devuelve `null`, no un objeto vacío', () => {
        // Quien llama hace `if (protegido) await guardarDatosProtegidos(...)`:
        // con `{}` haría un viaje de red por cada guardado de teléfono.
        const { dbPayload, protegido } = partirPorLlave({ phone: '7000-0000' });
        expect(protegido).toBeNull();
        expect(dbPayload).toEqual({ phone: '7000-0000' });
    });

    it('`undefined` no viaja en ninguna de las dos mitades', () => {
        // En el `update` de supabase-js `undefined` se cae solo al serializar,
        // pero en el patch de la RPC significaría «poner en null» — o sea, lo
        // contrario de «no lo toqué». Guardar el sueldo borraría el DUI.
        const { dbPayload, protegido } = partirPorLlave({
            phone: '7000-0000', base_salary: 365, dui: undefined, bank_name: undefined,
        });
        expect(protegido).toEqual({ base_salary: 365 });
        expect('dui' in protegido).toBe(false);
        expect('bank_name' in dbPayload).toBe(false);
    });

    it('un `null` explícito SÍ viaja: es «borrá este dato»', () => {
        const { protegido } = partirPorLlave({ account_number: null });
        expect(protegido).toEqual({ account_number: null });
    });

    it('no muta el objeto que recibe', () => {
        // Los llamadores siguen usando `dbPayload` después de repartir —
        // `registerCatalogEntry`, el parche local del store—, así que arrancarle
        // las claves al original rompería lo que viene abajo.
        const original = { phone: '7000-0000', base_salary: 365 };
        partirPorLlave(original);
        expect(original).toEqual({ phone: '7000-0000', base_salary: 365 });
    });

    it('`code` y `kiosk_pin` NO son campos con llave, y es a propósito', () => {
        // `code` es la credencial del carné: su llave siempre fue
        // `staff_list.can_edit`, que es justo lo que la policy de fila exige, y
        // además es NOT NULL — sacarlo del INSERT dejaría el alta sin poder
        // crear a nadie. `kiosk_pin` lo deriva un trigger de Postgres desde el
        // código, así que mandarlo es inofensivo y además inútil.
        expect(CAMPOS_TRAS_LLAVE).not.toContain('code');
        expect(CAMPOS_TRAS_LLAVE).not.toContain('kiosk_pin');
        const { dbPayload, protegido } = partirPorLlave({ code: '1234', kiosk_pin: 'ABCD1234' });
        expect(dbPayload).toEqual({ code: '1234', kiosk_pin: 'ABCD1234' });
        expect(protegido).toBeNull();
    });

    it('la lista coincide con lo que la base dejó de aceptar', () => {
        // El manifiesto de las diez, escrito acá para que cambiarlo obligue a
        // mirar la migración: si alguien le suma una columna a
        // `guardar_datos_protegidos_de_empleado` y se olvida de esta lista, el
        // portal deja de poder guardar esa columna y el error apunta a
        // PostgREST, no acá.
        expect([...CAMPOS_TRAS_LLAVE].sort()).toEqual([
            'account_number', 'afp_number', 'alt_identity_document', 'bank_name',
            'base_salary', 'dui', 'dui_fecha_expedicion', 'dui_fecha_vencimiento',
            'dui_lugar_expedicion', 'isss_number',
        ]);
    });

    it('todo lo que no se puede escribir tampoco se guarda en el disco', () => {
        // Las dos listas responden preguntas distintas —«¿lo puedo escribir?» y
        // «¿lo puedo dejar en el localStorage de una computadora compartida?»—
        // pero la segunda tiene que cubrir a la primera. `kiosk_pin` está sólo
        // en la de disco, que es correcto: es un secreto que sí se escribe.
        for (const campo of CAMPOS_TRAS_LLAVE) {
            expect(SENSITIVE_FIELDS).toContain(campo);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Las dos marcas de «me contestaron» y por qué no pueden sobrevivir al caché.
//
// `identidad_conocida` y `salario_conocido` las pone el store desde la
// RESPUESTA del servidor, no desde el permiso: `get_employee_identidad` y
// `get_employee_salarios` devuelven la fila aunque el dato esté vacío, así que
// la marca distingue «no me dejaron mirar» de «miré y no hay». Sin ellas las dos
// cosas se ven igual, y el portal ya pagó eso dos veces: el listado acusando de
// «Faltan 2 datos» a 48 fichas completas, y la quincena que se generaría en cero.
//
// Pero `persistEmployees` borra del disco los campos con los que esas marcas
// viajan. Si la marca sobreviviera, la fila hidratada del caché afirmaría saber
// algo sobre datos que se acaban de borrar ahí mismo.
// ═══════════════════════════════════════════════════════════════════════════
describe('persistEmployees — las marcas no sobreviven a los datos que marcan', () => {
    it('borra las dos marcas junto con los campos sensibles', async () => {
        const guardado = {};
        vi.stubGlobal('localStorage', {
            setItem: (k, v) => { guardado[k] = v; },
            getItem: (k) => guardado[k] ?? null,
        });
        const { persistEmployees } = await import('../../src/store/utils');

        persistEmployees([{
            id: 'a', name: 'ANA', dui: '01234567-8', base_salary: 365,
            identidad_conocida: true, salario_conocido: true,
        }]);

        const [fila] = JSON.parse(Object.values(guardado)[0]);
        expect(fila.dui).toBeUndefined();
        expect(fila.base_salary).toBeUndefined();
        expect(fila.identidad_conocida).toBeUndefined();
        expect(fila.salario_conocido).toBeUndefined();
        // Y lo que no es secreto se queda: el caché sigue sirviendo para pintar.
        expect(fila.name).toBe('ANA');
    });
});
