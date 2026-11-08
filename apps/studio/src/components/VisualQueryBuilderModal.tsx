import React, { useState, useEffect, useRef } from 'react';
import { SchemaHierarchy, TableDetail, ColumnMeta } from '../types/omnidb';
import { OmniDBTransport } from '../adapters/transport';
import { useToastStore } from '../stores/toast.store';

interface TableNode {
  id: string; // e.g. "public.users" or "users"
  schema?: string;
  name: string;
  x: number;
  y: number;
  columns: ColumnMeta[];
  selectedColumns: string[]; // column names checked for SELECT
  isCollapsed?: boolean;
  isLoading?: boolean;
}

interface JoinRelation {
  sourceTableId: string;
  sourceColumn: string;
  targetTableId: string;
  targetColumn: string;
  joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
}

interface VisualQueryBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  schemaTree: SchemaHierarchy | null;
  connectionId: string | null;
  transport: OmniDBTransport;
  onApplyQuery: (sql: string) => void;
}

export const VisualQueryBuilderModal: React.FC<VisualQueryBuilderModalProps> = ({
  isOpen,
  onClose,
  schemaTree,
  connectionId,
  transport,
  onApplyQuery,
}) => {
  const [nodes, setNodes] = useState<TableNode[]>([]);
  const [joins, setJoins] = useState<JoinRelation[]>([]);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [activeTabTableFilter, setActiveTabTableFilter] = useState('');
  const [collapsedSchemas, setCollapsedSchemas] = useState<Record<string, boolean>>({});
  const canvasRef = useRef<HTMLDivElement>(null);

  const toggleSchemaCollapse = (schema: string) => {
    setCollapsedSchemas((prev) => ({
      ...prev,
      [schema]: !prev[schema],
    }));
  };

  const toggleTableCollapse = (nodeId: string) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId ? { ...n, isCollapsed: !n.isCollapsed } : n
      )
    );
  };

  // Collect available tables from schemaTree
  const allAvailableTables: { schema: string; name: string; isView: boolean }[] = [];
  if (schemaTree?.schemas) {
    for (const s of schemaTree.schemas) {
      for (const t of s.tables) {
        allAvailableTables.push({ schema: s.name, name: t.name, isView: t.is_view });
      }
    }
  }

  // Load columns when adding a table node
  const addTableNode = async (schema: string, tableName: string) => {
    const tableId = schema ? `${schema}.${tableName}` : tableName;
    if (nodes.some((n) => n.id === tableId)) {
      useToastStore.getState().showInfo('Table Already Added', `${tableId} is already on the canvas.`);
      return;
    }

    // Default positioning in grid or staggered
    const count = nodes.length;
    const initialX = 50 + (count % 3) * 280;
    const initialY = 40 + Math.floor(count / 3) * 240;

    const newNode: TableNode = {
      id: tableId,
      schema,
      name: tableName,
      x: initialX,
      y: initialY,
      columns: [],
      selectedColumns: [],
      isLoading: true,
    };

    setNodes((prev) => [...prev, newNode]);

    if (connectionId) {
      try {
        const detail = await transport.introspectTable(connectionId, schema, tableName);
        setNodes((prev) =>
          prev.map((n) =>
            n.id === tableId
              ? {
                  ...n,
                  columns: detail.columns || [],
                  selectedColumns: (detail.columns || []).map((c) => c.name), // default all checked
                  isLoading: false,
                }
              : n
          )
        );

        // Auto-detect foreign keys and common naming join patterns with already existing tables
        setTimeout(() => autoDetectJoins(tableId, detail.columns || []), 50);
      } catch (err: any) {
        setNodes((prev) =>
          prev.map((n) => (n.id === tableId ? { ...n, isLoading: false } : n))
        );
      }
    }
  };

  const removeTableNode = (tableId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== tableId));
    setJoins((prev) =>
      prev.filter((j) => j.sourceTableId !== tableId && j.targetTableId !== tableId)
    );
  };

  // Automatic join detection (e.g. user_id -> users.id, or table_id -> table.id)
  const autoDetectJoins = (newTableId: string, newCols: ColumnMeta[]) => {
    setNodes((currentNodes) => {
      const thisNode = currentNodes.find((n) => n.id === newTableId);
      if (!thisNode) return currentNodes;

      setJoins((existingJoins) => {
        const detected = [...existingJoins];

        for (const other of currentNodes) {
          if (other.id === newTableId) continue;

          // Check if new table has column referencing other table (e.g. `order.user_id = user.id`)
          for (const c of newCols) {
            const colLower = c.name.toLowerCase();
            const otherNameLower = other.name.toLowerCase();

            // Check pattern other_id
            if (
              colLower === `${otherNameLower}_id` ||
              colLower === `${otherNameLower}id` ||
              (other.name.endsWith('s') && colLower === `${other.name.slice(0, -1)}_id`)
            ) {
              const targetPk = other.columns.find((oc) => oc.is_primary_key)?.name || 'id';
              if (
                !detected.some(
                  (j) =>
                    (j.sourceTableId === newTableId && j.targetTableId === other.id) ||
                    (j.sourceTableId === other.id && j.targetTableId === newTableId)
                )
              ) {
                detected.push({
                  sourceTableId: other.id,
                  sourceColumn: targetPk,
                  targetTableId: newTableId,
                  targetColumn: c.name,
                  joinType: 'INNER',
                });
              }
            }
          }

          // Check inverse: other table has column referencing new table
          for (const oc of other.columns) {
            const ocLower = oc.name.toLowerCase();
            const thisNameLower = thisNode.name.toLowerCase();

            if (
              ocLower === `${thisNameLower}_id` ||
              ocLower === `${thisNameLower}id` ||
              (thisNode.name.endsWith('s') && ocLower === `${thisNode.name.slice(0, -1)}_id`)
            ) {
              const thisPk = newCols.find((tc) => tc.is_primary_key)?.name || 'id';
              if (
                !detected.some(
                  (j) =>
                    (j.sourceTableId === other.id && j.targetTableId === newTableId) ||
                    (j.sourceTableId === newTableId && j.targetTableId === other.id)
                )
              ) {
                detected.push({
                  sourceTableId: newTableId,
                  sourceColumn: thisPk,
                  targetTableId: other.id,
                  targetColumn: oc.name,
                  joinType: 'INNER',
                });
              }
            }
          }
        }

        return detected;
      });

      return currentNodes;
    });
  };

  // Reorder/Auto-Layout: Relationship-Aware Graph & Topological Layout
  const reorderTables = () => {
    if (nodes.length === 0) return;

    // 1. Build adjacency maps for the relationship graph
    const undirectedAdj = new Map<string, string[]>();
    const directedAdj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    nodes.forEach((n) => {
      undirectedAdj.set(n.id, []);
      directedAdj.set(n.id, []);
      inDegree.set(n.id, 0);
    });

    joins.forEach((j) => {
      if (undirectedAdj.has(j.sourceTableId) && undirectedAdj.has(j.targetTableId)) {
        undirectedAdj.get(j.sourceTableId)!.push(j.targetTableId);
        undirectedAdj.get(j.targetTableId)!.push(j.sourceTableId);
        directedAdj.get(j.sourceTableId)!.push(j.targetTableId);
        inDegree.set(j.targetTableId, (inDegree.get(j.targetTableId) || 0) + 1);
      }
    });

    // 2. Identify connected components (subgraphs of related tables)
    const visited = new Set<string>();
    const components: string[][] = [];

    nodes.forEach((node) => {
      if (!visited.has(node.id)) {
        const comp: string[] = [];
        const queue: string[] = [node.id];
        visited.add(node.id);
        while (queue.length > 0) {
          const curr = queue.shift()!;
          comp.push(curr);
          (undirectedAdj.get(curr) || []).forEach((neighbor) => {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          });
        }
        components.push(comp);
      }
    });

    // Sort components: Put interconnected clusters first, isolated tables last
    components.sort((a, b) => b.length - a.length);

    const NODE_WIDTH = 280;
    const GAP_X = 100;
    const GAP_Y = 50;
    const START_X = 60;
    let currentStartY = 50;
    const nodePositionMap = new Map<string, { x: number; y: number }>();

    components.forEach((compIds) => {
      if (compIds.length === 1) {
        // Standalone isolated table
        nodePositionMap.set(compIds[0], { x: START_X, y: currentStartY });
        currentStartY += 260 + GAP_Y;
        return;
      }

      // 3. Topological layer assignment (Sugiyama algorithm layer ranking)
      let roots = compIds.filter((id) => (inDegree.get(id) || 0) === 0);
      if (roots.length === 0) {
        roots = [...compIds]
          .sort((a, b) => (undirectedAdj.get(b)?.length || 0) - (undirectedAdj.get(a)?.length || 0))
          .slice(0, 1);
      }

      const rankMap = new Map<string, number>();
      const rankQueue: string[] = [];
      roots.forEach((r) => {
        rankMap.set(r, 0);
        rankQueue.push(r);
      });

      const localVisited = new Set<string>(roots);
      while (rankQueue.length > 0) {
        const curr = rankQueue.shift()!;
        const currRank = rankMap.get(curr) || 0;

        (directedAdj.get(curr) || []).forEach((next) => {
          const nextRank = currRank + 1;
          if (!rankMap.has(next) || rankMap.get(next)! < nextRank) {
            rankMap.set(next, nextRank);
          }
          if (!localVisited.has(next)) {
            localVisited.add(next);
            rankQueue.push(next);
          }
        });

        (undirectedAdj.get(curr) || []).forEach((next) => {
          if (!localVisited.has(next)) {
            localVisited.add(next);
            const nextRank = currRank + 1;
            rankMap.set(next, nextRank);
            rankQueue.push(next);
          }
        });
      }

      compIds.forEach((id) => {
        if (!rankMap.has(id)) rankMap.set(id, 0);
      });

      // 4. Group into vertical columns by layer rank
      const layers = new Map<number, string[]>();
      compIds.forEach((id) => {
        const r = rankMap.get(id) || 0;
        if (!layers.has(r)) layers.set(r, []);
        layers.get(r)!.push(id);
      });

      const sortedRanks = [...layers.keys()].sort((a, b) => a - b);
      let maxCompHeight = 0;

      sortedRanks.forEach((rank, colIdx) => {
        const colNodes = layers.get(rank) || [];
        const x = START_X + colIdx * (NODE_WIDTH + GAP_X);

        colNodes.forEach((nodeId, rowIdx) => {
          const y = currentStartY + rowIdx * (260 + GAP_Y);
          nodePositionMap.set(nodeId, { x, y });
          const height = (rowIdx + 1) * (260 + GAP_Y);
          if (height > maxCompHeight) maxCompHeight = height;
        });
      });

      currentStartY += maxCompHeight + 40;
    });

    const updated = nodes.map((n) => {
      const pos = nodePositionMap.get(n.id);
      return pos ? { ...n, x: pos.x, y: pos.y } : n;
    });

    setNodes(updated);
    useToastStore
      .getState()
      .showSuccess('Tables Reordered', 'Organized tables topologically based on active foreign keys and join relations.');
  };

  // Dragging mechanics for moving tables around the canvas
  const handleMouseDown = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || !canvasRef.current) return;

    const canvasRect = canvasRef.current.getBoundingClientRect();
    setDraggingNodeId(nodeId);
    setDragOffset({
      x: e.clientX - canvasRect.left - node.x,
      y: e.clientY - canvasRect.top - node.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!draggingNodeId || !canvasRef.current) return;
    const canvasRect = canvasRef.current.getBoundingClientRect();

    const newX = Math.max(10, Math.min(3000, e.clientX - canvasRect.left - dragOffset.x));
    const newY = Math.max(10, Math.min(3000, e.clientY - canvasRect.top - dragOffset.y));

    setNodes((prev) =>
      prev.map((n) => (n.id === draggingNodeId ? { ...n, x: newX, y: newY } : n))
    );
  };

  const handleMouseUp = () => {
    setDraggingNodeId(null);
  };

  const toggleColumnSelection = (tableId: string, colName: string) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== tableId) return n;
        const selected = n.selectedColumns.includes(colName)
          ? n.selectedColumns.filter((c) => c !== colName)
          : [...n.selectedColumns, colName];
        return { ...n, selectedColumns: selected };
      })
    );
  };

  // Compile full SQL Query from visually composed tables and joins
  const buildQuerySql = (): string => {
    if (nodes.length === 0) return '-- Add tables to the canvas to generate a SQL query';

    // 1. SELECT clause
    const selectProjections: string[] = [];
    nodes.forEach((n, idx) => {
      const alias = `t${idx + 1}`;
      if (n.selectedColumns.length === 0) {
        // none
      } else if (n.selectedColumns.length === n.columns.length && n.columns.length > 0) {
        selectProjections.push(`${alias}.*`);
      } else {
        n.selectedColumns.forEach((c) => {
          selectProjections.push(`${alias}."${c}"`);
        });
      }
    });

    const projectionStr = selectProjections.length > 0 ? selectProjections.join(',\n  ') : '*';

    // 2. FROM & JOIN clauses
    const firstNode = nodes[0];
    const firstTableRef = firstNode.schema ? `"${firstNode.schema}"."${firstNode.name}"` : `"${firstNode.name}"`;
    let fromClause = `FROM ${firstTableRef} AS t1`;

    // Process additional tables
    for (let i = 1; i < nodes.length; i++) {
      const currNode = nodes[i];
      const currAlias = `t${i + 1}`;
      const currRef = currNode.schema ? `"${currNode.schema}"."${currNode.name}"` : `"${currNode.name}"`;

      // Find join linking this table
      const joinRel = joins.find(
        (j) =>
          (j.sourceTableId === currNode.id || j.targetTableId === currNode.id) &&
          nodes.slice(0, i).some((prev) => prev.id === j.sourceTableId || prev.id === j.targetTableId)
      );

      if (joinRel) {
        const isTarget = joinRel.targetTableId === currNode.id;
        const otherTableId = isTarget ? joinRel.sourceTableId : joinRel.targetTableId;
        const otherIdx = nodes.findIndex((n) => n.id === otherTableId);
        const otherAlias = `t${otherIdx + 1}`;

        const leftCol = isTarget ? `${otherAlias}."${joinRel.sourceColumn}"` : `${currAlias}."${joinRel.sourceColumn}"`;
        const rightCol = isTarget ? `${currAlias}."${joinRel.targetColumn}"` : `${otherAlias}."${joinRel.targetColumn}"`;

        fromClause += `\n${joinRel.joinType} JOIN ${currRef} AS ${currAlias}\n  ON ${leftCol} = ${rightCol}`;
      } else {
        // Fallback cross join
        fromClause += `\nCROSS JOIN ${currRef} AS ${currAlias}`;
      }
    }

    return `SELECT\n  ${projectionStr}\n${fromClause}\nLIMIT 100;`;
  };

  if (!isOpen) return null;

  const generatedSql = buildQuerySql();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm select-none">
      <div className="flex h-[92vh] w-[95vw] flex-col rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl overflow-hidden font-sans">
        {/* Modal Header */}
        <header className="flex h-12 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-5">
          <div className="flex items-center space-x-3">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-amber-500/20 text-amber-400 font-bold text-sm shadow-sm">
              ◫
            </span>
            <div>
              <h2 className="text-sm font-bold text-neutral-100 flex items-center space-x-2">
                <span>Visual Query Builder & Canvas</span>
                <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">
                  Interactive ERD
                </span>
              </h2>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={reorderTables}
              className="flex items-center space-x-1.5 rounded border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 px-3 py-1 text-xs font-semibold text-neutral-200 transition-all shadow-sm"
              title="Organize and reorder tables neatly into a grid layout"
            >
              <span>▦</span>
              <span>Reorder & Align Tables</span>
            </button>

            <button
              onClick={() => {
                onApplyQuery(generatedSql);
                onClose();
              }}
              className="flex items-center space-x-1.5 rounded bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-xs font-semibold text-white shadow-sm transition-colors"
            >
              <span>⚡</span>
              <span>Load SQL into Editor</span>
            </button>

            <button
              onClick={onClose}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
            >
              ✕
            </button>
          </div>
        </header>

        {/* Builder Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Table Picker Sidebar */}
          <aside className="w-64 border-r border-neutral-800 bg-neutral-900/60 p-3 flex flex-col overflow-hidden">
            <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-2">
              Add Tables to Canvas ({allAvailableTables.length})
            </span>

            <input
              type="text"
              placeholder="Search table..."
              value={activeTabTableFilter}
              onChange={(e) => setActiveTabTableFilter(e.target.value)}
              className="w-full rounded border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-xs text-neutral-200 outline-none mb-2 focus:border-blue-500"
            />

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {schemaTree?.schemas?.map((schema) => {
                const filteredTables = schema.tables.filter((t) =>
                  t.name.toLowerCase().includes(activeTabTableFilter.toLowerCase())
                );
                if (filteredTables.length === 0) return null;

                const isCollapsed = !!collapsedSchemas[schema.name];

                return (
                  <div key={schema.name} className="rounded border border-neutral-800 bg-neutral-950/60 overflow-hidden">
                    <button
                      onClick={() => toggleSchemaCollapse(schema.name)}
                      className="flex w-full items-center justify-between px-2.5 py-1.5 text-xs font-semibold text-neutral-300 hover:bg-neutral-800/80 transition-colors"
                    >
                      <div className="flex items-center space-x-1.5 truncate">
                        <span className="text-[10px] text-neutral-500">{isCollapsed ? '▶' : '▼'}</span>
                        <span className="truncate">{schema.name}</span>
                        <span className="text-[10px] text-neutral-500">({filteredTables.length})</span>
                      </div>
                      <span className="text-[9px] text-neutral-500 uppercase">{isCollapsed ? 'Expand' : 'Collapse'}</span>
                    </button>

                    {!isCollapsed && (
                      <div className="space-y-0.5 p-1 border-t border-neutral-800/60 bg-neutral-900/30">
                        {filteredTables.map((t) => {
                          const tableId = schema.name ? `${schema.name}.${t.name}` : t.name;
                          const isAdded = nodes.some((n) => n.id === tableId);

                          return (
                            <button
                              key={tableId}
                              onClick={() => addTableNode(schema.name, t.name)}
                              className={`flex w-full items-center justify-between rounded px-2 py-1 text-xs text-left transition-colors ${
                                isAdded
                                  ? 'bg-blue-950/50 text-blue-300 border border-blue-800/60 font-medium'
                                  : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'
                              }`}
                            >
                              <div className="flex items-center space-x-2 truncate">
                                <span className="text-blue-400 text-[11px]">▦</span>
                                <span className="truncate">{t.name}</span>
                              </div>
                              <span className="text-[10px] text-neutral-500">{isAdded ? '✓' : '+'}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Interactive Canvas */}
          <main
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            className="flex-1 relative overflow-auto bg-neutral-950 p-4 cursor-default"
            style={{
              backgroundImage: 'radial-gradient(#262626 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          >
            {/* SVG Connecting Bezier Lines between Joined Tables */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" style={{ minWidth: 2000, minHeight: 2000 }}>
              {joins.map((j, idx) => {
                const src = nodes.find((n) => n.id === j.sourceTableId);
                const tgt = nodes.find((n) => n.id === j.targetTableId);
                if (!src || !tgt) return null;

                const x1 = src.x + 240;
                const y1 = src.y + 60;
                const x2 = tgt.x;
                const y2 = tgt.y + 60;
                const dx = Math.abs(x2 - x1) * 0.5;

                return (
                  <g key={idx}>
                    <path
                      d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="2.5"
                      strokeDasharray="4 2"
                      className="animate-pulse"
                    />
                    <circle cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} r="10" fill="#1e293b" stroke="#3b82f6" />
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 + 3}
                      fill="#93c5fd"
                      fontSize="9"
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {j.joinType[0]}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Draggable Table Cards on Canvas */}
            {nodes.length === 0 ? (
              <div className="flex h-full items-center justify-center text-neutral-500 font-mono text-xs">
                Select tables from the left sidebar to place them on the visual grid.
              </div>
            ) : (
              nodes.map((node, nIdx) => (
                <div
                  key={node.id}
                  style={{ left: `${node.x}px`, top: `${node.y}px` }}
                  className="absolute z-20 w-64 rounded-lg border border-neutral-700 bg-neutral-900/95 shadow-xl backdrop-blur-md overflow-hidden text-xs"
                >
                  {/* Card Draggable Header with Schema Badge and Collapse Toggle */}
                  <div
                    onMouseDown={(e) => handleMouseDown(node.id, e)}
                    className="flex items-center justify-between bg-neutral-800 px-3 py-2 cursor-grab active:cursor-grabbing border-b border-neutral-700"
                  >
                    <div className="flex items-center space-x-1.5 truncate">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTableCollapse(node.id);
                        }}
                        className="text-[10px] text-neutral-400 hover:text-white"
                        title={node.isCollapsed ? 'Expand columns' : 'Collapse columns'}
                      >
                        {node.isCollapsed ? '▶' : '▼'}
                      </button>
                      <span className="rounded bg-blue-600/30 text-blue-400 px-1 py-0.2 text-[9px] font-bold">
                        t{nIdx + 1}
                      </span>
                      <span className="font-semibold text-neutral-100 truncate">
                        {node.schema ? `${node.schema}.${node.name}` : node.name}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1">
                      <span className="text-[10px] text-neutral-400 font-mono">
                        ({node.columns.length})
                      </span>
                      <button
                        onClick={() => removeTableNode(node.id)}
                        className="text-neutral-500 hover:text-red-400 font-bold px-1"
                        title="Remove from visual canvas"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Columns List (Collapsible) */}
                  {!node.isCollapsed && (
                    <div className="max-h-56 overflow-y-auto p-1.5 space-y-0.5">
                      {node.isLoading ? (
                        <div className="p-2 text-neutral-500 italic text-center">Loading columns...</div>
                      ) : node.columns.length === 0 ? (
                        <div className="p-2 text-neutral-500 italic text-center">No columns inspected</div>
                      ) : (
                        node.columns.map((c) => {
                          const isChecked = node.selectedColumns.includes(c.name);
                          return (
                            <div
                              key={c.name}
                              onClick={() => toggleColumnSelection(node.id, c.name)}
                              className="flex items-center justify-between rounded px-2 py-1 hover:bg-neutral-800 cursor-pointer select-none"
                            >
                              <div className="flex items-center space-x-2 truncate">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {}}
                                  className="h-3 w-3 rounded border-neutral-700 text-blue-600 focus:ring-0"
                                />
                                <span className={`truncate ${c.is_primary_key ? 'font-bold text-amber-300' : 'text-neutral-300'}`}>
                                  {c.name}
                                </span>
                              </div>
                              <span className="text-[10px] text-neutral-500 font-mono">
                                {c.original_type}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </main>
        </div>

        {/* Live SQL Preview Footer */}
        <footer className="h-32 border-t border-neutral-800 bg-neutral-900 p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
            <span>Live Generated SQL</span>
            <span className="text-emerald-400 font-mono text-[10px]">
              {nodes.length} Table(s) | {joins.length} Auto-Join(s)
            </span>
          </div>

          <pre className="flex-1 overflow-x-auto rounded bg-neutral-950 p-2 font-mono text-[11px] text-neutral-200 border border-neutral-800">
            {generatedSql}
          </pre>
        </footer>
      </div>
    </div>
  );
};
