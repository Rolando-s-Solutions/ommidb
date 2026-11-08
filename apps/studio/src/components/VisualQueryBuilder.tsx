import React, { useState, useRef } from 'react';
import { SchemaHierarchy, ColumnMeta } from '../types/omnidb';
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

interface VisualQueryBuilderProps {
  schemaTree: SchemaHierarchy | null;
  connectionId: string | null;
  transport: OmniDBTransport;
  onApplyQuery: (sql: string) => void;
  onGeneratedSqlChange?: (sql: string) => void;
}

export const VisualQueryBuilder: React.FC<VisualQueryBuilderProps> = ({
  schemaTree,
  connectionId,
  transport,
  onApplyQuery,
  onGeneratedSqlChange,
}) => {
  const [nodes, setNodes] = useState<TableNode[]>([]);
  const [joins, setJoins] = useState<JoinRelation[]>([]);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [activeTabTableFilter, setActiveTabTableFilter] = useState('');
  const [collapsedSchemas, setCollapsedSchemas] = useState<Record<string, boolean>>({});
  const [sqlPanelHeight, setSqlPanelHeight] = useState<number>(140);
  const [isResizingSql, setIsResizingSql] = useState<boolean>(false);
  const [isCustomSql, setIsCustomSql] = useState<boolean>(false);
  const [customSqlText, setCustomSqlText] = useState<string>('');
  const canvasRef = useRef<HTMLDivElement>(null);

  // Listen for context-menu "Add to Visual Canvas" events from the left Database Explorer
  React.useEffect(() => {
    const handleAddEvent = (e: any) => {
      if (e.detail?.table) {
        addTableNode(e.detail.schema || 'public', e.detail.table);
      }
    };
    window.addEventListener('omnidb:add_table_to_canvas', handleAddEvent);
    return () => window.removeEventListener('omnidb:add_table_to_canvas', handleAddEvent);
  }, [nodes, connectionId]);

  // Resize handler for resizing SQL preview panel height
  const handleSqlResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSql(true);
    const startY = e.clientY;
    const startHeight = sqlPanelHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY; // drag up increases height
      const newHeight = Math.max(70, Math.min(600, startHeight + deltaY));
      setSqlPanelHeight(newHeight);
    };

    const onMouseUp = () => {
      setIsResizingSql(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

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

  // Load columns when adding a table node
  const addTableNode = async (schema: string, tableName: string, customPos?: { x: number; y: number }) => {
    const tableId = schema ? `${schema}.${tableName}` : tableName;
    if (nodes.some((n) => n.id === tableId)) {
      useToastStore.getState().showInfo('Table Already Added', `${tableId} is already on the canvas.`);
      return;
    }

    // Default positioning in grid or dragged location
    const count = nodes.length;
    const initialX = customPos ? customPos.x : 50 + (count % 3) * 280;
    const initialY = customPos ? customPos.y : 40 + Math.floor(count / 3) * 240;

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
                  selectedColumns: (detail.columns || []).map((c) => c.name),
                  isLoading: false,
                }
              : n
          )
        );

        // Auto-detect foreign keys and common naming join patterns
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

  // Automatic join detection
  const autoDetectJoins = (newTableId: string, newCols: ColumnMeta[]) => {
    setNodes((currentNodes) => {
      const thisNode = currentNodes.find((n) => n.id === newTableId);
      if (!thisNode) return currentNodes;

      setJoins((existingJoins) => {
        const detected = [...existingJoins];

        for (const other of currentNodes) {
          if (other.id === newTableId) continue;

          for (const c of newCols) {
            const colLower = c.name.toLowerCase();
            const otherNameLower = other.name.toLowerCase();

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

  // Parse a pasted SQL query to extract tables, aliases, and explicit joins to load onto the canvas
  const parseAndLoadSql = async (sql: string) => {
    if (!sql.trim()) return;

    // Look for FROM and JOIN clauses
    // Supports FROM "schema"."table" AS alias, FROM table alias, JOIN table ON ...
    const fromAndJoinRegex = /(?:FROM|(?:(?:LEFT|RIGHT|FULL|INNER|CROSS)\s+)?JOIN)\s+(?:["`]?([\w]+)["`]?\.)?["`]?([\w]+)["`]?\s*(?:AS\s+)?(["`]?[\w]+["`]?)?/gi;
    const foundTables: { schema?: string; name: string; alias?: string }[] = [];
    let match;

    while ((match = fromAndJoinRegex.exec(sql)) !== null) {
      const p1 = match[1]; // schema if present
      const p2 = match[2]; // table name
      const p3 = match[3]; // alias if present

      const schema = p1 ? p1.replace(/["`]/g, '') : undefined;
      const tableName = p2.replace(/["`]/g, '');
      const alias = p3 ? p3.replace(/["`]/g, '') : tableName;

      // Filter out SQL keywords that might be accidentally caught
      if (['select', 'where', 'order', 'group', 'limit', 'on'].includes(tableName.toLowerCase())) {
        continue;
      }

      if (!foundTables.some((t) => t.name.toLowerCase() === tableName.toLowerCase() && t.schema === schema)) {
        foundTables.push({ schema, name: tableName, alias });
      }
    }

    if (foundTables.length === 0) {
      useToastStore.getState().showWarning('No Tables Detected', 'Could not detect table names in the provided SQL.');
      return;
    }

    // Extract ON conditions: ON (alias1.col1 = alias2.col2)
    const onJoinRegex = /ON\s+["`]?([\w]+)["`]?\.["`]?([\w]+)["`]?\s*=\s*["`]?([\w]+)["`]?\.["`]?([\w]+)["`]?/gi;
    const parsedJoins: {
      leftRef: string;
      leftCol: string;
      rightRef: string;
      rightCol: string;
    }[] = [];
    let onMatch;

    while ((onMatch = onJoinRegex.exec(sql)) !== null) {
      parsedJoins.push({
        leftRef: onMatch[1],
        leftCol: onMatch[2],
        rightRef: onMatch[3],
        rightCol: onMatch[4],
      });
    }

    // Prepare table nodes on canvas
    const SPACING_X = 300;
    const SPACING_Y = 240;
    const COLS = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(foundTables.length * 1.5))));

    const newNodes: TableNode[] = [];
    for (let i = 0; i < foundTables.length; i++) {
      const t = foundTables[i];
      // Resolve schema from schemaTree if not explicitly in SQL
      let matchedSchema = t.schema;
      if (!matchedSchema && schemaTree?.schemas) {
        for (const s of schemaTree.schemas) {
          if (s.tables.some((st) => st.name.toLowerCase() === t.name.toLowerCase())) {
            matchedSchema = s.name;
            break;
          }
        }
      }

      const tableId = matchedSchema ? `${matchedSchema}.${t.name}` : t.name;
      const col = i % COLS;
      const row = Math.floor(i / COLS);

      newNodes.push({
        id: tableId,
        schema: matchedSchema,
        name: t.name,
        x: 40 + col * SPACING_X,
        y: 40 + row * SPACING_Y,
        columns: [],
        selectedColumns: [],
        isLoading: true,
      });
    }

    setNodes(newNodes);

    // Introspect columns for all loaded tables in parallel
    if (connectionId) {
      const introspectPromises = newNodes.map(async (n) => {
        try {
          const detail = await transport.introspectTable(connectionId, n.schema, n.name);
          return {
            id: n.id,
            columns: detail.columns || [],
          };
        } catch (e) {
          return { id: n.id, columns: [] };
        }
      });

      const results = await Promise.all(introspectPromises);
      setNodes((prev) =>
        prev.map((n) => {
          const res = results.find((r) => r.id === n.id);
          return res
            ? {
                ...n,
                columns: res.columns,
                selectedColumns: res.columns.map((c) => c.name),
                isLoading: false,
              }
            : { ...n, isLoading: false };
        })
      );
    }

    // Map parsed join conditions to nodes
    const builtJoins: JoinRelation[] = [];
    for (const pj of parsedJoins) {
      // Find source and target table by matching alias or table name
      const srcTable = foundTables.find(
        (t) => t.alias?.toLowerCase() === pj.leftRef.toLowerCase() || t.name.toLowerCase() === pj.leftRef.toLowerCase()
      );
      const tgtTable = foundTables.find(
        (t) => t.alias?.toLowerCase() === pj.rightRef.toLowerCase() || t.name.toLowerCase() === pj.rightRef.toLowerCase()
      );

      if (srcTable && tgtTable) {
        const srcNodeId = srcTable.schema ? `${srcTable.schema}.${srcTable.name}` : srcTable.name;
        const tgtNodeId = tgtTable.schema ? `${tgtTable.schema}.${tgtTable.name}` : tgtTable.name;

        if (srcNodeId !== tgtNodeId) {
          builtJoins.push({
            sourceTableId: srcNodeId,
            sourceColumn: pj.leftCol,
            targetTableId: tgtNodeId,
            targetColumn: pj.rightCol,
            joinType: 'INNER',
          });
        }
      }
    }

    setJoins(builtJoins);
    setIsCustomSql(false);
    useToastStore.getState().showSuccess(
      'SQL Loaded to Visual Canvas',
      `Parsed and visualized ${newNodes.length} table(s) with ${builtJoins.length} join relation(s).`
    );
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
      // Pick natural root tables (e.g. parent tables with 0 incoming foreign keys)
      let roots = compIds.filter((id) => (inDegree.get(id) || 0) === 0);
      if (roots.length === 0) {
        // In cycles or mutual joins, pick the table with the highest connectivity
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

        // Traverse directed edges (parent -> child)
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

        // Traverse remaining undirected edges in this component
        (undirectedAdj.get(curr) || []).forEach((next) => {
          if (!localVisited.has(next)) {
            localVisited.add(next);
            const nextRank = currRank + 1;
            rankMap.set(next, nextRank);
            rankQueue.push(next);
          }
        });
      }

      // Ensure every node in this component has an assigned layer
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

  // Dragging mechanics
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

  // Drag and drop tables directly from left Explorer onto Canvas
  const [isDragOverCanvas, setIsDragOverCanvas] = useState(false);

  const handleCanvasDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOverCanvas) {
      setIsDragOverCanvas(true);
    }
  };

  const handleCanvasDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const currentTarget = e.currentTarget as HTMLElement;
    const relatedTarget = e.relatedTarget as Node | null;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setIsDragOverCanvas(false);
    }
  };

  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverCanvas(false);

    let schema: string | undefined;
    let table: string | undefined;

    // 1. Try sessionStorage or window global state first (most reliable in Tauri/WebKit)
    const active = (window as any).__draggedTable;
    if (active && active.table) {
      schema = active.schema;
      table = active.table;
    } else {
      try {
        const stored = sessionStorage.getItem('omnidb_dragged_table');
        if (stored) {
          const parsed = JSON.parse(stored);
          schema = parsed.schema;
          table = parsed.table;
        }
      } catch (err) {
        // ignore
      }
    }

    // 2. Fall back to dataTransfer
    if (!table) {
      try {
        const raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
        if (raw) {
          const parsed = JSON.parse(raw);
          schema = parsed.schema;
          table = parsed.table;
        }
      } catch (err) {
        // ignore
      }
    }

    if (!table) return;

    // Calculate canvas drop position relative to canvas
    let dropX = 60;
    let dropY = 60;
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      dropX = Math.max(20, e.clientX - rect.left + canvasRef.current.scrollLeft - 100);
      dropY = Math.max(20, e.clientY - rect.top + canvasRef.current.scrollTop - 30);
    }

    addTableNode(schema || 'public', table, { x: dropX, y: dropY });
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

  // Compile SQL
  const buildQuerySql = (): string => {
    if (nodes.length === 0) return '-- Add tables to the canvas to generate a SQL query';

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

    const firstNode = nodes[0];
    const firstTableRef = firstNode.schema ? `"${firstNode.schema}"."${firstNode.name}"` : `"${firstNode.name}"`;
    let fromClause = `FROM ${firstTableRef} AS t1`;

    for (let i = 1; i < nodes.length; i++) {
      const currNode = nodes[i];
      const currAlias = `t${i + 1}`;
      const currRef = currNode.schema ? `"${currNode.schema}"."${currNode.name}"` : `"${currNode.name}"`;

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
        fromClause += `\nCROSS JOIN ${currRef} AS ${currAlias}`;
      }
    }

    return `SELECT\n  ${projectionStr}\n${fromClause}\nLIMIT 100;`;
  };

  const generatedSql = buildQuerySql();

  // Notify parent of live generated SQL whenever nodes/joins change
  React.useEffect(() => {
    if (onGeneratedSqlChange) {
      onGeneratedSqlChange(generatedSql);
    }
  }, [generatedSql, onGeneratedSqlChange]);

  return (
    <div className="flex h-full w-full flex-col bg-neutral-950 font-sans select-none overflow-hidden">
      {/* Top Canvas Controls Bar */}
      <div className="flex h-10 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-4 text-xs">
        <div className="flex items-center space-x-2">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-amber-500/20 text-amber-400 font-bold text-xs">
            ◫
          </span>
          <span className="font-semibold text-neutral-200">Interactive Visual ERD & Table Join Builder</span>
          <span className="text-[10px] text-neutral-500 font-mono">
            ({nodes.length} Table{nodes.length !== 1 ? 's' : ''} | {joins.length} Auto-Join{joins.length !== 1 ? 's' : ''})
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={reorderTables}
            className="flex items-center space-x-1 rounded border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 px-2.5 py-1 text-[11px] font-medium text-neutral-200 transition-colors shadow-sm"
            title="Reorder tables into a clean layout"
          >
            <span>▦</span>
            <span>Reorder & Align</span>
          </button>

          <button
            onClick={() => onApplyQuery(generatedSql)}
            className="flex items-center space-x-1 rounded bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-colors"
          >
            <span>⚡</span>
            <span>Send SQL to Query Tab</span>
          </button>
        </div>
      </div>

      {/* Main Canvas Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Freeform Draggable Canvas */}
        <main
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onDragOver={handleCanvasDragOver}
          onDragEnter={handleCanvasDragOver}
          onDragLeave={handleCanvasDragLeave}
          onDrop={handleCanvasDrop}
          className={`flex-1 relative overflow-auto bg-neutral-950 p-4 cursor-default transition-colors ${
            isDragOverCanvas ? 'ring-2 ring-inset ring-blue-500/50 bg-blue-950/10' : ''
          }`}
          style={{
            backgroundImage: 'radial-gradient(#262626 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        >
          {isDragOverCanvas && (
            <div className="absolute top-4 left-4 z-30 pointer-events-none rounded-lg border border-blue-500/80 bg-blue-950/80 px-3 py-1.5 text-xs font-semibold text-blue-300 shadow-xl backdrop-blur-sm animate-pulse">
              + Drop table anywhere to add to canvas
            </div>
          )}

          {/* Bezier Connectors */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" style={{ minWidth: 2000, minHeight: 2000 }}>
            {joins.map((j, idx) => {
              const src = nodes.find((n) => n.id === j.sourceTableId);
              const tgt = nodes.find((n) => n.id === j.targetTableId);
              if (!src || !tgt) return null;

              const x1 = src.x + 240;
              const y1 = src.y + 24;
              const x2 = tgt.x;
              const y2 = tgt.y + 24;
              const dx = Math.abs(x2 - x1) * 0.5;

              return (
                <g key={idx}>
                  <path
                    d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="2.5"
                    strokeDasharray="4 2"
                  />
                  <circle cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} r="9" fill="#1e293b" stroke="#3b82f6" />
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

          {/* Table Cards */}
          {nodes.length === 0 ? (
            <div className="flex flex-col h-full items-center justify-center text-neutral-500 font-mono text-xs space-y-2 pointer-events-none">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-900 border border-neutral-800 text-blue-400 text-xl font-bold shadow-lg">
                ◫
              </div>
              <p className="font-semibold text-neutral-400">Canvas Ready</p>
              <p className="text-[11px] text-neutral-500">
                Drag & drop tables from the left Database Explorer directly onto this canvas, or right-click any table to add.
              </p>
            </div>
          ) : (
            nodes.map((node, nIdx) => (
              <div
                key={node.id}
                style={{ left: `${node.x}px`, top: `${node.y}px` }}
                className="absolute z-20 w-60 rounded-lg border border-neutral-700 bg-neutral-900/95 shadow-xl backdrop-blur-md overflow-hidden text-xs"
              >
                {/* Header with Schema & Table */}
                <div
                  onMouseDown={(e) => handleMouseDown(node.id, e)}
                  className="flex items-center justify-between bg-neutral-800 px-2.5 py-1.5 cursor-grab active:cursor-grabbing border-b border-neutral-700"
                >
                  <div className="flex items-center space-x-1.5 truncate">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTableCollapse(node.id);
                      }}
                      className="text-[9px] text-neutral-400 hover:text-white"
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

                {/* Collapsible Column Items */}
                {!node.isCollapsed && (
                  <div className="max-h-48 overflow-y-auto p-1.5 space-y-0.5">
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
                            className="flex items-center justify-between rounded px-2 py-0.5 hover:bg-neutral-800 cursor-pointer select-none text-[11px]"
                          >
                            <div className="flex items-center space-x-1.5 truncate">
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

      {/* Resizable SQL Live Preview Panel */}
      <div
        style={{ height: `${sqlPanelHeight}px` }}
        className="relative border-t border-neutral-800 bg-neutral-900 px-4 py-2 flex flex-col justify-between shrink-0 shadow-inner"
      >
        {/* Resize Handle Strip (Drag up/down) */}
        <div
          onMouseDown={handleSqlResizeMouseDown}
          className={`absolute top-0 left-0 right-0 h-2 -translate-y-1 cursor-ns-resize z-30 flex items-center justify-center transition-colors ${
            isResizingSql ? 'bg-blue-500/50' : 'hover:bg-blue-500/30'
          }`}
          title="Drag up/down to resize the SQL preview panel"
        >
          <div className="w-12 h-1 rounded-full bg-neutral-600/70" />
        </div>

        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-neutral-400 select-none pt-0.5 pb-1">
          <div className="flex items-center space-x-2">
            <span>Live Generated SQL</span>
            <span className="text-[9px] text-neutral-500 font-normal font-sans">(Editable: Paste or write SQL to visualize)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-emerald-400 font-mono">{nodes.length} Table(s) Linked</span>

            {isCustomSql ? (
              <div className="flex items-center space-x-1">
                <button
                  onClick={() => parseAndLoadSql(customSqlText)}
                  className="text-[10px] font-semibold text-white px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 transition-colors shadow-sm"
                  title="Visualize pasted SQL tables and joins on canvas"
                >
                  ⚡ Parse & Visualize on Canvas
                </button>
                <button
                  onClick={() => {
                    setIsCustomSql(false);
                    setCustomSqlText('');
                  }}
                  className="text-[10px] text-neutral-400 hover:text-white px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700/60"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setIsCustomSql(true);
                  setCustomSqlText(generatedSql);
                }}
                className="text-[10px] text-amber-300 hover:text-white px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-amber-600/50 transition-colors"
                title="Paste external SQL query to visualize its tables and relationships"
              >
                📋 Paste / Edit SQL to Visualize
              </button>
            )}

            <button
              onClick={() => setSqlPanelHeight((h) => (h < 250 ? 320 : 120))}
              className="text-[10px] text-neutral-400 hover:text-white px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700/60 transition-colors"
            >
              {sqlPanelHeight < 250 ? '▲ Expand' : '▼ Compact'}
            </button>
          </div>
        </div>

        {isCustomSql ? (
          <div className="flex-1 flex flex-col pt-1">
            <textarea
              value={customSqlText}
              onChange={(e) => setCustomSqlText(e.target.value)}
              placeholder="Paste your SELECT ... FROM tableA JOIN tableB ON ... query here, then click 'Parse & Visualize on Canvas'"
              className="flex-1 w-full resize-none rounded bg-neutral-950 p-2 font-mono text-[11px] text-neutral-100 border border-blue-500/80 outline-none leading-relaxed"
              spellCheck={false}
              autoFocus
            />
          </div>
        ) : (
          <pre
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text');
              if (pasted && (pasted.includes('FROM') || pasted.includes('from'))) {
                setIsCustomSql(true);
                setCustomSqlText(pasted);
              }
            }}
            onClick={() => {
              setIsCustomSql(true);
              setCustomSqlText(generatedSql);
            }}
            className="flex-1 overflow-auto rounded bg-neutral-950 p-2 font-mono text-[11px] text-neutral-200 border border-neutral-800 select-text leading-relaxed cursor-text hover:border-neutral-700 transition-colors"
            title="Click or paste an SQL query here to load and visualize its tables and joins"
          >
            {generatedSql}
          </pre>
        )}
      </div>
    </div>
  );
};
