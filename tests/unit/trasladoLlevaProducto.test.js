import { describe, it, expect } from 'vitest';
import {
    trasladoLlevaProducto,
    textoDeTraslado,
} from '../../supabase/functions/_shared/erp-traslado.ts';
import real from './fixtures/ver-traslado-2026-08-20.json';

// La guarda que decide si una tarjeta «Ya llegó, recibir» se puede cerrar sola.
//
// **Esta prueba existe porque cerrar de más es peor que no cerrar.** El barrido
// apaga la tarjeta cuando el sistema dice que ese traslado ya no está esperando
// entrar. Pero el número que el portal guardó pudo ser el de OTRO traslado: eso
// es exactamente lo que pasó con nueve renglones de los pedidos 119, 120 y 121
// —el despacho deducía el número por descarte y dos salidas simultáneas desde
// la misma ubicación lo volvían ambiguo— y se cerró en v2.666.1. Con un número
// ajeno, «ya no está pendiente» significa que entró el traslado de otro, y la
// tarjeta se apagaría sobre producto que nunca llegó.
//
// El fixture NO está inventado: son las páginas `ver_traslado.php` REALES,
// capturadas del sistema el 2026-08-20. El 29444 es el VASOTRATE de la tarjeta
// fantasma de Salud 2 (FINALIZADA en el sistema desde el 17-ago); el 29445 es
// otro traslado del mismo día, a otra sala y con otro producto, que es el
// contraejemplo; el 29932 es el DOLO APRANAX que sí seguía pendiente.

const texto = (id) => textoDeTraslado(real.paginas[id]);

describe('trasladoLlevaProducto', () => {
    it('reconoce el producto de la tarjeta en su propio traslado', () => {
        expect(trasladoLlevaProducto(texto('29444'), 'VASOTRATE 75 MG X 20 TABLETAS')).toBe(true);
        expect(trasladoLlevaProducto(texto('29932'), 'DOLO APRANAX X 100 TAB')).toBe(true);
    });

    it('NO da por bueno el traslado de otro', () => {
        // El 29445 salió el mismo día y lleva FOSKROL. Si el barrido se
        // conformara con «ya no está pendiente», cerraría la tarjeta del
        // VASOTRATE contra esta página.
        expect(trasladoLlevaProducto(texto('29445'), 'VASOTRATE 75 MG X 20 TABLETAS')).toBe(false);
        expect(trasladoLlevaProducto(texto('29444'), 'FOSKROL C/ GINSENG X 30 CAP')).toBe(false);
    });

    it('sin poder leer la página no cierra', () => {
        // `contenidoDeTraslado` devuelve '' cuando no pudo leer. No saber no
        // puede tener el mismo desenlace que saber que sí.
        expect(trasladoLlevaProducto('', 'VASOTRATE 75 MG X 20 TABLETAS')).toBe(false);
        expect(trasladoLlevaProducto(texto('29444'), '')).toBe(false);
        expect(trasladoLlevaProducto(texto('29444'), null)).toBe(false);
    });

    it('compara normalizado: la tarjeta puede traer el nombre con otra forma', () => {
        // El nombre viaja en el jsonb de la solicitud tal como lo escribió la
        // pantalla; la página lo pinta con su propio espaciado.
        expect(trasladoLlevaProducto(texto('29444'), '  vasotrate 75 mg   x 20 tabletas ')).toBe(true);
    });
});
