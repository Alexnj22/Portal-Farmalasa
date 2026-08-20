import { describe, it, expect } from 'vitest';
import {
    trasladoQueSalioPeseAlFallo,
    textoDeTraslado,
} from '../../supabase/functions/_shared/erp-traslado.ts';
import real from './fixtures/ver-traslado-2026-08-20.json';

// Después de que el sistema contesta «no»: ¿salió igual?
//
// **Esta prueba existe porque acá se puede fallar para los dos lados y los dos
// duelen.** Si se da por bueno el «no» cuando el traslado sí salió, el producto
// queda fuera del estante con el portal diciendo que nunca se movió, y quien
// vea el error lo despacha de nuevo. Si se da por salido un traslado que no es
// el propio, se anota el número de otro sobre producto que sigue en su lugar.
//
// La regla que separa las dos: acá el CONTENIDO es requisito, no desempate.
// `identificarTrasladoNuevo` puede quedarse con el único candidato sin abrirlo
// porque allá se sabe que el propio existe —el sistema contestó éxito—; acá esa
// misma regla contestaría que sí salió cuando el único traslado nuevo es el de
// otra persona, despachado en esos segundos desde la misma ubicación. Eso pasa
// de verdad: Bodega despachó 63 solicitudes a mano el 18-ago.
//
// El fixture son páginas `ver_traslado.php` REALES capturadas el 2026-08-20.

const paginas = (ids) => async (_cookie, id) =>
    (ids.includes(id) ? textoDeTraslado(real.paginas[id]) : '');

const foto = (...ids) => new Map(ids.map((id) => [id, 'DESTINO']));

describe('trasladoQueSalioPeseAlFallo', () => {
    it('lo reconoce cuando salió pese al «no»', async () => {
        const { id } = await trasladoQueSalioPeseAlFallo(
            'c', foto(), foto('29444'), ['VASOTRATE 75 MG X 20 TABLETAS'],
            paginas(['29444']),
        );
        expect(id).toBe('29444');
    });

    it('NO da por salido el traslado de otra persona', async () => {
        // Un solo traslado nuevo en la ventana, y no es el nuestro: lleva
        // FOSKROL. `identificarTrasladoNuevo` lo devolvería sin abrirlo.
        const { id, nuevos } = await trasladoQueSalioPeseAlFallo(
            'c', foto(), foto('29445'), ['VASOTRATE 75 MG X 20 TABLETAS'],
            paginas(['29445']),
        );
        expect(id).toBeNull();
        // Pero se dice que aparecieron: «no salió nada» y «salió algo que no
        // pude identificar» no son lo mismo para quien va a reintentar.
        expect(nuevos).toEqual(['29445']);
    });

    it('con dos nuevos elige el que lleva el producto', async () => {
        const { id } = await trasladoQueSalioPeseAlFallo(
            'c', foto('1'), foto('1', '29444', '29445'),
            ['VASOTRATE 75 MG X 20 TABLETAS'], paginas(['29444', '29445']),
        );
        expect(id).toBe('29444');
    });

    it('sin traslados nuevos, el «no» era un no', async () => {
        const { id, nuevos } = await trasladoQueSalioPeseAlFallo(
            'c', foto('1', '2'), foto('1', '2'), ['LO QUE SEA'], paginas([]),
        );
        expect(id).toBeNull();
        expect(nuevos).toEqual([]);
    });

    it('una página que no se puede leer no cuenta como coincidencia', async () => {
        const { id } = await trasladoQueSalioPeseAlFallo(
            'c', foto(), foto('29444'), ['VASOTRATE 75 MG X 20 TABLETAS'],
            async () => '',
        );
        expect(id).toBeNull();
    });

    it('si aparecieron demasiados, no se contesta abriéndolos todos', async () => {
        const muchos = foto(...Array.from({ length: 12 }, (_, i) => `9${i}`));
        let abiertas = 0;
        const { id, nuevos } = await trasladoQueSalioPeseAlFallo(
            'c', foto(), muchos, ['VASOTRATE 75 MG X 20 TABLETAS'],
            async () => { abiertas++; return ''; },
        );
        expect(id).toBeNull();
        expect(nuevos).toHaveLength(12);
        expect(abiertas).toBe(0);
    });

    it('un traslado de varios productos tiene que llevarlos TODOS', async () => {
        const { id } = await trasladoQueSalioPeseAlFallo(
            'c', foto(), foto('29444'),
            ['VASOTRATE 75 MG X 20 TABLETAS', 'DOLO APRANAX X 100 TAB'],
            paginas(['29444']),
        );
        expect(id).toBeNull();
    });
});
