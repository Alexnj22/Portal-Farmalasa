import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

const BranchChips = ({
  branches = [],
  selectedBranch = "ALL",
  onSelect,
  allowAll = true,
  allLabel = "Todas las Sucursales",
  className = "",
  counts = null,
}) => {
  const containerRef = useRef(null);
  const rowRef = useRef(null);
  const btnRefs = useRef(new Map());

  const [visibleKeys, setVisibleKeys] = useState([]);
  const [hiddenKeys, setHiddenKeys] = useState([]);
  const [moreOpen, setMoreOpen] = useState(false);

  const [indicator, setIndicator] = useState({ left: 0, width: 0, show: false });

  const items = useMemo(() => {
    const list = [];
    if (allowAll) list.push({ key: "ALL", label: allLabel });
    (branches || []).forEach((b) => list.push({ key: String(b.id), label: b.name }));
    return list;
  }, [branches, allowAll, allLabel]);

  const selectedKey = String(selectedBranch ?? "ALL");

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e) => {
      const root = containerRef.current;
      if (!root) return;
      if (!root.contains(e.target)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [moreOpen]);

  const recomputeVisibility = () => {
    const wrapEl = containerRef.current;
    if (!wrapEl) return;

    const P = 8; // p-2
    const GAP = 8; // gap-2
    const available = Math.max(0, wrapEl.clientWidth - P * 2);

    const MIN_PER_TAB = 120;
    const MORE_W = 140;

    const nAll = items.length || 1;
    const canFitAll = available / nAll >= MIN_PER_TAB;

    if (canFitAll) {
      setVisibleKeys(items.map((it) => it.key));
      setHiddenKeys([]);
      return;
    }

    const usable = Math.max(0, available - MORE_W - GAP);
    const maxVisible = Math.max(2, Math.floor(usable / MIN_PER_TAB));
    const vis = items.slice(0, maxVisible).map((it) => it.key);
    const hid = items.slice(maxVisible).map((it) => it.key);

    setVisibleKeys(vis);
    setHiddenKeys(hid);
  };

  useLayoutEffect(() => {
    recomputeVisibility();
    const ro = new ResizeObserver(() => recomputeVisibility());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [items.length]);

  const visibleItems = useMemo(
    () => items.filter((it) => visibleKeys.includes(it.key)),
    [items, visibleKeys]
  );

  const hiddenItems = useMemo(
    () => items.filter((it) => hiddenKeys.includes(it.key)),
    [items, hiddenKeys]
  );

  const isHiddenSelected = hiddenKeys.includes(selectedKey);

  const selectKey = (k) => {
    onSelect?.(String(k));
    setMoreOpen(false);
  };

  const recomputeIndicator = () => {
    const wrap = containerRef.current;
    const row = rowRef.current;
    const btn = btnRefs.current.get(selectedKey);

    if (!wrap || !row || !btn) {
      setIndicator((p) => ({ ...p, show: false }));
      return;
    }

    if (!visibleKeys.includes(selectedKey)) {
      setIndicator((p) => ({ ...p, show: false }));
      return;
    }

    const wrapRect = wrap.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();

    const left = btnRect.left - wrapRect.left;
    const width = btnRect.width;

    setIndicator({
      left: Math.max(0, left),
      width: Math.max(24, width),
      show: true,
    });
  };

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(recomputeIndicator);
    return () => cancelAnimationFrame(raf);
  }, [selectedKey, visibleKeys.join(","), hiddenKeys.join(",")]);

  useEffect(() => {
    const onResize = () => recomputeIndicator();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [selectedKey, visibleKeys.join(","), hiddenKeys.join(",")]);

  return (
    <div className={`w-full ${className}`}>
      <div
        ref={containerRef}
        // FIX: Eliminado 'overflow-hidden' para que el menú pueda salir
        className="glass-surface p-2 rounded-[1.5rem] border border-white/70 shadow-sm relative"
      >
        {/* Slider activo */}
        <div
          className={`absolute top-2 bottom-2 bg-white rounded-[1.25rem]
            shadow-[0_10px_22px_rgba(0,0,0,0.10),0_2px_6px_rgba(0,0,0,0.06)]
            transform-gpu transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)]
            pointer-events-none
            ${indicator.show ? "opacity-100" : "opacity-0"}
          `}
          style={{
            left: indicator.left,
            width: indicator.width,
          }}
        />

        <div className="relative z-10 flex items-center gap-2">
          {/* Tabs visibles */}
          <div
            ref={rowRef}
            className="grid gap-2 flex-1 min-w-0"
            style={{
              gridTemplateColumns: `repeat(${Math.max(1, visibleItems.length)}, minmax(0, 1fr))`,
            }}
          >
            {visibleItems.map((it) => {
              const active = it.key === selectedKey;
              const count = counts ? counts[it.key] ?? 0 : null;

              return (
                <button
                  key={it.key}
                  ref={(el) => {
                    if (el) btnRefs.current.set(it.key, el);
                    else btnRefs.current.delete(it.key);
                  }}
                  type="button"
                  onClick={() => selectKey(it.key)}
                  className={[
                    "py-3 px-3 rounded-[1.25rem] text-[11px] font-semibold",
                    "flex items-center justify-center gap-2 min-w-0",
                    "transition-all duration-250 transform-gpu relative z-10",
                    active
                      ? "text-slate-900"
                      : "text-slate-500 hover:text-slate-700 hover:bg-white/35 hover:-translate-y-[1px] hover:shadow-[0_14px_30px_rgba(0,0,0,0.10)] active:translate-y-0",
                  ].join(" ")}
                  title={it.label}
                >
                  <span className="truncate">{it.label}</span>

                  {counts && (
                    <span className="bg-black/5 px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Ver más */}
          {hiddenItems.length > 0 && (
            <div className="relative flex-shrink-0">
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                className={[
                  "py-3 px-4 rounded-[1.25rem] text-[11px] font-semibold",
                  "flex items-center justify-center gap-2",
                  "transition-all duration-250 transform-gpu relative z-10",
                  moreOpen
                    ? "text-slate-900 bg-white/55 shadow-[0_14px_30px_rgba(0,0,0,0.10)]"
                    : "text-slate-500 hover:text-slate-700 hover:bg-white/35 hover:-translate-y-[1px] hover:shadow-[0_14px_30px_rgba(0,0,0,0.10)] active:translate-y-0",
                  isHiddenSelected ? "ring-2 ring-[#007AFF]/20" : "",
                ].join(" ")}
              >
                <span className="truncate">Ver más</span>
                <ChevronDown
                  size={16}
                  className={`transition-transform ${moreOpen ? "rotate-180" : ""}`}
                />
              </button>

              {moreOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white/95 backdrop-blur-2xl border border-white rounded-[1.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.15)] p-2 z-50 animate-in fade-in zoom-in-95 duration-200">
                  <div className="max-h-72 overflow-y-auto scrollbar-hide space-y-1">
                    {hiddenItems.map((it) => {
                      const active = it.key === selectedKey;
                      const count = counts ? counts[it.key] ?? 0 : null;

                      return (
                        <button
                          key={it.key}
                          type="button"
                          onClick={() => selectKey(it.key)}
                          className={[
                            "w-full px-4 py-3 rounded-[1rem] text-left flex items-center justify-between",
                            "transition-all duration-200 transform-gpu",
                            active 
                                ? "bg-[#007AFF]/10 text-[#007AFF]" 
                                : "hover:bg-slate-50 hover:translate-x-1 text-slate-600",
                          ].join(" ")}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-[13px] font-bold truncate">
                              {it.label}
                            </span>
                            {counts && (
                              <span className="bg-black/5 px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 text-slate-500">
                                {count}
                              </span>
                            )}
                          </div>

                          {active && (
                            <Check size={16} className="text-[#007AFF] flex-shrink-0" strokeWidth={2.5} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BranchChips;