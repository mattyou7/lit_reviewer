import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { papers, graphNodes, graphEdges } from '../data/mockData';
import type { GraphNode, GraphEdge } from '../data/mockData';

interface Props {
  onSelectPaper: (id: string) => void;
}

interface Transform { x: number; y: number; scale: number; }

const EDGE_STYLES: Record<GraphEdge['type'], { stroke: string; dasharray?: string; opacity: number; width: number }> = {
  'cites': { stroke: '#a08ecf', opacity: 0.55, width: 1.2 },
  'cited-by': { stroke: '#a08ecf', opacity: 0.4, width: 1 },
  'semantic': { stroke: '#6b9e8c', dasharray: '4 3', opacity: 0.5, width: 1.2 },
  'shared-concept': { stroke: '#928ea8', dasharray: '2 4', opacity: 0.35, width: 1 },
  'shared-method': { stroke: '#c2975a', dasharray: '5 3 1 3', opacity: 0.45, width: 1 },
};

const CLUSTER_COLORS: Record<string, string> = {
  foundation: 'rgba(160,142,207,0.05)',
  vision: 'rgba(107,158,140,0.05)',
  generation: 'rgba(194,151,90,0.05)',
  alignment: 'rgba(194,111,111,0.05)',
};

function getNodeRadius(node: GraphNode): number {
  if (node.type !== 'paper' || !node.citations) return 0;
  return Math.min(20, 5 + Math.sqrt(node.citations / 1200));
}

function getClusterCenter(cluster: string) {
  const nodes = graphNodes.filter(n => n.cluster === cluster && n.type === 'paper');
  if (!nodes.length) return { cx: 500, cy: 300, rx: 80, ry: 60 };
  const minX = Math.min(...nodes.map(n => n.x));
  const maxX = Math.max(...nodes.map(n => n.x));
  const minY = Math.min(...nodes.map(n => n.y));
  const maxY = Math.max(...nodes.map(n => n.y));
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    rx: (maxX - minX) / 2 + 60,
    ry: (maxY - minY) / 2 + 50,
  };
}

const CLUSTER_NAMES: Record<string, string> = {
  foundation: 'Foundation Models',
  vision: 'Vision & Multimodal',
  generation: 'Generative',
  alignment: 'Alignment & Reasoning',
};

const YEARS = [2017, 2018, 2019, 2020, 2021, 2022];

export default function Landscape({ onSelectPaper }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;

  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showClusters, setShowClusters] = useState(true);
  const [filterEdges, setFilterEdges] = useState<Set<GraphEdge['type']>>(new Set(['cites', 'semantic', 'shared-concept', 'shared-method']));
  const [filterNodeTypes, setFilterNodeTypes] = useState<Set<string>>(new Set(['paper', 'concept', 'method']));
  const [filterYearMin, setFilterYearMin] = useState(2017);
  const [filterYearMax, setFilterYearMax] = useState(2022);
  const [filterOA, setFilterOA] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.88 : 1.14;
      const rect = svg.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setTransform(prev => {
        const newScale = Math.max(0.2, Math.min(5, prev.scale * factor));
        const k = newScale / prev.scale;
        return { x: cx - k * (cx - prev.x), y: cy - k * (cy - prev.y), scale: newScale };
      });
    };
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      setTransform(prev => ({ ...prev, x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }));
    };
    const handleUp = () => setIsDragging(false);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => { document.removeEventListener('mousemove', handleMove); document.removeEventListener('mouseup', handleUp); };
  }, [isDragging]);

  const handleSvgMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as SVGElement).closest('.graph-node')) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  }, [transform.x, transform.y]);

  const nodeMap = useMemo(() => Object.fromEntries(graphNodes.map(n => [n.id, n])), []);

  const visibleNodes = useMemo(() => graphNodes.filter(n => {
    if (!filterNodeTypes.has(n.type)) return false;
    if (n.type === 'paper') {
      const p = papers.find(p => p.id === n.paperId);
      if (!p) return false;
      if (n.year && (n.year < filterYearMin || n.year > filterYearMax)) return false;
      if (filterOA && !p.openAccess) return false;
      if (searchTerm && !p.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    }
    return true;
  }), [filterNodeTypes, filterYearMin, filterYearMax, filterOA, searchTerm]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes]);

  const visibleEdges = useMemo(() => graphEdges.filter(e =>
    filterEdges.has(e.type) && visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)
  ), [filterEdges, visibleNodeIds]);

  const connectedTo = useMemo(() => {
    if (!hoveredId) return new Set<string>();
    const connected = new Set<string>();
    graphEdges.forEach(e => {
      if (e.source === hoveredId) connected.add(e.target);
      if (e.target === hoveredId) connected.add(e.source);
    });
    return connected;
  }, [hoveredId]);

  const selectedNode = selectedId ? nodeMap[selectedId] : null;
  const selectedPaper = selectedNode?.paperId ? papers.find(p => p.id === selectedNode.paperId) : null;

  const toggleFilter = (set: Set<GraphEdge['type']>, value: GraphEdge['type'], setter: (s: Set<GraphEdge['type']>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  };

  const toggleNodeType = (type: string) => {
    const next = new Set(filterNodeTypes);
    if (next.has(type)) next.delete(type); else next.add(type);
    setFilterNodeTypes(next);
  };

  const resetView = () => setTransform({ x: 0, y: 0, scale: 1 });

  const clusters = useMemo(() => {
    const clusterSet = new Set(graphNodes.map(n => n.cluster).filter(Boolean) as string[]);
    return Array.from(clusterSet).map(cluster => ({ cluster, ...getClusterCenter(cluster) }));
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Graph area */}
      <div className="flex-1 relative overflow-hidden" style={{ background: 'var(--color-bg)' }}>
        <svg
          ref={svgRef}
          className="graph-area w-full h-full"
          onMouseDown={handleSvgMouseDown}
        >
          <defs>
            <marker id="arrow-cites" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="#a08ecf" opacity="0.5" />
            </marker>
          </defs>

          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
            {/* Cluster backgrounds */}
            {showClusters && clusters.map(({ cluster, cx, cy, rx, ry }) => (
              <ellipse key={cluster} cx={cx} cy={cy} rx={rx} ry={ry}
                fill={CLUSTER_COLORS[cluster] ?? 'transparent'}
                stroke={CLUSTER_COLORS[cluster]?.replace('0.05', '0.15') ?? 'transparent'}
                strokeWidth={1}
              />
            ))}

            {/* Cluster labels */}
            {showClusters && clusters.map(({ cluster, cx, cy, ry }) => (
              <text key={`label-${cluster}`} x={cx} y={cy - ry + 14} textAnchor="middle"
                fontSize="9" fill={CLUSTER_COLORS[cluster]?.replace('0.05', '0.6') ?? '#555'}
                fontFamily="Inter, sans-serif" letterSpacing="0.5">
                {CLUSTER_NAMES[cluster]}
              </text>
            ))}

            {/* Edges */}
            {visibleEdges.map((edge, i) => {
              const src = nodeMap[edge.source];
              const tgt = nodeMap[edge.target];
              if (!src || !tgt) return null;
              const style = EDGE_STYLES[edge.type];
              const dx = tgt.x - src.x;
              const dy = tgt.y - src.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const r = getNodeRadius(tgt);
              const ex = tgt.x - (dx / dist) * (r + 3);
              const ey = tgt.y - (dy / dist) * (r + 3);
              const isHighlighted = hoveredId && (edge.source === hoveredId || edge.target === hoveredId);
              const isDimmed = hoveredId && !isHighlighted;
              return (
                <line key={i}
                  x1={src.x} y1={src.y} x2={ex} y2={ey}
                  stroke={style.stroke}
                  strokeWidth={style.width * (isHighlighted ? 2 : 1)}
                  strokeDasharray={style.dasharray}
                  opacity={isDimmed ? 0.1 : style.opacity * (isHighlighted ? 1.6 : 1)}
                  markerEnd={edge.type === 'cites' ? 'url(#arrow-cites)' : undefined}
                  style={{ transition: 'opacity 0.15s' }}
                />
              );
            })}

            {/* Nodes */}
            {visibleNodes.map(node => {
              const r = getNodeRadius(node);
              const isSelected = node.id === selectedId;
              const isHovered = node.id === hoveredId;
              const isConnected = connectedTo.has(node.id);
              const isDimmed = hoveredId && node.id !== hoveredId && !isConnected;
              const paper = node.paperId ? papers.find(p => p.id === node.paperId) : null;

              let fill = 'var(--color-panel)';
              let stroke = 'var(--color-edge)';
              let strokeWidth = 1;
              if (node.type === 'paper') {
                fill = isSelected ? 'rgba(160,142,207,0.25)' : isHovered ? 'rgba(160,142,207,0.15)' : 'rgba(43,41,57,0.9)';
                stroke = isSelected ? '#c0adf0' : isHovered ? '#a08ecf' : isConnected ? '#a08ecf' : '#3c3952';
                strokeWidth = isSelected ? 2 : 1.2;
              } else if (node.type === 'concept') {
                fill = isSelected ? 'rgba(107,158,140,0.18)' : 'rgba(43,41,57,0.8)';
                stroke = isSelected ? '#6b9e8c' : '#3c3952';
              } else if (node.type === 'method') {
                fill = isSelected ? 'rgba(194,151,90,0.18)' : 'rgba(43,41,57,0.8)';
                stroke = isSelected ? '#c2975a' : '#3c3952';
              }

              if (node.type === 'paper') {
                const labelLines = node.label.split('\n');
                return (
                  <g key={node.id} className="graph-node" style={{ cursor: 'pointer', opacity: isDimmed ? 0.25 : 1, transition: 'opacity 0.15s' }}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => { setSelectedId(node.id); if (node.paperId) onSelectPaper(node.paperId); }}
                  >
                    <circle cx={node.x} cy={node.y} r={r + (isSelected || isHovered ? 2 : 0)}
                      fill={fill} stroke={stroke} strokeWidth={strokeWidth} style={{ transition: 'all 0.12s' }} />
                    {labelLines.map((line, li) => (
                      <text key={li} x={node.x} y={node.y + r + 14 + li * 12}
                        textAnchor="middle" fontSize="9.5" fill={isSelected ? '#c0adf0' : isHovered ? '#a08ecf' : '#928ea8'}
                        fontFamily="Inter, sans-serif" style={{ userSelect: 'none', pointerEvents: 'none' }}>
                        {line}
                      </text>
                    ))}
                    {paper && (
                      <text x={node.x} y={node.y + 3}
                        textAnchor="middle" fontSize="8" fill={isSelected ? '#c0adf0' : '#928ea8'}
                        fontFamily="Inter, sans-serif" style={{ userSelect: 'none', pointerEvents: 'none' }}>
                        {paper.year}
                      </text>
                    )}
                  </g>
                );
              }

              if (node.type === 'concept') {
                const w = 70; const h = 22;
                const labelLines = node.label.split('\n');
                return (
                  <g key={node.id} className="graph-node" style={{ cursor: 'pointer', opacity: isDimmed ? 0.2 : 1, transition: 'opacity 0.15s' }}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => setSelectedId(node.id)}
                  >
                    <rect x={node.x - w / 2} y={node.y - h / 2} width={w} height={h * labelLines.length}
                      rx="4" fill={fill} stroke={stroke} strokeWidth={1} />
                    {labelLines.map((line, li) => (
                      <text key={li} x={node.x} y={node.y + (li - (labelLines.length - 1) / 2) * h + 4}
                        textAnchor="middle" fontSize="8.5" fill={isSelected ? '#6b9e8c' : '#928ea8'}
                        fontFamily="Inter, sans-serif" style={{ userSelect: 'none', pointerEvents: 'none' }}>
                        {line}
                      </text>
                    ))}
                  </g>
                );
              }

              if (node.type === 'method') {
                const s = 22;
                const labelLines = node.label.split('\n');
                return (
                  <g key={node.id} className="graph-node" style={{ cursor: 'pointer', opacity: isDimmed ? 0.2 : 1, transition: 'opacity 0.15s' }}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => setSelectedId(node.id)}
                  >
                    <polygon points={`${node.x},${node.y - s} ${node.x + s},${node.y} ${node.x},${node.y + s} ${node.x - s},${node.y}`}
                      fill={fill} stroke={stroke} strokeWidth={1} />
                    {labelLines.map((line, li) => (
                      <text key={li} x={node.x} y={node.y + s + 12 + li * 11}
                        textAnchor="middle" fontSize="8.5" fill={isSelected ? '#c2975a' : '#928ea8'}
                        fontFamily="Inter, sans-serif" style={{ userSelect: 'none', pointerEvents: 'none' }}>
                        {line}
                      </text>
                    ))}
                  </g>
                );
              }
              return null;
            })}
          </g>
        </svg>

        {/* Graph controls overlay */}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <button onClick={resetView} className="text-[11px] px-2.5 py-1.5 rounded flex items-center gap-1.5 transition-colors"
            style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)', color: 'var(--color-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ink)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3h7M3 3v7M21 3h-7M21 3v7M3 21h7M3 21v-7M21 21h-7M21 21v-7" /></svg>
            Reset view
          </button>
          <div className="text-[10px] px-2 py-1.5 rounded" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
            ×{transform.scale.toFixed(2)}
          </div>
        </div>

        {/* Timeline strip */}
        <div className="absolute bottom-0 left-0 right-0 border-t flex items-center px-4 py-2 gap-4" style={{ height: 44, background: 'rgba(27,26,34,0.92)', borderColor: 'var(--color-edge)', backdropFilter: 'blur(8px)' }}>
          <span className="text-[10px] uppercase tracking-wider shrink-0" style={{ color: 'var(--color-muted)' }}>Timeline</span>
          <div className="flex-1 flex items-center gap-2">
            {YEARS.map(y => {
              const yearPapers = papers.filter(p => p.year === y);
              const inRange = y >= filterYearMin && y <= filterYearMax;
              return (
                <div key={y} className="flex flex-col items-center gap-0.5">
                  <div className="flex gap-0.5">
                    {yearPapers.map(p => (
                      <div key={p.id} className="w-2 h-2 rounded-full cursor-pointer transition-all"
                        style={{ background: inRange ? 'var(--color-lavender)' : 'var(--color-edge)' }}
                        onClick={() => { onSelectPaper(p.id); }}
                        title={p.title}
                      />
                    ))}
                    {yearPapers.length === 0 && <div className="w-2 h-2" />}
                  </div>
                  <span className="text-[9px]" style={{ color: inRange ? 'var(--color-sub)' : 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{y}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--color-muted)' }}>
            <span>scroll to zoom · drag to pan</span>
          </div>
        </div>

        {/* Legend */}
        <div className="absolute bottom-12 left-3 text-[10px] flex flex-col gap-1 p-2 rounded" style={{ background: 'rgba(35,34,47,0.8)', border: '1px solid var(--color-edge)' }}>
          {Object.entries(EDGE_STYLES).filter(([t]) => filterEdges.has(t as GraphEdge['type'])).map(([type, s]) => (
            <div key={type} className="flex items-center gap-2">
              <svg width="20" height="6">
                <line x1="0" y1="3" x2="20" y2="3" stroke={s.stroke} strokeWidth={s.width * 1.5} strokeDasharray={s.dasharray} opacity={s.opacity * 1.5} />
              </svg>
              <span style={{ color: 'var(--color-muted)' }}>{type}</span>
            </div>
          ))}
          <div className="pt-1 border-t" style={{ borderColor: 'var(--color-edge)' }}>
            <div className="flex items-center gap-2"><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="none" stroke="var(--color-lavender)" strokeWidth="1.2" /></svg><span style={{ color: 'var(--color-muted)' }}>paper</span></div>
            <div className="flex items-center gap-2"><svg width="20" height="12"><rect x="1" y="2" width="18" height="8" rx="2" fill="none" stroke="#6b9e8c" strokeWidth="1" /></svg><span style={{ color: 'var(--color-muted)' }}>concept</span></div>
            <div className="flex items-center gap-2"><svg width="12" height="12"><polygon points="6,0 12,6 6,12 0,6" fill="none" stroke="#c2975a" strokeWidth="1" /></svg><span style={{ color: 'var(--color-muted)' }}>method</span></div>
          </div>
        </div>
      </div>

      {/* Right panel: filters + detail */}
      <div className="w-[240px] shrink-0 flex flex-col border-l overflow-hidden" style={{ borderColor: 'var(--color-edge)', background: 'var(--color-surface)' }}>
        <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--color-edge)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-muted)' }}>Filters</div>

          {/* Search */}
          <div className="flex items-center gap-1.5 rounded px-2 py-1.5 mb-3" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-muted)' }}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <input type="text" placeholder="Search nodes…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="flex-1 bg-transparent text-[11.5px] border-0 outline-none"
              style={{ color: 'var(--color-ink)', caretColor: 'var(--color-lavender)' }} />
          </div>

          {/* Year range */}
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Year</div>
            <div className="flex gap-2 items-center text-[11px]" style={{ color: 'var(--color-sub)' }}>
              <input type="number" min={2015} max={filterYearMax} value={filterYearMin}
                onChange={e => setFilterYearMin(Number(e.target.value))}
                className="w-16 rounded px-1.5 py-1 text-center border-0 outline-none text-[11px]"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)', color: 'var(--color-sub)', fontFamily: 'var(--font-mono)' }} />
              <span style={{ color: 'var(--color-muted)' }}>–</span>
              <input type="number" min={filterYearMin} max={2024} value={filterYearMax}
                onChange={e => setFilterYearMax(Number(e.target.value))}
                className="w-16 rounded px-1.5 py-1 text-center border-0 outline-none text-[11px]"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)', color: 'var(--color-sub)', fontFamily: 'var(--font-mono)' }} />
            </div>
          </div>

          {/* Node types */}
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Node types</div>
            {['paper', 'concept', 'method'].map(t => (
              <label key={t} className="flex items-center gap-2 py-0.5 cursor-pointer text-[11.5px]" style={{ color: 'var(--color-sub)' }}>
                <input type="checkbox" checked={filterNodeTypes.has(t)} onChange={() => toggleNodeType(t)}
                  className="rounded" style={{ accentColor: 'var(--color-lavender)' }} />
                {t}
              </label>
            ))}
          </div>

          {/* Edge types */}
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Edge types</div>
            {(['cites', 'semantic', 'shared-concept', 'shared-method'] as GraphEdge['type'][]).map(t => (
              <label key={t} className="flex items-center gap-2 py-0.5 cursor-pointer text-[11.5px]" style={{ color: 'var(--color-sub)' }}>
                <input type="checkbox" checked={filterEdges.has(t)} onChange={() => toggleFilter(filterEdges, t, setFilterEdges)}
                  className="rounded" style={{ accentColor: EDGE_STYLES[t].stroke }} />
                <span className="w-8 inline-block">
                  <svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke={EDGE_STYLES[t].stroke} strokeWidth="1.5" strokeDasharray={EDGE_STYLES[t].dasharray} /></svg>
                </span>
                {t}
              </label>
            ))}
          </div>

          {/* Toggles */}
          <div className="space-y-1.5">
            <label className="flex items-center justify-between cursor-pointer text-[11.5px]" style={{ color: 'var(--color-sub)' }}>
              <span>Cluster overlay</span>
              <div className={`w-8 h-4 rounded-full relative transition-colors ${showClusters ? 'bg-lavender' : ''}`}
                style={{ background: showClusters ? 'var(--color-lavender)' : 'var(--color-edge)' }}
                onClick={() => setShowClusters(!showClusters)}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-transform bg-ink`}
                  style={{ background: 'var(--color-ink)', transform: showClusters ? 'translateX(16px)' : 'translateX(2px)' }} />
              </div>
            </label>
            <label className="flex items-center justify-between cursor-pointer text-[11.5px]" style={{ color: 'var(--color-sub)' }}>
              <span>Open Access only</span>
              <div className="w-8 h-4 rounded-full relative transition-colors cursor-pointer"
                style={{ background: filterOA ? 'var(--color-teal)' : 'var(--color-edge)' }}
                onClick={() => setFilterOA(!filterOA)}>
                <div className="absolute top-0.5 w-3 h-3 rounded-full transition-transform"
                  style={{ background: 'var(--color-ink)', transform: filterOA ? 'translateX(16px)' : 'translateX(2px)' }} />
              </div>
            </label>
          </div>
        </div>

        {/* Selected node detail */}
        <div className="flex-1 overflow-y-auto">
          {selectedNode ? (
            <div className="p-3 animate-fade-in">
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
                Selected {selectedNode.type}
              </div>
              {selectedPaper ? (
                <>
                  <div className="text-[12.5px] font-medium leading-snug mb-2" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>
                    {selectedPaper.title}
                  </div>
                  <div className="text-[11px] mb-1" style={{ color: 'var(--color-muted)' }}>
                    {selectedPaper.authors[0]}{selectedPaper.authors.length > 1 ? ` +${selectedPaper.authors.length - 1}` : ''} · {selectedPaper.year}
                  </div>
                  <div className="text-[11px] mb-3" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                    {selectedPaper.citations.toLocaleString()} citations
                  </div>
                  <p className="text-[12px] leading-relaxed mb-3 line-clamp-4" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-sub)' }}>
                    {selectedPaper.abstract}
                  </p>
                  <button
                    onClick={() => onSelectPaper(selectedPaper.id)}
                    className="w-full text-center text-[11.5px] py-1.5 rounded transition-colors"
                    style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-lavender)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}>
                    Open in Library →
                  </button>
                </>
              ) : (
                <>
                  <div className="text-[13px] font-medium mb-2" style={{ color: 'var(--color-ink)' }}>{selectedNode.label.replace('\n', ' ')}</div>
                  <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    Papers using this {selectedNode.type}:
                  </div>
                  {graphEdges.filter(e => e.source === selectedId || e.target === selectedId).map(e => {
                    const otherId = e.source === selectedId ? e.target : e.source;
                    const other = nodeMap[otherId];
                    if (!other?.paperId) return null;
                    const p = papers.find(p => p.id === other.paperId);
                    if (!p) return null;
                    return (
                      <div key={otherId} className="text-[11.5px] py-1 cursor-pointer" style={{ color: 'var(--color-sub)' }}
                        onClick={() => onSelectPaper(p.id)}>
                        · {p.title}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          ) : (
            <div className="p-3 text-[11.5px]" style={{ color: 'var(--color-muted)' }}>
              Click a node to see details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
