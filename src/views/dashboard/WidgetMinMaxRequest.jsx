import React, { useState, useEffect, useMemo } from 'react';
import ListRow from '../../components/common/ListRow';
import Button from '../../components/common/Button';
import { SkeletonText } from '../../components/common/StateViews';
import { Loader2, ArrowLeft, CheckCircle2, Package, TrendingUp, Building2, CircleSlash, EyeOff, CalendarClock } from 'lucide-react';
import Notice from '../../components/common/Notice';
import SearchInput from '../../components/common/SearchInput';
import PortalInput from '../../components/common/PortalInput';
import { useStaffStore } from '../../store/staffStore';
import LanzadorSolicitud, { HerramientasModal, PieModal } from './LanzadorSolicitud';
import { BarraTramos, FranjaVacia } from './InstrumentoBaldosa';
import { useAuth } from '../../context/AuthContext';
import {
    fetchProductPreciosForMinMax, fetchCurrentStockParams, insertMinMaxChangeRequest,
    buscarProductosMinMax, fetchMinMaxEstados, fetchMinMaxContextoVenta,
} from '../../data/minmaxRequests';
import { ERP_NAMES } from '../productos/tabminmax/constants';
import { effectiveMinMaxPair } from '../../data/stockParams';
import { parMinMaxValido, motivosQueExigenExplicacion, ajusteSinCambio, fmtUltimaVenta } from '../../utils/minmaxSolicitud';
import PortalTextarea from '../../components/common/PortalTextarea';

// Presentación dominante (la "caja" más grande, factor>1) para mostrar equivalentes.
function dominantPres(pres) {
  const uniq = [...new Map((pres || []).map(p => [p.factor, p])).values()];
  return uniq.filter(p => p.factor > 1).sort((a, b) => b.factor - a.factor)[0] || null;
}
// "≈ N CAJA" para un valor en unidades (ceil: la caja es indivisible).
function fmtEquiv(units, pres) {
  const d = dominantPres(pres);
  const n = Number(units);
  if (!d || !n) return null;
  return `≈ ${Math.ceil(n / d.factor)} ${(d.tipo || 'caja').trim()}`;
}

/* ── Form: propone min/max para un producto+sucursal ── */
function RequestForm({ product, erp, user, appendAuditLog, onBack, onSuccess }) {
  const [current, setCurrent]   = useState(null);   // { min, max } actuales
  const [loadingCur, setLoadingCur] = useState(false);
  const [mn, setMn]             = useState('');
  const [mx, setMx]             = useState('');
  const [reason, setReason]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr]           = useState('');
  const [pres, setPres]         = useState([]);   // presentaciones del producto (factor/tipo)
  const [ventas, setVentas]     = useState(null); // { unidadesMes, ultimaVenta } — null = todavía no llegó

  // Presentaciones del producto (para mostrar el factor y el equivalente en cajas)
  useEffect(() => {
    let cancelled = false;
    fetchProductPreciosForMinMax(product.id)
      .then(({ data }) => {
        if (cancelled) return;
        setPres((data || [])
          .map(r => ({ tipo: r.presentaciones?.tipo, factor: r.factor, descripcion: r.descripcion }))
          .filter(p => p.factor));
      });
    return () => { cancelled = true; };
  }, [product.id]);
  const domPres = dominantPres(pres);

  // Carga el min/max efectivo actual (manual ?? calculado) al elegir sucursal,
  // junto con el contexto de venta. Las dos consultas van en paralelo y el
  // formulario se destraba con la primera: el MIN·MAX de hoy es lo que decide
  // si se puede proponer algo, y las ventas son para leer, no para bloquear.
  useEffect(() => {
    if (!erp) { setCurrent(null); setVentas(null); return; }
    let cancelled = false;
    setLoadingCur(true);
    setVentas(null);
    fetchCurrentStockParams(product.id, erp)
      .then(({ data }) => {
        if (cancelled) return;
        const ef = effectiveMinMaxPair(data);
        setCurrent({
          min: ef.min,
          max: ef.max,
          sales6m: data?.units_sold_6m ?? null,
          oculto: data?.is_hidden === true,
        });
        setLoadingCur(false);
      });
    fetchMinMaxContextoVenta(product.id, erp)
      .then(ctx => { if (!cancelled) setVentas(ctx); });
    return () => { cancelled = true; };
  }, [erp, product.id]);

  // Lo propuesto, ya en números. `null` = el campo está vacío.
  const nMin = mn.trim() === '' ? null : Number.parseInt(mn, 10);
  const nMax = mx.trim() === '' ? null : Number.parseInt(mx, 10);
  const esCero = nMin === 0 && nMax === 0;

  // Las razones que se MUESTRAN mientras se escribe. Se callan hasta que el
  // MIN·MAX de hoy terminó de cargar: con `current` todavía en null, la regla
  // «no tiene parámetros» se dispararía sola y diría una falsedad por medio
  // segundo. La del envío NO se calla — ver `submit`.
  const motivosVisibles = useMemo(
    () => (!erp || loadingCur || esCero ? [] : motivosQueExigenExplicacion(current, nMin, nMax)),
    [erp, loadingCur, esCero, current, nMin, nMax]);
  // El 0 · 0 exige motivo igual, pero lo explica su propio aviso —con la
  // consecuencia adentro—, no una viñeta que repita la misma frase.
  const motivoObligatorio = esCero || motivosVisibles.length > 0;

  // ── Lo que esta propuesta NO puede hacer (2026-08-14) ────────────────────
  // Dos callejones sin salida que el formulario dejaba entrar y que sólo se
  // descubrían al intentar aprobar —o ni eso—:
  //
  //  · **Oculto.** Ocultar un producto lo deja en «— · —» y
  //    `approve_minmax_request` se niega (PRODUCT_HIDDEN). La solicitud nacía
  //    muerta y se quedaba pendiente para siempre.
  //  · **Sin cambio.** Pedir el par que la sala ya tiene. El caso que lo
  //    reportó: «— · —» → 0 · 0, que se ve distinto y es lo mismo — el pedido
  //    entra por MAX > 0 y ahí «—» vale 0. Cuatro de las cinco propuestas
  //    pendientes de Salud 2 eran exactamente eso.
  //
  // Se avisa acá, con el producto ya elegido, y no al apretar Enviar: escribir
  // un motivo entero para que después te digan que no servía es peor que no
  // poder empezar.
  const productoOculto = !!current?.oculto;
  const sinCambio      = !loadingCur && !productoOculto && ajusteSinCambio(current, nMin, nMax);
  const bloqueado      = productoOculto || sinCambio;

  const submit = async () => {
    setErr('');
    if (!erp) { setErr('Elige una sucursal'); return; }
    if (productoOculto) { setErr(`Este producto está oculto en ${ERP_NAMES[Number(erp)] || 'la sucursal'}: primero hay que mostrarlo de nuevo en Min/Max.`); return; }
    const newMin = nMin;
    const newMax = nMax;
    if (newMin === null || newMax === null || Number.isNaN(newMin) || Number.isNaN(newMax)) { setErr('Completá MIN y MAX'); return; }
    if (newMin < 0 || newMax < 0) { setErr('Los valores no pueden ser negativos'); return; }
    if (!parMinMaxValido(newMin, newMax)) {
      setErr(newMin === 0
        ? 'Con el MIN en 0, el MAX sólo puede ser 0 (deja de reponerse) o 1'
        : 'MAX debe ser mayor al MIN');
      return;
    }
    if (ajusteSinCambio(current, newMin, newMax)) {
      setErr(`${ERP_NAMES[Number(erp)] || 'La sucursal'} ya está en MIN ${newMin} · MAX ${newMax}: esta solicitud no cambiaría nada.`);
      return;
    }
    // Acá SÍ se evalúa con lo que haya: si el MIN·MAX de hoy no llegó, `current`
    // es null y eso ya es una razón («todavía no tiene»). Callarse cuando no se
    // sabe sería justo al revés.
    if (motivosQueExigenExplicacion(current, newMin, newMax).length && !reason.trim()) {
      setErr('Este ajuste necesita un motivo.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await insertMinMaxChangeRequest({
        erp_product_id:    product.id,
        erp_sucursal_id:   Number(erp),
        product_name:      product.nombre,
        current_min:       current?.min ?? null,
        current_max:       current?.max ?? null,
        current_sales_6m:  current?.sales6m ?? null,
        // El retrato de venta viaja CON la solicitud, igual que las 6 meses:
        // quien aprueba tiene que ver lo mismo que vio quien propuso, y el
        // centro de solicitudes pinta muchas filas sin poder consultar por cada
        // una. Si la consulta falló, va null — no un 0 que se leería como «no
        // vendió».
        current_sales_mes:   ventas?.unidadesMes ?? null,
        current_ultima_venta: ventas?.ultimaVenta ?? null,
        requested_min:     newMin,
        requested_max:     newMax,
        reason:            reason.trim() || null,
        requested_by:      user?.email ?? '',
        requested_by_id:   user?.id ?? null,
        requested_by_name: user?.name ?? null,
      });
      if (error) throw error;

      await appendAuditLog('MINMAX_REQUEST_CREATED', String(product.id), {
        product: product.nombre, sucursal_id: Number(erp),
        requested_min: newMin, requested_max: newMax, reason: reason.trim() || null,
      });

      // El aviso al aprobador ya NO se manda desde acá: lo crea el trigger
      // `notificar_solicitud_minmax` en la misma transacción que la solicitud.
      // Antes salía de un `try/catch` no-fatal después del insert, y el
      // resultado medido fue cero notificaciones en toda la historia de la
      // tabla: la solicitud quedaba creada y nadie se enteraba.

      onSuccess();
    } catch (e) {
      // Las reglas que también vive la base tienen su propia frase: sin esto
      // llegan como «new row violates check constraint "mmcr_…"» —o con el
      // rótulo crudo del disparador—, que no le dice nada a quien está
      // proponiendo un máximo.
      const msg = e.message ?? '';
      setErr(
        msg.includes('row-level security') ? 'No tienes permiso para crear solicitudes (widget Ajuste de Min/Max).'
        : msg.includes('mmcr_reason_required') ? 'Este ajuste necesita un motivo.'
        : msg.includes('mmcr_pair_valid') ? 'Ese par de MIN y MAX no es válido.'
        : msg.includes('MMCR_PRODUCTO_OCULTO') ? `Este producto está oculto en ${ERP_NAMES[Number(erp)] || 'la sucursal'}: primero hay que mostrarlo de nuevo en Min/Max.`
        : msg.includes('MMCR_SIN_CAMBIO') ? `${ERP_NAMES[Number(erp)] || 'La sucursal'} ya está así: esta solicitud no cambiaría nada.`
        : msg.includes('MMCR_BODEGA') ? 'Bodega no admite estas solicitudes: su MIN y su MAX salen de la suma de las salas.'
        : (msg || 'Error al enviar'));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="secondary" size="xs" icon={ArrowLeft} iconOnly onClick={onBack} />
        <div className="shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-surface-card-hover border border-divider flex items-center justify-center">
          {product.foto_url
            ? <img src={product.foto_url} alt="" className="w-full h-full object-contain" />
            : <Package size={16} className="text-content-3" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-body-sm font-black text-content truncate">{product.nombre}</p>
          {product.principio_activo && <p className="text-caption text-success-text font-semibold truncate">{product.principio_activo}</p>}
          <p className="text-caption text-content-3 truncate">
            {ERP_NAMES[Number(erp)] || 'Sucursal'}{product.laboratorio_nombre ? ` · ${product.laboratorio_nombre}` : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Actual + contexto de ventas */}
        {erp && (
          <div className="rounded-2xl border border-divider bg-surface-card-hover/60 px-3.5 py-2.5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-caption font-black text-content-2 uppercase tracking-wider">En uso ahora</span>
              {loadingCur ? <Loader2 size={13} className="animate-spin text-content-3" /> : (
                <div className="text-right">
                  <span className="text-label font-bold text-content-2">
                    MIN <span className="text-chart-4-text">{current?.min ?? '—'}</span> · MAX <span className="text-chart-1-text">{current?.max ?? '—'}</span> <span className="text-content-3 font-medium">und</span>
                  </span>
                  {(fmtEquiv(current?.min, pres) || fmtEquiv(current?.max, pres)) && (
                    <div className="text-micro text-content-3 font-semibold">
                      {fmtEquiv(current?.min, pres) || '—'} · {fmtEquiv(current?.max, pres) || '—'}
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* ── Qué tan viva está la venta (2026-08-14) ────────────────────
                «Vendidas en 6 meses» sola no distingue un producto que dejó de
                venderse de uno que vende poco y constante: 26 unidades pueden
                ser 26 el mes pasado o 26 repartidas y la última hace ocho
                meses. Medido en Salud 2: NORGESIC tenía 26 en seis meses y su
                última venta era del 20 de enero — siete meses atrás. Con esa
                fecha a la vista, «bajó su venta» se lee distinto.

                Mientras la consulta viaja va el mismo girito que usa el par de
                arriba, no un «—»: un guión ya significa «no vendió» en esta
                misma tarjeta, y usarlo también para «todavía no sé» sería
                decir un hecho que no se sabe. Si la consulta falla, `unidadesMes`
                llega en null y ahí sí va el guión — nunca un 0. */}
            {!loadingCur && (
              <div className="flex items-center justify-between gap-2 border-t border-divider pt-1.5">
                <span className="text-caption font-black text-content-2 uppercase tracking-wider flex items-center gap-1 shrink-0">
                  <TrendingUp size={11} className="text-success" /> Vendidas
                </span>
                <div className="flex items-end gap-3">
                  <div className="flex flex-col items-end leading-tight">
                    <span className="text-micro text-content-3 font-semibold">este mes</span>
                    <span className="text-label font-bold text-content-2 tabular-nums">
                      {ventas === null ? <Loader2 size={11} className="animate-spin text-content-3" />
                        : ventas.unidadesMes != null ? Number(ventas.unidadesMes).toLocaleString() : '—'}
                    </span>
                  </div>
                  <div className="flex flex-col items-end leading-tight">
                    <span className="text-micro text-content-3 font-semibold">6 meses</span>
                    <span className="text-label font-bold text-content-2 tabular-nums">
                      {current?.sales6m != null ? Number(current.sales6m).toLocaleString() : '—'}
                    </span>
                  </div>
                </div>
              </div>
            )}
            {!loadingCur && (
              <div className="flex items-center justify-between gap-2 border-t border-divider pt-1.5">
                <span className="text-caption font-black text-content-2 uppercase tracking-wider flex items-center gap-1 shrink-0">
                  <CalendarClock size={11} className="text-chart-4-text" /> Última venta
                </span>
                {ventas === null
                  ? <Loader2 size={11} className="animate-spin text-content-3" />
                  : <span className={`text-label font-bold text-right ${ventas.ultimaVenta ? 'text-content-2' : 'text-content-3'}`}>
                      {fmtUltimaVenta(ventas.ultimaVenta)}
                    </span>}
              </div>
            )}
          </div>
        )}

        {/* Oculto: no hay ajuste posible, y decirlo acá evita escribir el resto
            del formulario para nada. El camino de vuelta se nombra —«mostrarlo
            de nuevo en Min/Max»— porque si no el aviso es una puerta cerrada
            sin llave. */}
        {productoOculto && (
          <Notice variant="danger" icon={EyeOff}>
            Este producto está <b>oculto</b> en {ERP_NAMES[Number(erp)] || 'la sucursal'}: hoy no
            entra en sus pedidos y no hay MIN ni MAX que ajustar. Para volver a reponerlo hay que
            mostrarlo de nuevo desde Min/Max.
          </Notice>
        )}

        {/* Aviso: valores en unidades + factor de presentación */}
        <div className="flex items-start gap-2 rounded-xl bg-chart-1/10 border border-chart-1/30 px-3 py-2">
          <Package size={13} className="text-chart-1-text mt-0.5 shrink-0" />
          <div className="text-caption text-chart-1-text font-medium leading-snug">
            MIN y MAX se ingresan en <b>unidades</b>.
            {domPres && <> <b>{domPres.factor} und = 1 {domPres.tipo?.trim() || 'caja'}</b>.</>}
            {domPres?.descripcion && <div className="text-micro text-chart-1-text/80 mt-0.5">Factor calculado: {domPres.descripcion}</div>}
          </div>
        </div>

        {/* Nuevos valores */}
        <div className="grid grid-cols-2 gap-2">
          <PortalInput
              label="Nuevo MIN (und) *" name="minmax-min" tono="chart-4"
              type="number" min="0" value={mn} inputClassName="text-right"
              onChange={e => { setMn(e.target.value); setErr(''); }}
          />
          <PortalInput
              label="Nuevo MAX (und) *" name="minmax-max" tono="chart-1"
              type="number" min="0" value={mx} inputClassName="text-right"
              onChange={e => { setMx(e.target.value); setErr(''); }}
          />
        </div>

        {/* Acá vivía un botón «Dejar en cero» que escribía 0 y 0 en los dos
            campos de arriba. Se quitó el 2026-08-13 por redundante: los campos
            aceptan el 0 y están a un centímetro, así que el botón era un
            segundo camino al mismo estado. Lo que sí hacía falta —decir qué
            significa el 0 · 0— no era el botón sino el aviso de abajo, que se
            queda: aparece solo, en cuanto los dos campos llegan a cero. */}
        {/* Pedir lo que ya está puesto. El caso que lo reportó: «— · —» → 0 · 0,
            que en pantalla se ven distinto y para el pedido son el mismo número
            —entra por MAX > 0, y ahí el «—» vale 0—. Se nombra el par de hoy
            para que quede claro qué es lo que ya está, en vez de un «no se
            puede» a secas. */}
        {sinCambio && (
          <Notice variant="warning" icon={CircleSlash}>
            {ERP_NAMES[Number(erp)] || 'La sucursal'} ya está en <b>MIN {nMin} · MAX {nMax}</b>
            {current?.min == null && nMin === 0 && nMax === 0
              ? ' — el «—» de arriba y el 0 son el mismo número: el producto ya no se repone.'
              : '.'} Esta solicitud no cambiaría nada.
          </Notice>
        )}

        {/* El aviso del 0 · 0 se calla cuando el producto YA está apagado: ahí
            «deja de reponerse … no vuelve a entrar en los pedidos» sería falso
            —hace rato que no entra— y hacía pasar por consecuencia lo que era
            el estado de siempre. Es justo lo que se vio en la solicitud de CHIP
            DIGICEL del 2026-08-14. */}
        {esCero && !bloqueado && (
          <div className="flex items-start gap-2 rounded-xl bg-warning/10 border border-warning/30 px-3 py-2">
            <CircleSlash size={13} className="text-warning-text mt-0.5 shrink-0" />
            <div className="text-caption text-warning-text font-medium leading-snug">
              En cero el producto <b>deja de reponerse</b>: no vuelve a entrar en los pedidos
              de {ERP_NAMES[Number(erp)] || 'la sucursal'} hasta que alguien le fije un MIN y un MAX.
              Por eso el motivo es obligatorio.
            </div>
          </div>
        )}

        {/* Motivo */}
        <div className="flex flex-col gap-1.5">
          <PortalTextarea
              label="Motivo" name="minmax-motivo"
              required={motivoObligatorio}
              value={reason}
              onChange={e => { setReason(e.target.value); setErr(''); }}
              rows={2}
              placeholder={motivoObligatorio ? 'Contá por qué este ajuste' : '¿Por qué este ajuste? (opcional)'}
          />
          {/* Por qué se lo estamos pidiendo. Sin esto, el badge «Requerido»
              aparece de golpe al teclear un número y parece un capricho. */}
          {motivosVisibles.map(m => (
            <p key={m} className="text-caption text-warning-text font-semibold leading-snug px-1">{m}</p>
          ))}
        </div>

        {err && <p className="text-label text-danger-text font-semibold px-1">{err}</p>}
      </div>

      {/* El envío va al PIE del modal, no al final del cuerpo: adentro del
          scroller había que llegar hasta abajo para encontrarlo, y con el
          teclado abierto en el teléfono quedaba fuera de la vista. */}
      <PieModal>
        <Button variant="secondary" onClick={onBack}>Volver</Button>
        <Button disabled={submitting || bloqueado} onClick={submit}>{submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? 'Enviando…' : 'Enviar a aprobación'}</Button>
      </PieModal>
    </div>
  );
}

/* ── Main: busca producto → formulario ── */
export function FormularioMinMax({ selectedErp = null }) {
  const { user }       = useAuth();
  const appendAuditLog = useStaffStore(s => s.appendAuditLog);

  const [view, setView]       = useState('search'); // search | form | success
  const [search, setSearch]   = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked]   = useState(null);

  // ── La búsqueda se resuelve en el servidor (2026-08-07) ────────────────
  // Esto bajaba el catálogo entero al navegador —los 5.205 productos activos,
  // en `count` + 5 tandas de 1.000 en paralelo— y lo filtraba con `smartFilter`
  // en memoria. Medido: 6 peticiones y 4.462 ms de mediana hasta ver el primer
  // resultado, con tandas de entre 1,0 y 4,2 s cada una. Era, por lejos, el
  // modal más lento del tablero.
  //
  // El comentario anterior decía que moverlo al servidor «cambiaría el ranking
  // y es una decisión aparte». No hace falta que lo cambie: `tokenMatch` es
  // «cada token está en nombre + principio activo + laboratorio concatenados»,
  // que se escribe igual en SQL, y así está escrito en `buscar_productos_minmax`.
  // Lo único que sí cambia es el algoritmo del APROXIMADO —el que solo entra
  // cuando la búsqueda exacta no da nada—, y queda anotado en la migración.
  //
  // ── El debounce es nuevo, y son 150 ms MEDIDOS, no un número redondo ───
  // Filtrar en memoria era gratis por tecla; un viaje al servidor no, así que
  // sin debounce cada letra sería una petición. Pero el debounce se paga entero
  // después de la última tecla, y con 250 ms el A/B lo delató: contra una base
  // ya caliente, el camino nuevo salía **más lento** que bajarse el catálogo
  // (mín 504 ms contra 394). A 150 ms empata en reloj y se queda con lo demás:
  // una petición en vez de seis, unos kB en vez de ~1,4 MB, y un primer uso que
  // baja de 4,4 s a menos de un segundo.
  //
  // Es más corto que sus hermanos (300 ms en Ajuste de Inventario, 380 en la
  // Consulta) a propósito: acá la respuesta son 20 filas de texto, no la
  // existencia de siete salas.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setResults([]); setLoading(false); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- limpia resultados cuando la búsqueda es muy corta
    let cancelado = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const { filas } = await buscarProductosMinMax(q, 20);
      if (cancelado) return;
      setResults(filas);
      setLoading(false);
    }, 150);
    return () => { cancelado = true; clearTimeout(t); };
  }, [search]);

  if (view === 'success') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <CheckCircle2 size={40} className="text-success" strokeWidth={1.5} />
        <div className="text-center">
          <p className="text-body-lg font-black text-content">Solicitud enviada</p>
          <p className="text-body-sm text-content-3 mt-1">El supervisor fue notificado para aprobarla.</p>
        </div>
      </div>
    );
  }

  if (view === 'form' && picked) {
    return (
      <RequestForm
        product={picked} erp={selectedErp} user={user} appendAuditLog={appendAuditLog}
        onBack={() => { setView('search'); setPicked(null); }}
        onSuccess={() => { setView('success'); setTimeout(() => { setView('search'); setPicked(null); setSearch(''); setResults([]); }, 2600); }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* El buscador va ABIERTO y en el encabezado del modal, como el de
          Facturación. Plegado detrás de una lupa —que es lo que hacía
          `expandable`— se leía como un botón sin nombre en una pantalla cuyo
          único trabajo es buscar: había que descubrir el control antes de poder
          empezar. Reportado el 2026-08-07 sobre esta misma vista. */}
      <HerramientasModal>
        <SearchInput accentColor="var(--warning)" value={search} onChange={setSearch}
          placeholder="Buscar producto para ajustar Min/Max…" />
      </HerramientasModal>

      <div className="flex-1 overflow-y-auto space-y-1.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {loading && <div className="flex justify-center py-8"><SkeletonText lines={4} className="w-full max-w-md" /></div>}

        {!loading && search.trim().length >= 2 && results.length === 0 && (
          <div className="py-8 text-center text-body-sm text-content-3 font-medium">Sin resultados para "{search}"</div>
        )}

        {!loading && search.trim().length < 2 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-content-3">
            <TrendingUp size={28} strokeWidth={1.5} />
            <p className="text-body-sm font-semibold text-content-3 text-center px-4">Busca un producto para proponer un ajuste de mínimo/máximo</p>
          </div>
        )}

        {!loading && results.map(p => (
          <ListRow
            key={p.id}
            onClick={() => { setPicked(p); setView('form'); }}
            leading={p.foto_url
              ? <img src={p.foto_url} alt="" className="w-full h-full object-contain" />
              : <Package size={14} className="text-content-3" strokeWidth={2} />}
            iconBoxClass="bg-surface-card-hover border-border-card overflow-hidden"
            className="border-divider bg-surface-card hover:border-brand/40"
            title={p.nombre}
            trailing={<Building2 size={12} className="text-content-3" />}
          >
            {p.principio_activo && <span className="block text-micro text-success-text font-semibold truncate">{p.principio_activo}</span>}
            {p.laboratorio_nombre && <span className="block text-micro text-content-3 truncate">{p.laboratorio_nombre}</span>}
          </ListRow>
        ))}
      </div>
    </div>
  );
}


/* ─── La baldosa del tablero ──────────────────────────────────────────────── */
export default function WidgetMinMaxRequest(props) {
  const [estados, setEstados] = useState(null);

  useEffect(() => {
    let cancelado = false;
    fetchMinMaxEstados(props.selectedErp).then(r => {
      if (!cancelado) setEstados(r);
    });
    return () => { cancelado = true; };
  }, [props.selectedErp]);

  // ── La franja: en qué terminan las propuestas ────────────────────────────
  // Iba a ser una línea de propuestas por semana, hasta mirar la tabla: está
  // vacía, así que la línea habría sido una recta en cero para siempre. Lo que
  // sí dice algo desde la primera propuesta es si se aplican o se rechazan —
  // eso decide si vale la pena proponer— y sale de la misma consulta.
  //
  // Mientras no haya ninguna, la franja es el riel vacío. Es correcto: no hay
  // nada que mostrar, y dibujar una figura llena sobre cero sería inventarlo.
  const franja = useMemo(() => {
    if (!estados) return null;
    const total = estados.pendientes + estados.aplicadas + estados.rechazadas;
    if (!total) return { tramos: [], detalle: null };
    return {
      tramos: [
        { frac: estados.pendientes / total, tinta: 'fuerte' },
        { frac: estados.aplicadas  / total, tinta: 'medio'  },
        { frac: estados.rechazadas / total, tinta: 'suave'  },
      ],
      detalle: [
        estados.aplicadas  ? `${estados.aplicadas} aplicadas`   : null,
        estados.rechazadas ? `${estados.rechazadas} rechazadas` : null,
      ].filter(Boolean).join(' · ') || null,
    };
  }, [estados]);

  return (
    <LanzadorSolicitud
      icon={TrendingUp}
      label="Ajuste de Min/Max"
      pendientes={estados === null ? null : estados.pendientes}
      etiquetaPendientes="propuesta pendiente"
      etiquetaPendientesPlural="propuestas pendientes"
      vacio="Sin propuestas"
      tono="brand"
      descripcion="Proponer un mínimo o un máximo distinto para un producto"
      instrumento={franja === null
        ? <FranjaVacia />
        : <BarraTramos tramos={franja.tramos} />}
      detalle={franja?.detalle}
    >
      {/* El encabezado ya no se dibuja acá: lo pone `LanzadorSolicitud` con las
          ranuras del canónico (`LiquidModal.Header`), y de paso trae el botón
          de cerrar que este modal no tenía. */}
      {() => (
        <>
          {/* El selector de sucursal vivía en la cabecera de la tarjeta del
              tablero. Al volverse baldosa esa cabecera desapareció y con ella
              el selector: quien tiene alcance sobre todas las salas se quedaba
              sin poder cambiar de sala. Se muda acá adentro. */}
          {props.selectorSucursal}
          <FormularioMinMax {...props} />
        </>
      )}
    </LanzadorSolicitud>
  );
}
