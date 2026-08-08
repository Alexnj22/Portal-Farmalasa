import React, { useState } from 'react';
import { Smartphone, CheckCircle2, AlertCircle, Layers, Move, Trash2, RefreshCw, ClipboardCopy, Check } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import { leerCajaNegra, limpiarCajaNegra, entorno } from '../utils/cajaNegra';
import { APP_VERSION } from '../version';

const Card = ({ title, children, accent }) => (
    <div data-surface="card" className={`p-4 ${accent || 'border-border-card'}`}>
        <p className="text-label font-black uppercase tracking-widest text-content-2 mb-2">{title}</p>
        {children}
    </div>
);

const Row = ({ label, value, ok }) => (
    <div className="flex items-center justify-between py-1.5 border-b border-divider last:border-0">
        <span className="text-body text-content-2">{label}</span>
        <div className="flex items-center gap-1.5">
            {ok != null && (ok
                ? <CheckCircle2 size={13} className="text-success" />
                : <AlertCircle size={13} className="text-warning" />
            )}
            <span className="text-body font-semibold text-content">{value}</span>
        </div>
    </div>
);

const IOSTestView = () => {
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua);
    const isCapacitor = !!(window.Capacitor);
    // Se leen UNA vez al montar. Si se leyera en cada render, el propio acto de
    // mirar el registro lo movería.
    const [registro, setRegistro] = useState(() => leerCajaNegra());
    const [env] = useState(() => entorno());
    const [copiado, setCopiado] = useState(false);

    return (
        <GlassViewLayout icon={Smartphone} title="Vista de Prueba iOS">
            <div className="p-4 lg:p-8 flex flex-col gap-4">

                {/* Encabezado */}
                <div className="flex items-center gap-3 mb-1">
                    <div className="bg-gradient-to-tr from-success to-chart-9 rounded-2xl p-2.5 shadow-lg">
                        <Smartphone size={20} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-title-sm font-black text-content leading-tight">Prueba de Layout iOS</h2>
                        <p className="text-body-sm text-content-3">Verificación de safe areas y scroll</p>
                    </div>
                </div>

                {/* Entorno */}
                <Card title="Entorno detectado">
                    <Row label="Plataforma" value={isIOS ? 'iOS ✓' : 'No iOS'} ok={isIOS} />
                    <Row label="Capacitor" value={isCapacitor ? 'Activo' : 'No detectado'} ok={isCapacitor} />
                    <Row label="viewport-fit" value="cover" ok={true} />
                    <Row label="status-bar" value="black-translucent" ok={true} />
                    {/* Standalone es LA diferencia contra cualquier emulador: iOS suspende
                        la app agregada a inicio en vez de recargarla, así que puede seguir
                        corriendo código de varios despliegues atrás. Saberlo cambia el
                        diagnóstico, y no se puede deducir del código. */}
                    <Row label="Modo" value={env.standalone ? 'Agregada a inicio' : 'Navegador'} />
                    <Row label="Versión que corre" value={APP_VERSION} />
                    <Row label="Pantalla" value={env.pantalla} />
                </Card>

                {/* ── Caja negra ────────────────────────────────────────────
                    Lo que quedó anotado del último rato, incluida la parte
                    ANTERIOR a una recarga. Existe porque el fallo del teléfono
                    recarga la página —y con ella se lleva la consola— y ningún
                    emulador lo reproduce. Acá se puede leer y fotografiar. */}
                <Card title="Caja negra — últimos eventos" accent="border-brand/30">
                    <p className="text-body-sm text-content-3 leading-snug mb-2">
                        Si la pantalla se recarga sola o se queda negra, vuelve aquí y mira las
                        últimas líneas: sobreviven a la recarga.
                    </p>
                    {/* La línea `murio` es la que interesa: la escribe el arranque
                        siguiente con la última foto que alcanzó a tomar la sesión
                        que se cayó. Sin esta explicación, el número que importa
                        —el trabón— parece un dato más. */}
                    <p className="text-caption text-content-3 leading-snug mb-2">
                        La línea roja <strong className="text-content-2">murio</strong> cuenta la caída anterior.
                        Si el <strong className="text-content-2">trabón</strong> es grande, la pantalla se quedó pensando;
                        si es cero, se apagó de golpe.
                    </p>
                    {registro.length === 0 ? (
                        <p className="text-body-sm text-content-3 italic py-2">Sin eventos registrados.</p>
                    ) : (
                        <div className="flex flex-col gap-1 mt-1 max-h-80 overflow-y-auto">
                            {[...registro].reverse().map((e, i) => (
                                <div key={i} className="flex items-start gap-2 py-1 border-b border-divider last:border-0">
                                    <Badge size="sm" className="shrink-0"
                                        variant={/error|fallido|no-cargo|sin-capturar|murio/.test(e.tipo) ? 'danger' : 'neutral'}>
                                        {e.tipo}
                                    </Badge>
                                    <div className="min-w-0 flex-1">
                                        {/* El `tag` distingue una FOTO que no cargó de un
                                            ARCHIVO DE CÓDIGO que no cargó, y son dos fallos que
                                            no se parecen en nada: el primero deja un hueco, el
                                            segundo deja la pantalla vacía. Sin esto los dos se
                                            leían igual —una URL larga— y hubo que ir a decodificarla
                                            para saber cuál era. */}
                                        <p className="text-caption text-content-2 break-words leading-snug">
                                            {e.tag ? `<${String(e.tag).toLowerCase()}> ` : ''}
                                            {e.msg || e.src || e.url || e.estado || e.version || '—'}
                                        </p>
                                        <p className="text-micro text-content-3">
                                            {e.t?.slice(11, 19)} · {e.ruta}
                                            {e.recargando === true  && ' · recargó'}
                                            {e.recargando === false && ' · NO recargó (dentro de los 30s)'}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                        <Button variant="secondary" size="sm" icon={Trash2}
                            onClick={() => { limpiarCajaNegra(); setRegistro([]); }}>
                            Vaciar
                        </Button>
                        <Button variant="secondary" size="sm" icon={RefreshCw}
                            onClick={() => setRegistro(leerCajaNegra())}>
                            Actualizar
                        </Button>
                        {/* Transcribir a mano lo que se ve en la tarjeta ya costó una
                            vuelta entera: llegaron cuatro líneas de las cuarenta que
                            hay, y de otro aparato. El registro completo cabe en un
                            toque. */}
                        <Button variant="secondary" size="sm" icon={copiado ? Check : ClipboardCopy}
                            onClick={async () => {
                                const texto = leerCajaNegra().map(e =>
                                    `${e.t?.slice(11, 19) ?? '—'}  ${String(e.tipo).padEnd(20)} ${e.ruta ?? ''}\n`
                                    + `           ${e.tag ? `<${String(e.tag).toLowerCase()}> ` : ''}${e.msg || e.src || e.url || e.estado || e.version || ''}`,
                                ).join('\n');
                                try {
                                    await navigator.clipboard.writeText(
                                        `caja negra · ${APP_VERSION} · ${env.pantalla}\n(las horas son UTC)\n\n${texto}`);
                                    setCopiado(true);
                                    setTimeout(() => setCopiado(false), 2000);
                                } catch { /* sin permiso de portapapeles */ }
                            }}>
                            {copiado ? 'Copiado' : 'Copiar todo'}
                        </Button>
                    </div>
                </Card>

                {/* Qué verificar */}
                <Card title="Lista de verificación visual">
                    <div className="flex flex-col gap-2 mt-1">
                        {[
                            'La barra superior (Dynamic Island / notch) tiene glass blur, NO gris sólido',
                            'La barra inferior (home indicator) tiene glass blur, NO gris sólido',
                            'Se puede hacer scroll aquí abajo',
                            'El contenido NO queda cortado por la pill superior',
                            'Al hacer scroll, el glass del header permanece fijo',
                        ].map((item, i) => (
                            <div key={i} className="flex items-start gap-2.5">
                                <div className="w-5 h-5 rounded-full border-2 border-divider flex-shrink-0 mt-0.5" />
                                <p className="text-body text-content-2 leading-snug">{item}</p>
                            </div>
                        ))}
                    </div>
                </Card>

                {/* Scroll test — tarjetas de relleno */}
                <Card title="Prueba de scroll — desplázate hacia abajo">
                    <div className="flex flex-col gap-2 mt-1">
                        {Array.from({ length: 12 }, (_, i) => (
                            <div key={i} className="flex items-center justify-between rounded-xl bg-gradient-to-r from-brand/8 to-brand-purple/8 px-3 py-3 border border-brand/10">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-brand to-brand-purple flex items-center justify-center flex-shrink-0">
                                        <span className="text-white text-caption font-black">{i + 1}</span>
                                    </div>
                                    <span className="text-body font-semibold text-content-2">Fila de prueba {i + 1}</span>
                                </div>
                                <Move size={14} className="text-content-3" />
                            </div>
                        ))}
                    </div>
                </Card>

                {/* Info */}
                <Card title="Acerca de esta vista" accent="border-warning/30">
                    <p className="text-body-sm text-content-3 leading-relaxed">
                        Esta vista es solo para verificar el comportamiento del layout en iOS. Puede eliminarse
                        una vez confirmado que las safe areas, el glass blur y el scroll funcionan correctamente.
                    </p>
                    <div className="flex items-center gap-1.5 mt-2">
                        <Layers size={12} className="text-warning" />
                        <span className="text-label font-bold text-warning uppercase tracking-wider">Solo visible para SUPERADMIN y ADMIN</span>
                    </div>
                </Card>

            </div>
        </GlassViewLayout>
    );
};

export default IOSTestView;
