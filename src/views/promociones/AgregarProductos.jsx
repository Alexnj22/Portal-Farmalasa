import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, FlaskConical, Plus, Search } from 'lucide-react';
import SearchInput from '../../components/common/SearchInput';
import LiquidSelect from '../../components/common/LiquidSelect';
import Button from '../../components/common/Button';
import Checkbox from '../../components/common/Checkbox';
import Notice from '../../components/common/Notice';
import { SkeletonText } from '../../components/common/StateViews';
import { fetchProductosParaPromocion } from '../../data/promociones';

/**
 * Elegir VARIOS productos de una vez.
 *
 * ── El caso que lo pidió (2026-09-05) ─────────────────────────────────────
 * «¿y si quiero agregar todas las leches?». El formulario buscaba de a uno, así
 * que una promoción de doce productos eran doce búsquedas y doce confirmaciones
 * — y cada una repetía fechas, lote y bono que en la negociación se dijeron una
 * sola vez.
 *
 * ── Dos formas de agrupar, y por qué NO hay una tercera ───────────────────
 * · **Por nombre** — «leche», «ensure». El corte real de una familia de
 *   productos casi nunca coincide con el laboratorio.
 * · **Por laboratorio** — la campaña se negocia CON uno, así que traer los suyos
 *   y quitar los que no van es el camino corto.
 *
 * **Por categoría NO, y no es un olvido:** medido el 2026-09-05, `products` no
 * tiene columna de categoría y ninguna clave foránea apunta a
 * `product_categories` —30 filas huérfanas—; `tipo_medicamento` está vacío en
 * 4,371 de 4,376 productos activos. Ofrecerla sería ofrecer un recorte que sólo
 * puede dar vacío, y un vacío se lee como «no hay productos de esa categoría»
 * en vez de «nadie clasificó nada».
 *
 * ── La búsqueda por texto es LITERAL, y eso se ve ─────────────────────────
 * «leche» trae 22 e incluye «COPA SUNDAE DULCE DE LECHE SARITA». No se intenta
 * adivinar: la lista se muestra entera con sus casillas para que quien elige
 * vea lo que entra y desmarque. Un buscador que filtra de más «por ayudar»
 * esconde justo lo que habría que revisar.
 *
 * @param yaElegidos  ids que la promoción ya tiene — se marcan y no se repiten.
 * @param onAgregar   recibe `[{ id, nombre, laboratorio_nombre }]`.
 */
/* El tope lo pone la BASE: `crear_promocion` lanza `DEMASIADOS_PRODUCTOS` con
   más de 50. Se repite acá para poder avisar AL AGREGAR y no al guardar —
   traerse los 150 de un laboratorio y enterarse recién al final es perder el
   trabajo entero. Si cambia allá, cambia acá. */
export const TOPE_PRODUCTOS = 50;

export default function AgregarProductos({ yaElegidos = [], onAgregar, laboratorios = [] }) {
    const [modo, setModo] = useState('texto');      // 'texto' | 'laboratorio'
    const [texto, setTexto] = useState('');
    const [lab, setLab] = useState('');
    const [filas, setFilas] = useState([]);
    const [total, setTotal] = useState(0);
    const [cargando, setCargando] = useState(false);
    const [marcados, setMarcados] = useState(() => new Set());

    const yaSet = useMemo(() => new Set(yaElegidos.map(Number)), [yaElegidos]);

    /* La consulta se dispara a los 300 ms de dejar de escribir. Es más largo que
       los 150 del buscador de a uno a propósito: acá la respuesta puede traer
       150 filas y pintarlas en cada tecla es trabajo tirado. */
    const consulta = modo === 'texto' ? texto.trim() : '';
    const labId = modo === 'laboratorio' ? lab : '';

    useEffect(() => {
        // Sin consulta no hay nada que pedir: se vuelve al estado de invitación.
        if (modo === 'texto' && consulta.length < 2) { setFilas([]); setTotal(0); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect
        if (modo === 'laboratorio' && !labId) { setFilas([]); setTotal(0); return undefined; }
        let vivo = true;
        setCargando(true);
        const t = setTimeout(() => {
            fetchProductosParaPromocion({
                texto: modo === 'texto' ? consulta : null,
                laboratorioId: modo === 'laboratorio' ? Number(labId) : null,
            })
                .then((r) => {
                    if (!vivo) return;
                    setFilas(r.productos || []);
                    setTotal(r.total || 0);
                })
                .catch(() => { if (vivo) { setFilas([]); setTotal(0); } })
                .finally(() => { if (vivo) setCargando(false); });
        }, 300);
        return () => { vivo = false; clearTimeout(t); };
    }, [modo, consulta, labId]);

    /* Lo que se puede marcar: lo que la promoción todavía no tiene. Los que ya
       están se muestran igual, en gris — esconderlos haría que la lista de un
       laboratorio cambiara de tamaño entre visitas sin decir por qué. */
    const disponibles = useMemo(() => filas.filter((p) => !yaSet.has(Number(p.id))), [filas, yaSet]);
    const todosMarcados = disponibles.length > 0 && disponibles.every((p) => marcados.has(p.id));

    /* Van ANTES de las funciones que los leen: `alternarHastaElTope` usa
       `caben`, y aunque hoy no puede fallar —el cuerpo de una función corre
       después—, `gate:tdz` lo cuenta como deuda porque mover ese uso fuera de
       la función lo convertiría en una lectura que lanza. */
    const cuantos = [...marcados].filter((id) => !yaSet.has(Number(id))).length;
    const caben = Math.max(0, TOPE_PRODUCTOS - yaSet.size);
    const sePasa = cuantos > caben;

    const alternar = (id) => setMarcados((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id); else n.add(id);
        return n;
    });

    const agregar = () => {
        const elegidos = filas.filter((p) => marcados.has(p.id) && !yaSet.has(Number(p.id)));
        if (!elegidos.length) return;
        onAgregar?.(elegidos);
        setMarcados(new Set());
    };

    /* Marcar TODOS cuando no caben todos marcaría de más y el botón quedaría
       bloqueado sin decir por qué. Se marcan los que entran, y el aviso dice
       cuántos son. */
    const alternarHastaElTope = () => setMarcados((s2) => {
        const n = new Set(s2);
        if (todosMarcados) { disponibles.forEach((p) => n.delete(p.id)); return n; }
        for (const p of disponibles) {
            if (n.size >= caben) break;
            n.add(p.id);
        }
        return n;
    });


    return (
        <div className="rounded-lg border border-border-card p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg bg-surface-card-hover p-0.5 gap-0.5 shrink-0">
                    {[
                        { k: 'texto', icon: Search, label: 'Por nombre' },
                        { k: 'laboratorio', icon: FlaskConical, label: 'Por laboratorio' },
                    ].map(({ k, icon: Icono, label }) => (
                        <button
                            key={k}
                            type="button"
                            onClick={() => { setModo(k); setMarcados(new Set()); }}
                            aria-pressed={modo === k}
                            className={`min-h-[max(32px,var(--tap-min))] px-3 rounded-md text-caption font-semibold
                                        flex items-center gap-1.5 transition-colors
                                        ${modo === k ? 'bg-brand text-white' : 'text-content-2 hover:text-content'}`}
                        >
                            <Icono size={13} aria-hidden />
                            {label}
                        </button>
                    ))}
                </div>

                <div className="flex-1 min-w-[200px]">
                    {modo === 'texto' ? (
                        <SearchInput
                            value={texto}
                            onChange={setTexto}
                            placeholder="Escribe parte del nombre: leche, ensure, omega…"
                        />
                    ) : (
                        <LiquidSelect
                            value={lab}
                            onChange={(v) => { setLab(v || ''); setMarcados(new Set()); }}
                            /* El conteo va en el rótulo: con 324 laboratorios el
                               desplegable exige escribir, así que quien elige lo
                               hace a ciegas — el número es lo único que anticipa
                               cuántos productos va a traer. */
                            options={laboratorios.map((l) => ({
                                value: String(l.id),
                                label: l.productos ? `${l.nombre} · ${l.productos}` : l.nombre,
                            }))}
                            placeholder="Elige el laboratorio"
                            ariaLabel="Laboratorio"
                        />
                    )}
                </div>
            </div>

            {cargando && <SkeletonText lines={3} />}

            {!cargando && filas.length > 0 && (
                <>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <Checkbox
                            checked={todosMarcados}
                            indeterminate={!todosMarcados && disponibles.some((p) => marcados.has(p.id))}
                            onChange={alternarHastaElTope}
                            label={todosMarcados
                                ? 'Quitar la marca de todos'
                                : (disponibles.length > caben
                                    ? `Marcar ${caben} (es el máximo)`
                                    : `Marcar los ${disponibles.length}`)}
                            disabled={disponibles.length === 0 || caben === 0}
                        />
                        {/* Cuántos hay de verdad contra cuántos se muestran. El RPC
                            devuelve hasta 400 y el total sin tope, así que una lista
                            cortada lo DICE en vez de parecer completa. */}
                        <span className="text-caption text-content-3 tabular-nums">
                            {total > filas.length
                                ? `${filas.length} de ${total} — afina la búsqueda`
                                : `${total} ${total === 1 ? 'producto' : 'productos'}`}
                        </span>
                    </div>

                    {/* El scroll va AISLADO en su propio contenedor.
                        Medido el 2026-09-05 con 150 productos: la lista se
                        acotaba bien (256px) pero el cuerpo del modal contaba su
                        contenido COMPLETO —`scrollHeight` 7269 sobre 1051 px de
                        contenido real—, así que el modal quedaba con un vacío
                        enorme y un scroll que no terminaba. `contain` corta esa
                        propagación: lo de adentro deja de contar para el alto de
                        afuera. */}
                    <div className="rounded-lg border border-border-card overflow-hidden [contain:layout]">
                    <ul className="max-h-64 overflow-y-auto overscroll-contain divide-y divide-border-card">
                        {filas.map((p) => {
                            const yaEsta = yaSet.has(Number(p.id));
                            return (
                                <li key={p.id} className="px-2 py-1">
                                    <Checkbox
                                        checked={yaEsta || marcados.has(p.id)}
                                        onChange={() => !yaEsta && alternar(p.id)}
                                        disabled={yaEsta}
                                        label={p.nombre}
                                        description={yaEsta
                                            ? 'Ya está en la promoción'
                                            : (p.laboratorio_nombre || 'Sin laboratorio')}
                                    />
                                </li>
                            );
                        })}
                    </ul>
                    </div>

                    {/* El tope se dice ANTES de agregar. La base lo rechaza igual,
                        pero enterarse al guardar —después de elegir 150— es perder
                        el trabajo entero. */}
                    {caben === 0 && (
                        <Notice variant="warning" icon={AlertTriangle}>
                            La promoción ya tiene {TOPE_PRODUCTOS} productos, que es el máximo.
                            Quita alguno para agregar otro.
                        </Notice>
                    )}
                    {caben > 0 && sePasa && (
                        <Notice variant="warning" icon={AlertTriangle}>
                            Caben {caben} más — una promoción admite hasta {TOPE_PRODUCTOS} productos.
                        </Notice>
                    )}

                    <Button icon={Plus} onClick={agregar}
                        disabled={cuantos === 0 || sePasa || caben === 0} className="w-full">
                        {cuantos === 0
                            ? 'Marca los que entran'
                            : `Agregar ${cuantos} ${cuantos === 1 ? 'producto' : 'productos'}`}
                    </Button>
                </>
            )}

            {!cargando && filas.length === 0 && (
                <Notice variant="info" icon={modo === 'texto' ? Search : FlaskConical}>
                    {modo === 'texto'
                        ? (consulta.length < 2
                            ? 'Escribe al menos dos letras del nombre.'
                            : `Ningún producto activo coincide con «${consulta}».`)
                        : (labId
                            ? 'Ese laboratorio no tiene productos activos.'
                            : 'Elige un laboratorio para ver sus productos.')}
                </Notice>
            )}
        </div>
    );
}

/** Un producto ya elegido, en una línea. */
export function LineaElegida({ nombre, detalle, onAjustar, onQuitar, AccionAjustar, AccionQuitar }) {
    return (
        <div className="rounded-lg border border-border-card bg-surface-card-hover px-3 py-2
                        flex items-center gap-2">
            <Check size={15} className="text-success shrink-0" aria-hidden />
            <div className="flex-1 min-w-0">
                <p className="text-body-sm font-semibold text-content truncate">{nombre}</p>
                <p className="text-caption text-content-3 truncate">{detalle}</p>
            </div>
            {AccionAjustar && <AccionAjustar onClick={onAjustar} />}
            {AccionQuitar && <AccionQuitar onClick={onQuitar} />}
        </div>
    );
}
