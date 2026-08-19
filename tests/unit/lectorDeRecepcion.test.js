import { describe, it, expect } from 'vitest';
import { lectorDeRecepcion } from '../../supabase/functions/_shared/erp-traslado.ts';

// ¿El traslado ya entró a la sala, antes de volver a cargarlo?
//
// **Estas pruebas existen porque la respuesta equivocada carga inventario dos
// veces, y eso no se deshace solo.** Hasta el 2026-08-19 la recepción del pedido
// daba por recibido un traslado cuando `recibir_traslado.php` no mostraba
// líneas — y esa pantalla SIGUE pintando las mismas filas y el mismo botón para
// uno ya recibido (medido el 2026-08-17 sobre el 29445 y el 29444). Quien sí
// sabe es el listado.
//
// Preguntárselo por renglón cuesta 250-880 ms (medido contra el sistema el
// 2026-08-19: 253 ms en Salud 3, 878 ms en Salud 2). Una hoja son ~35 renglones
// y se recibe en 18-45 s, así que preguntar de a uno la duplicaría. De ahí la
// caché — y de ahí que haya que probar la caché, que es lógica nueva.

/** Un lector de cola falso que cuenta cuántas veces lo llamaron. */
function colaFalsa(...respuestas) {
    const llamadas = { cola: 0, estado: 0 };
    let i = 0;
    const leerPendientes = async () => {
        llamadas.cola++;
        const r = respuestas[Math.min(i++, respuestas.length - 1)];
        return r === null ? null : new Set(r);
    };
    return { llamadas, leerPendientes };
}

describe('lectorDeRecepcion — qué contesta', () => {
    it('en la cola de entrada: pendiente', async () => {
        const { leerPendientes } = colaFalsa(['30350']);
        const leer = lectorDeRecepcion('c', 20_000, leerPendientes,
            async () => { throw new Error('no debió preguntar de nuevo'); });
        expect(await leer('30350')).toBe('pendiente');
    });

    // El caso del BEBELAC: Salud 3 lo recibió a mano el 19-ago. Sin esto, la
    // recepción del portal lo habría cargado una segunda vez.
    it('fuera de la cola: se pregunta fresco y contesta recibido', async () => {
        const { leerPendientes, llamadas } = colaFalsa(['31320']);
        const leer = lectorDeRecepcion('c', 20_000, leerPendientes,
            async (_c, id) => { llamadas.estado++; return id === '30350' ? 'recibido' : 'pendiente'; });
        expect(await leer('30350')).toBe('recibido');
        expect(llamadas.estado).toBe(1);          // no se contestó con la caché
    });

    it('anulado también sale de la consulta fresca', async () => {
        const { leerPendientes } = colaFalsa([]);
        const leer = lectorDeRecepcion('c', 20_000, leerPendientes, async () => 'anulado');
        expect(await leer('30350')).toBe('anulado');
    });

    // Una guarda que corta con lo que no sabe deja de recibir por culpa de una
    // consulta secundaria. `desconocido` no frena nada río arriba.
    it('si no se pudo leer la cola: desconocido, y no inventa', async () => {
        const { leerPendientes } = colaFalsa(null);
        const leer = lectorDeRecepcion('c', 20_000, leerPendientes,
            async () => { throw new Error('no debió preguntar'); });
        expect(await leer('30350')).toBe('desconocido');
    });
});

describe('lectorDeRecepcion — lo que ahorra y lo que no', () => {
    it('un lote entero se resuelve con UNA lectura de la cola', async () => {
        const ids = Array.from({ length: 35 }, (_, i) => String(31000 + i));
        const { leerPendientes, llamadas } = colaFalsa(ids);
        const leer = lectorDeRecepcion('c', 20_000, leerPendientes,
            async () => { throw new Error('todos estaban en la cola'); });
        for (const id of ids) expect(await leer(id)).toBe('pendiente');
        expect(llamadas.cola).toBe(1);            // 1 y no 35: es todo el punto
    });

    it('vencido el plazo, vuelve a leer la cola', async () => {
        const { leerPendientes, llamadas } = colaFalsa(['1'], ['1']);
        const leer = lectorDeRecepcion('c', 0, leerPendientes, async () => 'recibido');
        await leer('1');
        await leer('1');
        expect(llamadas.cola).toBe(2);
    });

    // La cola se relee y puede haber cambiado: lo que era pendiente ahora no
    // está, y ahí manda la consulta fresca.
    it('si la cola cambia entre lecturas, gana la nueva', async () => {
        const { leerPendientes } = colaFalsa(['1'], []);
        const leer = lectorDeRecepcion('c', 0, leerPendientes, async () => 'recibido');
        expect(await leer('1')).toBe('pendiente');
        expect(await leer('1')).toBe('recibido');
    });

    it('el id se compara como texto, venga número o cadena', async () => {
        const { leerPendientes } = colaFalsa(['30350']);
        const leer = lectorDeRecepcion('c', 20_000, leerPendientes,
            async () => { throw new Error('no debió preguntar de nuevo'); });
        expect(await leer(30350)).toBe('pendiente');
    });
});
