import React, { useMemo } from 'react';
import { SchemaHierarchy } from '../types/omnidb';

interface QueryCopilotProps {
  schemaTree: SchemaHierarchy | null;
  activeQueryText?: string;
  onApplyQuery: (sql: string) => void;
}

interface OptimizationIssue {
  type: 'critical' | 'warning' | 'info' | 'success';
  title: string;
  explanation: string;
  suggestedFix?: string;
  suggestedSql?: string;
}

export const QueryCopilot: React.FC<QueryCopilotProps> = ({
  schemaTree,
  activeQueryText = '',
  onApplyQuery,
}) => {
  // Static code / pattern analysis of activeQueryText against best practices
  const issues = useMemo<OptimizationIssue[]>(() => {
    const list: OptimizationIssue[] = [];
    const query = activeQueryText.trim();

    if (!query) {
      list.push({
        type: 'info',
        title: 'No Active Query Detected',
        explanation: 'Select or write a SQL query in the editor or visual builder to see real-time optimization advice.',
      });
      return list;
    }

    const upper = query.toUpperCase();

    // 1. SELECT * anti-pattern check
    if (/\bSELECT\s+\*/i.test(query) || /\bSELECT\s+DISTINCT\s+\*/i.test(query)) {
      list.push({
        type: 'warning',
        title: 'Anti-Pattern: Wildcard SELECT *',
        explanation:
          'Querying all columns with SELECT * disables database index-only scans, inflates network transmission payload, and consumes extra server cache memory.',
        suggestedFix: 'Explicitly specify only the required column names (e.g. `SELECT id, name, created_at FROM ...`).',
      });
    } else if (/\bSELECT\b/i.test(query)) {
      list.push({
        type: 'success',
        title: 'Explicit Column Projections',
        explanation: 'Specifying distinct target columns enables the database query planner to leverage Index-Only Scans and minimize serialization overhead.',
      });
    }

    // 2. Unbounded SELECT without LIMIT
    if (/\bSELECT\b/i.test(query) && !/\bLIMIT\b/i.test(query) && !/\bCOUNT\s*\(/i.test(query)) {
      list.push({
        type: 'critical',
        title: 'Missing LIMIT / Unbounded Result Set',
        explanation:
          'Queries without a LIMIT clause can return millions of rows, leading to high backend CPU consumption, buffer pool eviction, and UI memory freezes.',
        suggestedFix: 'Append `LIMIT 100` or use keyset / cursor pagination (`WHERE id > :cursor LIMIT 50`).',
        suggestedSql: query.endsWith(';')
          ? query.replace(/;$/, ' LIMIT 50;')
          : `${query} LIMIT 50;`,
      });
    } else if (/\bLIMIT\b/i.test(query)) {
      list.push({
        type: 'success',
        title: 'Defensive Result Pagination',
        explanation: 'A LIMIT clause is present, preventing query memory spikes and safeguarding database connection pools.',
      });
    }

    // 3. Leading wildcard LIKE pattern (%text)
    if (/LIKE\s+'%[^']*'/i.test(query) || /ILIKE\s+'%[^']*'/i.test(query)) {
      list.push({
        type: 'critical',
        title: 'Unindexable Leading Wildcard LIKE (%term)',
        explanation:
          'Leading wildcards like `LIKE \'%search%\'` cannot use standard B-Tree indexes and force a full sequential scan across every row in the table.',
        suggestedFix:
          'Use trigram indexes (`CREATE INDEX ON table USING gin (col gin_trgm_ops);`) or PostgreSQL full-text search with `to_tsvector() @@ to_tsquery()`.',
      });
    }

    // 4. CROSS JOIN / Comma Joins without ON
    if (/\bCROSS\s+JOIN\b/i.test(query) || /FROM\s+["\w]+(\s*,\s*["\w]+)+/i.test(query)) {
      list.push({
        type: 'warning',
        title: 'Cartesian Product / CROSS JOIN Risk',
        explanation:
          'Joining tables without an explicit `ON` condition creates a Cartesian product (M × N rows), multiplying data volume exponentially.',
        suggestedFix: 'Use explicit `INNER JOIN` or `LEFT JOIN` with an `ON tableA.fk = tableB.id` condition.',
      });
    }

    // 5. Function calls wrapping WHERE columns: WHERE LOWER(email) = ...
    if (/WHERE\s+[\w_]+\s*\(\s*["\w.]+\s*\)\s*=/i.test(query)) {
      list.push({
        type: 'warning',
        title: 'Function Wrapped WHERE Predicate',
        explanation:
          'Wrapping columns in functions like `WHERE LOWER(col) = \'abc\'` prevents standard index lookups unless an expression index is explicitly created.',
        suggestedFix: 'Create a functional index (e.g. `CREATE INDEX ON table (LOWER(col));`) or format incoming values before querying.',
      });
    }

    // 6. ORDER BY without LIMIT
    if (/\bORDER\s+BY\b/i.test(query) && !/\bLIMIT\b/i.test(query)) {
      list.push({
        type: 'warning',
        title: 'Full In-Memory Sort',
        explanation:
          'Sorting large tables without a LIMIT clause causes Postgres or MySQL to spill work memory (work_mem) to temporary disk files, degrading I/O performance.',
        suggestedFix: 'Add a LIMIT clause and ensure an index matching the ORDER BY sort column and direction exists.',
      });
    }

    // 7. IN (SELECT ...) subquery instead of JOIN or EXISTS
    if (/\bWHERE\s+["\w.]+\s+IN\s*\(\s*SELECT\b/i.test(query)) {
      list.push({
        type: 'info',
        title: 'Subquery IN (...) vs EXISTS',
        explanation:
          'In large datasets, `WHERE id IN (SELECT id FROM ...)` can be less efficient than `WHERE EXISTS (SELECT 1 FROM ...)` or an explicit `JOIN`, which allow the engine to use Semi-Join optimizations.',
      });
    }

    return list;
  }, [activeQueryText]);

  return (
    <div className="flex h-full flex-col bg-neutral-900 border-l border-neutral-800 text-xs text-neutral-200 font-sans select-none">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5 bg-neutral-950">
        <div className="flex items-center space-x-2">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-amber-500/20 text-amber-400 font-bold">
            ⚡
          </span>
          <span className="font-semibold text-neutral-100">SQL Assistant & Query Optimizer</span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Active Query Inspected */}
        <div>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">
            Inspected Active Query
          </span>
          <pre className="rounded border border-neutral-800 bg-neutral-950 p-2.5 font-mono text-[11px] text-neutral-300 max-h-32 overflow-auto select-text leading-relaxed">
            {activeQueryText.trim() || '-- No query content currently loaded in editor/builder'}
          </pre>
        </div>

        {/* Real-Time Optimization Audit */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
              Audit Findings & Index Guidance ({issues.length})
            </span>
          </div>

          <div className="space-y-2.5">
            {issues.map((issue, idx) => {
              const borderColors = {
                critical: 'border-red-800/80 bg-red-950/20 text-red-300',
                warning: 'border-amber-800/80 bg-amber-950/20 text-amber-300',
                info: 'border-blue-800/80 bg-blue-950/20 text-blue-300',
                success: 'border-emerald-800/80 bg-emerald-950/20 text-emerald-300',
              };

              const badgeColors = {
                critical: 'bg-red-500/30 text-red-400',
                warning: 'bg-amber-500/30 text-amber-400',
                info: 'bg-blue-500/30 text-blue-400',
                success: 'bg-emerald-500/30 text-emerald-400',
              };

              const icons = {
                critical: '⚠️',
                warning: '⚡',
                info: '💡',
                success: '✓',
              };

              return (
                <div
                  key={idx}
                  className={`rounded-lg border p-3 ${borderColors[issue.type]} space-y-1.5`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 font-semibold text-xs">
                      <span>{icons[issue.type]}</span>
                      <span>{issue.title}</span>
                    </div>
                    <span
                      className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded ${badgeColors[issue.type]}`}
                    >
                      {issue.type}
                    </span>
                  </div>

                  <p className="text-[11px] text-neutral-300 leading-relaxed font-sans">
                    {issue.explanation}
                  </p>

                  {issue.suggestedFix && (
                    <div className="pt-1 text-[11px] text-neutral-200">
                      <span className="font-semibold text-amber-400">Recommendation: </span>
                      {issue.suggestedFix}
                    </div>
                  )}

                  {issue.suggestedSql && (
                    <div className="pt-1.5 flex items-center justify-between">
                      <button
                        onClick={() => onApplyQuery(issue.suggestedSql!)}
                        className="rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 px-2 py-0.5 text-[10px] text-emerald-300 font-mono transition-colors"
                      >
                        Apply Fix to Query
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Database Index Strategies Cheat Sheet */}
        <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 space-y-2">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            Engine Optimization Rulebook
          </span>
          <div className="space-y-1 text-[11px] text-neutral-400 leading-normal">
            <div>• <strong className="text-neutral-200">Index Selectivity:</strong> Place highest-cardinality equality columns first in composite B-Tree indexes.</div>
            <div>• <strong className="text-neutral-200">Index-Only Scans:</strong> Include projected fields in the index (`INCLUDE (...)`) to eliminate heap lookups.</div>
            <div>• <strong className="text-neutral-200">Join Optimization:</strong> Ensure foreign key referencing columns on both joined tables have indexes.</div>
            <div>• <strong className="text-neutral-200">EXPLAIN ANALYZE:</strong> Run execution plans to compare estimated planner cost vs real wall-clock latency.</div>
          </div>
        </div>
      </div>
    </div>
  );
};
