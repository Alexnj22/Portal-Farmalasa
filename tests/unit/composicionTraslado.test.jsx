import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════════════
// Una composición, varias solicitudes.
//
// Pedido del usuario, 2026-08-20:
//
//   «yo en salud 4 solicito eutirox 100 a salud 1, salud 2 y salud 3,
//    cantidades distintas, lo hago en la misma solicitud, pero al darle en
//    solicitar se envían como solicitudes separadas, así que cada sucursal ve
//    solo lo de cada uno. o solicito eutirox 100 y amoxicilina 500 mk a salud
//    1, salud 1 verá la solicitud de esos 2 productos.»
//
// **Lo que estas pruebas anclan es que cada sala reciba SÓLO lo suyo.** Un
// error de agrupación no da error en ninguna parte: le pide a Salud 2 un
// producto que era para Salud 3, y alguien lo despacha.
//
// Los cuatro casos son los cuatro que se rompen por separado:
//
//  1. **Dos productos a la MISMA sala** → UNA solicitud con dos renglones y sin
//     marca de grupo: no hay hermanas que agrupar.
//  2. **Dos salas** → DOS solicitudes, cada una con lo suyo, hermanadas por la
//     misma marca de grupo.
//  3. **El último producto sin agregar** → entra igual. Es el error que se
//     comete solo: se agrega uno, se arma el segundo y se aprieta Solicitar.
//     Perderlo en silencio es lo peor que puede pasar acá.
//  4. **Todo en un solo `insert`** → entran todas o no entra ninguna. Media
//     composición enviada no se puede saber cuál mitad fue.
// ═══════════════════════════════════════════════════════════════════════════

const crearSolicitudTraslado = vi.fn(async () => ({ error: null }));

// Dónde hay cada producto. El primero de la lista es el que queda elegido solo
// —«la que puede ceder sin quedarse corta»—, así que dando listas distintas por
// producto se arma la composición a dos salas sin tocar el desplegable.
const DONDE = {
    101: [{ erp_sucursal_id: 1, sala: 'Salud 1', unidades: 90, minimo: 0, vence: null }],
    202: [{ erp_sucursal_id: 2, sala: 'Salud 2', unidades: 80, minimo: 0, vence: null }],
    303: [{ erp_sucursal_id: 1, sala: 'Salud 1', unidades: 70, minimo: 0, vence: null }],
    // El caso de la captura del 2026-08-20: NERVIOSINA X 50 SOBRES en La
    // Popular, 27 unidades y un mínimo de 62. La caja es de 50.
    404: [{ erp_sucursal_id: 5, sala: 'La Popular', unidades: 27, minimo: 62, vence: null }],
};

vi.mock('../../src/data/traslados', () => ({
    MOTIVOS_RECHAZO: [],
    crearSolicitudTraslado: (...a) => crearSolicitudTraslado(...a),
    fetchDondeHay: vi.fn(async (id) => ({ donde: DONDE[id] ?? [], error: null })),
    fetchEsAntibiotico: vi.fn(async () => ({ esAntibiotico: false })),
}));
vi.mock('../../src/data/inventory', () => ({ fetchInventoryByProductIds: vi.fn(async () => []) }));
// A propósito DISTINTAS por producto: la amoxicilina va en caja de 10 y los
// otros dos por unidad. Si alguna vez el renglón se arma con la presentación
// del producto anterior —las tres consultas viajan en paralelo y la de salas
// puede llegar antes que la de presentaciones—, el factor multiplica y el error
// no se ve como un error: se ve como una cantidad.
const PRESENTACIONES = {
    101: [{ tipo: 'UNIDAD', factor: 1 }],
    202: [{ tipo: 'CAJA', factor: 10 }],
    303: [{ tipo: 'UNIDAD', factor: 1 }, { tipo: 'CAJA', factor: 10 }],
    404: [{ tipo: 'CAJA', factor: 50 }, { tipo: 'UNIDAD', factor: 1 }],
};

vi.mock('../../src/data/inventoryMovements', () => ({
    fetchPresentaciones: vi.fn(async (ids) => ({
        porProducto: new Map(ids.map(id => [id, PRESENTACIONES[id] ?? []])),
    })),
}));
vi.mock('../../src/context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'u1', branchId: 27, branchName: 'Salud 3' } }),
}));
vi.mock('../../src/store/staffStore', () => ({
    useStaffStore: (sel) => sel({ appendAuditLog: vi.fn(async () => {}) }),
}));

const PedirTrasladoModal = (await import('../../src/views/dashboard/PedirTrasladoModal.jsx')).default;
const { useComposicionTraslado } = await import('../../src/store/composicionTraslado.js');

const EUTIROX = { erp_product_id: 101, descripcion: 'EUTIROX 100' };
const AMOXI   = { erp_product_id: 202, descripcion: 'AMOXICILINA 500' };
const IBU     = { erp_product_id: 303, descripcion: 'IBUPROFENO 400' };

/* Abrir el formulario es MONTARLO: desde el 2026-08-20 agregar un producto lo
 * cierra y devuelve a la consulta de inventario, y elegir el siguiente lo vuelve
 * a abrir. Que lo compuesto sobreviva a ese ciclo es justamente lo que hay que
 * probar, así que las pruebas lo montan y desmontan igual que la consulta. */
let cerrado;
const abrirCon = async (producto) => {
    cleanup();
    cerrado = vi.fn();
    await act(async () => {
        render(<PedirTrasladoModal producto={producto} onClose={cerrado} onListo={() => {}} />);
    });
};
const abrir = () => abrirCon(EUTIROX);
/** Lo que hace «Terminar solicitud» en la consulta: abrir sin producto. */
const terminar = () => abrirCon(null);

const cantidad = () => screen.getByPlaceholderText('Cant.');
const ponerCantidad = async (n) => {
    await act(async () => { fireEvent.change(cantidad(), { target: { value: String(n) } }); });
};
// Con la lista vacía el botón se llama «Agregar otro producto» —al lado del de
// solicitar—; con algo ya agregado, «Agregar» a secas.
const agregar = async () => {
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Agregar( otro producto)?$/ }));
    });
};
// Ir a «En la solicitud» AGREGA el renglón terminado que esté a la vista: es lo
// que alguien hace después de completar el último producto, y sin eso ese
// producto se quedaría afuera.
const irALista = async () => {
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /En la solicitud/ })); });
};
const ponerCausa = async (t) => {
    await act(async () => {
        fireEvent.change(screen.getByPlaceholderText(/Para qué se pide/), { target: { value: t } });
    });
};
const solicitar = async () => {
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Solicitar/ }));
    });
};

/** Las filas que se mandaron a la base, en el orden en que viajaron. */
const filasEnviadas = () => {
    const arg = crearSolicitudTraslado.mock.calls.at(-1)[0];
    return Array.isArray(arg) ? arg : [arg];
};

beforeEach(() => {
    crearSolicitudTraslado.mockClear();
    // La composición vive en un store de módulo: sin esto, lo que arma una
    // prueba se lo encuentra la siguiente.
    useComposicionTraslado.setState({ renglones: [], causa: '' });
});

describe('dos productos a la misma sala', () => {
    it('sale UNA solicitud con los dos renglones y sin marca de grupo', async () => {
        await abrir();
        await ponerCantidad(3);
        await agregar();

        await abrirCon(IBU);              // también en Salud 1
        await ponerCantidad(5);
        await agregar();

        await terminar();
        await ponerCausa('Se acabaron en sala');
        await solicitar();

        const filas = filasEnviadas();
        expect(filas).toHaveLength(1);
        expect(filas[0].metadata.origen_branch_name).toBe('Salud 1');
        expect(filas[0].metadata.items.map(i => [i.erp_product_id, i.cantidad]))
            .toEqual([[101, 3], [303, 5]]);
        expect(filas[0].metadata.total_unidades).toBe(8);
        // Sin hermanas no hay grupo que marcar.
        expect(filas[0].metadata.grupo_id).toBeUndefined();
    });
});

describe('el mismo pedido a dos salas', () => {
    it('sale una solicitud POR SALA, y cada una lleva sólo lo suyo', async () => {
        await abrir();
        await ponerCantidad(3);           // EUTIROX → Salud 1
        await agregar();

        await abrirCon(AMOXI);            // → Salud 2
        await ponerCantidad(2);
        await agregar();

        await terminar();
        await ponerCausa('Se acabaron en sala');
        await solicitar();

        const filas = filasEnviadas();
        expect(filas).toHaveLength(2);

        const porSala = Object.fromEntries(filas.map(f => [f.metadata.origen_branch_name, f]));
        expect(Object.keys(porSala).sort()).toEqual(['Salud 1', 'Salud 2']);
        expect(porSala['Salud 1'].metadata.items.map(i => i.erp_product_id)).toEqual([101]);
        expect(porSala['Salud 2'].metadata.items.map(i => i.erp_product_id)).toEqual([202]);

        // Cada renglón con la presentación de SU producto, no con la del
        // anterior: 2 cajas de 10 son 20 unidades, no 2.
        expect(porSala['Salud 1'].metadata.items[0]).toMatchObject({ presentacion_tipo: 'UNIDAD', factor: 1 });
        expect(porSala['Salud 1'].metadata.total_unidades).toBe(3);
        expect(porSala['Salud 2'].metadata.items[0]).toMatchObject({ presentacion_tipo: 'CAJA', factor: 10 });
        expect(porSala['Salud 2'].metadata.total_unidades).toBe(20);

        // Hermanas: la misma marca, para que quien pidió las vea juntas.
        expect(porSala['Salud 1'].metadata.grupo_id).toBeTruthy();
        expect(porSala['Salud 1'].metadata.grupo_id).toBe(porSala['Salud 2'].metadata.grupo_id);
    });

    it('el botón dice a cuántas salas va antes de apretarlo', async () => {
        await abrir();
        await ponerCantidad(3);
        await agregar();
        await abrirCon(AMOXI);
        await ponerCantidad(2);
        await irALista();          // cambiar de pestaña agrega el que está a la vista
        await ponerCausa('Se acabaron en sala');
        expect(screen.getByRole('button', { name: 'Solicitar a 2 salas' })).toBeTruthy();
    });
});

describe('el último producto no se pierde', () => {
    // Se arma el segundo y se va a la lista sin haber apretado «Agregar».
    // Cambiar de pestaña lo agrega: es lo que alguien hace cuando terminó, y
    // dejarlo afuera sería tirarlo en silencio.
    it('cambiar de pestaña con el formulario lleno lo agrega', async () => {
        await abrir();
        await ponerCantidad(3);
        await agregar();

        await abrirCon(AMOXI);
        await ponerCantidad(2);
        await irALista();
        await ponerCausa('Se acabaron en sala');
        await solicitar();

        const filas = filasEnviadas();
        expect(filas).toHaveLength(2);
        expect(filas.flatMap(f => f.metadata.items.map(i => i.erp_product_id)).sort())
            .toEqual([101, 202]);
    });

    // Y si está a medias —sin cantidad— no se manda nada: se dice cuál falta.
    it('con el segundo a medias no deja solicitar', async () => {
        await abrir();
        await ponerCantidad(3);
        await agregar();

        await abrirCon(AMOXI);
        await ponerCantidad(0);
        await irALista();
        await ponerCausa('Se acabaron en sala');

        expect(screen.getByRole('button', { name: /^Solicitar/ })).toBeDisabled();
        expect(screen.getByText(/Te falta terminar AMOXICILINA 500/)).toBeTruthy();
    });
});

// ── Dónde te deja «Agregar y seguir» ──────────────────────────────────────
// Reportado el 2026-08-20: «al darle en agregar y seguir, no me gusta dónde me
// lleva, no debería regresar al listado completo». La forma es la de Ajuste de
// Inventario: se sigue en «Agregar», con una línea que dice qué entró y un
// contador en la otra pestaña.
describe('después de agregar', () => {
    // Agregar CIERRA el formulario y devuelve a la consulta de inventario, que
    // es donde se elige el siguiente (pedido del usuario, 2026-08-20). Lo
    // agregado sobrevive a ese cierre: vive en el store, no en la pantalla.
    it('lo agregado sobrevive a cerrar y volver a abrir', async () => {
        await abrir();
        await ponerCantidad(3);
        await agregar();

        await abrirCon(AMOXI);     // la consulta abre el formulario con otro
        expect(screen.getByRole('radio', { name: /En la solicitud · 1/ })).toBeTruthy();
    });

    // «Terminar solicitud» en la consulta abre el formulario SIN producto: ahí
    // lo que se viene a hacer es revisar y mandar, no agregar.
    // El formulario ya no busca productos: siempre se abre DESDE la consulta,
    // con uno o sin ninguno para terminar. Así que «Agregar» sin producto a la
    // vista es volver a la consulta, no otra pantalla adentro — que es lo que
    // se pidió quitar y había vuelto a aparecer por acá (reportado 2026-08-20).
    it('«Agregar» sin producto cierra y devuelve a la consulta', async () => {
        await abrir();
        await ponerCantidad(3);
        await agregar();
        await terminar();

        await act(async () => {
            fireEvent.click(screen.getByRole('radio', { name: /Agregar/ }));
        });
        expect(cerrado).toHaveBeenCalled();
        // Y no dibuja ningún buscador propio.
        expect(screen.queryByPlaceholderText(/Buscar el producto/)).toBeNull();
    });

    it('abrir sin producto cae en la lista, con todo lo armado', async () => {
        await abrir();
        await ponerCantidad(3);
        await agregar();

        await terminar();
        expect(screen.getByRole('button', { name: 'Quitar EUTIROX 100' })).toBeTruthy();
        expect(screen.getByPlaceholderText(/Para qué se pide/)).toBeTruthy();
    });

    it('la otra pestaña lleva la cuenta de lo que va', async () => {
        await abrir();
        await ponerCantidad(3);
        await agregar();
        expect(screen.getByRole('radio', { name: /En la solicitud · 1/ })).toBeTruthy();
    });

    // El rastro es del ÚLTIMO que entró: al elegir el siguiente se retira, o
    // diría «agregado» sobre un producto que todavía se está armando.
    it('el rastro se va al elegir el siguiente producto', async () => {
        await abrir();
        await ponerCantidad(3);
        await agregar();
        await abrirCon(AMOXI);
        expect(screen.queryByText(/— agregado/)).toBeNull();
    });

    it('la lista vive en su pestaña, no encima del formulario', async () => {
        await abrir();
        await ponerCantidad(3);
        await agregar();

        // En «Agregar» no está.
        expect(screen.queryByRole('button', { name: /Quitar EUTIROX 100/ })).toBeNull();
        await act(async () => {
            fireEvent.click(screen.getByRole('radio', { name: /En la solicitud/ }));
        });
        expect(screen.getByRole('button', { name: /Quitar EUTIROX 100/ })).toBeTruthy();
    });
});

// ── Corregir sin volver a empezar ─────────────────────────────────────────
// Reportado el 2026-08-20: «en la solicitud no me sale editar, ni eliminar como
// en ajuste de inventario». Había una equis chica y nada más: para cambiar un
// número había que quitar el renglón y volver a armarlo desde el buscador.
describe('editar y quitar en «En la solicitud»', () => {
    const abrirLapiz = async (nombre) => {
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: `Corregir ${nombre}` }));
        });
    };

    it('el lápiz abre la cantidad y lo corregido es lo que viaja', async () => {
        await abrir();
        await ponerCantidad(3);
        await irALista();
        await abrirLapiz('EUTIROX 100');

        await act(async () => {
            fireEvent.change(screen.getByLabelText('Cantidad de EUTIROX 100'), { target: { value: '7' } });
        });
        await act(async () => {
            fireEvent.change(screen.getByPlaceholderText(/Para qué se pide/), { target: { value: 'Se acabaron' } });
        });
        await solicitar();

        expect(filasEnviadas()[0].metadata.items[0].cantidad).toBe(7);
        expect(filasEnviadas()[0].metadata.total_unidades).toBe(7);
    });

    // Reportado el 2026-08-20 sobre la tarjeta abierta: «¿y si quiero modificar
    // la presentación?». Sólo se podía el número.
    //
    // Se ancla que el control ESTÉ y esté bien armado —con las presentaciones de
    // ESE producto y marcando la suya—, no la mecánica de abrir el desplegable:
    // el recálculo lo hace la misma función que la cantidad, que ya está probada
    // arriba. Lo que no puede fallar es que el renglón se guarde sus
    // presentaciones al agregarse: para cuando se corrige, el formulario está en
    // otro producto y las de la pantalla son las de otro.
    it('la tarjeta abierta ofrece cambiar la presentación de ESE producto', async () => {
        await abrir();
        await ponerCantidad(3);
        await agregar();
        await abrirCon(IBU);              // UNIDAD (1) y CAJA (10)
        await ponerCantidad(5);
        await irALista();

        await abrirLapiz('IBUPROFENO 400');
        const select = screen.getByLabelText('Presentación de IBUPROFENO 400');
        expect(select).toBeTruthy();
        expect(select.textContent).toContain('UNIDAD (70)');   // lo que Salud 1 tiene de ESE producto
    });

    // Y donde hay una sola presentación no se dibuja un desplegable de un
    // elemento: es un control que no decide nada.
    it('con una sola presentación no hay desplegable', async () => {
        await abrir();            // EUTIROX tiene sólo UNIDAD
        await ponerCantidad(3);
        await irALista();
        await abrirLapiz('EUTIROX 100');
        expect(screen.queryByLabelText('Presentación de EUTIROX 100')).toBeNull();
    });

    it('la papelera lo saca y el contador baja', async () => {
        await abrir();
        await ponerCantidad(3);
        await irALista();
        expect(screen.getByRole('radio', { name: /En la solicitud · 1/ })).toBeTruthy();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Quitar EUTIROX 100' }));
        });
        expect(screen.getByText(/Todavía no agregaste nada/)).toBeTruthy();
    });

    // Subir la cantidad por encima de lo que la sala tiene no puede quedar en un
    // rojo decorativo: frena el envío, y lo dice en la tarjeta.
    it('pasarse de lo que hay marca el renglón y frena el envío', async () => {
        await abrir();
        await ponerCantidad(3);
        await irALista();
        await abrirLapiz('EUTIROX 100');
        await act(async () => {
            fireEvent.change(screen.getByLabelText('Cantidad de EUTIROX 100'), { target: { value: '999' } });
        });
        await act(async () => {
            fireEvent.change(screen.getByPlaceholderText(/Para qué se pide/), { target: { value: 'Se acabaron' } });
        });

        expect(screen.getByText(/No se puede mandar así: Salud 1 tiene 90/)).toBeTruthy();
        expect(screen.getByRole('button', { name: /^Solicitar/ })).toBeDisabled();
    });
});

// ── El atajo del producto suelto ──────────────────────────────────────────
// «Si solo quiero pedir un producto, en el primero que me salga solicitar el
// producto, y agregar otro producto» (2026-08-20). De las 215 solicitudes que
// existen, TODAS son de un producto: obligarlas a agregar, cambiar de pestaña y
// recién ahí mandar es cobrarle al caso normal el precio del raro.
describe('pedir un solo producto', () => {
    it('desde el primer producto se puede solicitar sin pasar por la lista', async () => {
        await abrir();
        await ponerCantidad(3);
        await ponerCausa('Se acabaron en sala');   // el campo está ahí mismo
        await solicitar();

        const filas = filasEnviadas();
        expect(filas).toHaveLength(1);
        expect(filas[0].metadata.items).toHaveLength(1);
        expect(filas[0].metadata.items[0]).toMatchObject({ erp_product_id: 101, cantidad: 3 });
    });

    it('y sin el «para qué» no deja mandarlo', async () => {
        await abrir();
        await ponerCantidad(3);
        expect(screen.getByRole('button', { name: /^Solicitar/ })).toBeDisabled();
    });

    // Con algo ya agregado, mandar desde acá mandaría también lo de la lista sin
    // que se vea: ahí el botón tiene que llevar a mirarla.
    it('con la lista ya empezada el atajo no aparece', async () => {
        await abrir();
        await ponerCantidad(3);
        await agregar();
        await abrirCon(AMOXI);
        await ponerCantidad(2);

        expect(screen.queryByRole('button', { name: /^Solicitar/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Agregar' })).toBeTruthy();
    });
});

describe('cuando ya salió', () => {
    // El desenlace manda sobre las pestañas: guarda contra que la pantalla de
    // «enviada» quede detrás de una pestaña y no se vea nunca.
    it('la pantalla dice cuántas salieron y a qué salas', async () => {
        await abrir();
        await ponerCantidad(3);
        await agregar();
        await abrirCon(AMOXI);
        await ponerCantidad(2);
        await agregar();
        await terminar();          // «Terminar solicitud», desde la consulta
        await ponerCausa('Se acabaron en sala');
        await solicitar();

        expect(screen.getByText(/2 solicitudes enviadas/)).toBeTruthy();
        expect(screen.getByText(/Salud 1, Salud 2 deciden/)).toBeTruthy();
    });
});

// ── Los avisos cuando el pedido no entra ──────────────────────────────────
// De la captura del 2026-08-20: NERVIOSINA X 50 SOBRES, La Popular con 27
// unidades y mínimo 62, caja de 50. Salían tres avisos rojos a la vez, uno de
// ellos culpando de unos lotes que nadie había descartado.
describe('cuando la sala tiene poco', () => {
    const NERVIOSINA = { erp_product_id: 404, descripcion: 'NERVIOSINA X 50 SOBRES' };

    // La caja de 50 no entra ni una vez en 27 unidades: elegirla sólo podía
    // producir un error, así que no se puede elegir — y la presentación queda
    // en la que sí alcanza.
    it('la presentación que no alcanza no queda elegida', async () => {
        await abrirCon(NERVIOSINA);
        expect(screen.getByText('UNIDAD (27)')).toBeTruthy();
        expect(screen.queryByText(/CAJA \(0\)/)).toBeNull();
    });

    // Con 1 unidad sí alcanza; lo único que pasa es que la sala queda corta. Eso
    // INFORMA y no impide —decisión del usuario 2026-08-06—, así que no puede
    // decir «no alcanza».
    it('quedar bajo el mínimo se avisa sin decir que no alcanza', async () => {
        await abrirCon(NERVIOSINA);
        expect(screen.getByText(/quedaría en 26, bajo su mínimo de 62/)).toBeTruthy();
        expect(screen.queryByText(/No alcanza/)).toBeNull();
    });

    // Y cuando de verdad no alcanza, se dice UNA vez y con el número real: el
    // texto viejo decía «quedaría en 0», que no es cierto —27 menos 40 no da
    // cero, da que no se puede— y encima agregaba el mínimo, que ahí no viene
    // al caso.
    it('cuando no alcanza lo dice una vez, sin hablar del mínimo', async () => {
        await abrirCon(NERVIOSINA);
        await ponerCantidad(40);
        expect(screen.getByText(/No alcanza: pides 40 unidades y La Popular tiene 27/)).toBeTruthy();
        expect(screen.queryByText(/quedaría en/)).toBeNull();
        expect(screen.queryByText(/bajo su mínimo/)).toBeNull();
    });

    // El que más molestaba: «con los lotes que dejaste faltan 23» con el único
    // lote incluido. Le echaba la culpa a una decisión que nadie tomó.
    it('no culpa de unos lotes que nadie descartó', async () => {
        await abrirCon(NERVIOSINA);
        await ponerCantidad(40);
        expect(screen.queryByText(/lotes que dejaste/)).toBeNull();
    });
});

describe('todas entran juntas o no entra ninguna', () => {
    it('viaja un solo insert con las dos filas', async () => {
        await abrir();
        await ponerCantidad(3);
        await agregar();
        await abrirCon(AMOXI);
        await ponerCantidad(2);
        await agregar();
        await terminar();
        await ponerCausa('Se acabaron en sala');
        await solicitar();

        expect(crearSolicitudTraslado).toHaveBeenCalledTimes(1);
        expect(Array.isArray(crearSolicitudTraslado.mock.calls[0][0])).toBe(true);
    });
});
