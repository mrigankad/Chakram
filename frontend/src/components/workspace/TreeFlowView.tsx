import { useEffect, useMemo, useState, useCallback, memo } from "react";
import { FileIcon } from "@/components/FileIcon";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow,
  Handle,
  Position,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  FileCode,
  FileText,
  GitBranch,
  Flame,
  ChevronRight,
  ChevronDown,
  Maximize2,
  Minimize2,
  Loader2,
  Code2,
  Copy,
  Check,
  ArrowLeft,
  FlaskConical,
  Download,
  X,
  Layers,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AiIcon } from "@/lib/icons";
import { GephiSigmaGraph } from "@/components/workspace/GephiSigmaGraph";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  api,
  impactApi,
  baselineApi,
  type CommitImpactTreeNode,
  type FileChainAnalysis,
  type GraphEdge,
  type GraphNode,
  type WorkspacePlaywrightTest,
  type WorkspaceTestStep,
} from "@/lib/api";
import { deriveRootToLeafChain } from "@/lib/dep-graph";
import { useWorkspaceContext } from "@/context/WorkspaceContext";
import { useCommitImpactTree } from "@/hooks/use-commit-impact";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// ── Types ─────────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  M: "text-[var(--color-warning)]",
  U: "text-info",
  A: "text-positive",
  D: "text-destructive",
  modified: "text-[var(--color-warning)]",
  untracked: "text-info",
  staged: "text-positive",
  deleted: "text-destructive",
};

const SEVERITY_STYLE: Record<string, string> = {
  Critical: "bg-raised text-destructive border-stroke-muted",
  High: "bg-[var(--color-warning-bg)] text-[var(--color-warning)] border-[var(--color-status-warning)]/30",
  Medium: "bg-raised text-warning border-stroke-muted",
  Low: "bg-raised-2 text-ink-quaternary border-stroke-muted",
};

interface FlowNodeData extends Record<string, unknown> {
  label: string;
  path: string;
  status?: string;
  isRoot?: boolean;
  isLeaf?: boolean;
  isEntry?: boolean;
  depth?: number;
  importsCount?: number;
  impactedByCount?: number;
}

interface FileTestGroup {
  filePath: string;
  tests: WorkspacePlaywrightTest[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileIcon(path: string, isEntry?: boolean) {
  if (isEntry) return <Flame className="h-4 w-4 text-[var(--color-warning)] flex-shrink-0" />;
  return <FileIcon name={path} size={16} />;
}

function flattenImpactTree(
  nodes: CommitImpactTreeNode[],
  map = new Map<string, CommitImpactTreeNode>(),
): Map<string, CommitImpactTreeNode> {
  for (const n of nodes) {
    map.set(n.path, n);
    if (n.children) flattenImpactTree(n.children, map);
  }
  return map;
}

function findPathToTarget(
  nodes: CommitImpactTreeNode[],
  target: string,
): string[] | null {
  for (const node of nodes) {
    if (node.path === target) return [node.path];
    const child = findPathToTarget(node.children ?? [], target);
    if (child) return [node.path, ...child];
  }
  return null;
}

function deriveNeighborhoodSubset(
  focusPath: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  maxHops = 2,
): Set<string> {
  const nodeSet = new Set(nodes.map((n) => n.path));
  const subset = new Set<string>();
  if (!focusPath || !nodeSet.has(focusPath)) return subset;

  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (!nodeSet.has(e.source) || !nodeSet.has(e.target)) continue;
    if (!adjacency.has(e.source)) adjacency.set(e.source, []);
    if (!adjacency.has(e.target)) adjacency.set(e.target, []);
    adjacency.get(e.source)!.push(e.target);
    adjacency.get(e.target)!.push(e.source);
  }

  const queue: Array<{ path: string; hops: number }> = [{ path: focusPath, hops: 0 }];
  subset.add(focusPath);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.hops >= maxHops) continue;
    for (const next of adjacency.get(current.path) ?? []) {
      if (subset.has(next)) continue;
      subset.add(next);
      queue.push({ path: next, hops: current.hops + 1 });
    }
  }

  return subset;
}

// ── Playwright code formatter ─────────────────────────────────────────────────

function escapeJsString(value?: string | null): string {
  return (value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, "\\n");
}

function toSingleLineComment(value?: string | null): string {
  return (value ?? "").replace(/\r?\n/g, " ").trim();
}

function formatStepCode(step: WorkspaceTestStep): string {
  const value = escapeJsString(step.value);
  const selector = escapeJsString(step.selector);

  switch (step.action) {
    case "navigate":
      return `  await page.goto('${value || "/"}');`;
    case "click":
      return `  await page.click('${selector}');`;
    case "fill":
      return `  await page.fill('${selector}', '${value}');`;
    case "assert_text":
      return `  await expect(page.locator('body')).toContainText('${value}');`;
    case "screenshot":
      return `  await page.screenshot({ path: 'screenshots/step.png' });`;
    case "wait": {
      const waitSeconds = Number.parseFloat(step.value ?? "2");
      const waitMs = Number.isFinite(waitSeconds) && waitSeconds >= 0 ? Math.round(waitSeconds * 1000) : 2000;
      return `  await page.waitForTimeout(${waitMs});`;
    }
    case "hover":
      return `  await page.hover('${selector}');`;
    case "hover_and_click":
      return `  await page.hover('${selector}');\n  await page.click('${value}');`;
    case "press":
      return `  await page.press('${selector || "body"}', '${value}');`;
    case "check":
      return `  await page.check('${selector}');`;
    case "uncheck":
      return `  await page.uncheck('${selector}');`;
    case "select_option":
      return `  await page.selectOption('${selector}', '${value}');`;
    case "dblclick":
      return `  await page.dblclick('${selector}');`;
    case "type_into":
      return `  await page.type('${selector}', '${value}');`;
    case "scroll":
      return selector
        ? `  await page.locator('${selector}').scrollIntoViewIfNeeded();`
        : "  await page.evaluate(() => window.scrollBy(0, 500));";
    case "clear":
      return `  await page.fill('${selector}', '');`;
    default:
      return `  // ${step.action}: ${toSingleLineComment(step.description)}`;
  }
}

function formatTestToSpec(test: WorkspacePlaywrightTest): string {
  const stepsCode = test.steps
    .map((s) => {
      const code = formatStepCode(s);
      return `  // ${toSingleLineComment(s.description) || s.action}\n${code}`;
    })
    .join("\n\n");

  return `import { test, expect } from '@playwright/test';

test('${escapeJsString(test.name)}', async ({ page }) => {
  // ${toSingleLineComment(test.description)}
${stepsCode}
});`;
}

function formatGroupedTestsToSpec(groups: FileTestGroup[]): string {
  const lines: string[] = [
    "import { test, expect } from '@playwright/test';",
    "",
    "// Generated by Workspace Impact View",
    "",
  ];

  for (const group of groups) {
    lines.push(`test.describe('${escapeJsString(group.filePath)}', () => {`);

    for (const testCase of group.tests) {
      lines.push(`  test('${escapeJsString(testCase.name)}', async ({ page }) => {`);
      if (testCase.description) {
        lines.push(`    // ${toSingleLineComment(testCase.description)}`);
      }

      if (testCase.steps.length === 0) {
        lines.push("    // TODO: Add test steps");
      }

      for (const step of testCase.steps) {
        lines.push(`    // ${toSingleLineComment(step.description) || step.action}`);
        lines.push(...formatStepCode(step).split("\n").map((line) => `  ${line}`));
      }

      lines.push("  });");
      lines.push("");
    }

    lines.push("});");
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

// ── Flow layout ───────────────────────────────────────────────────────────────

const NODE_W = 220;
const NODE_H = 68;
const X_GAP = 100;
const Y_GAP = 100;

function buildBranchFlow(
  focusPath: string,
  chain: string[],
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  impactNodeMap: Map<string, CommitImpactTreeNode>,
): { nodes: Node[]; edges: Edge[] } {
  const nodeMap = new Map(graphNodes.map((n) => [n.path, n]));
  const allSet = new Set(graphNodes.map((n) => n.path));

  const parentMap = new Map<string, string[]>();
  const childMap = new Map<string, string[]>();
  for (const edge of graphEdges) {
    if (!allSet.has(edge.source) || !allSet.has(edge.target)) continue;

    if (!parentMap.has(edge.target)) parentMap.set(edge.target, []);
    parentMap.get(edge.target)!.push(edge.source);

    if (!childMap.has(edge.source)) childMap.set(edge.source, []);
    childMap.get(edge.source)!.push(edge.target);
  }

  const subset = new Set<string>(chain.length > 0 ? chain : [focusPath]);

  const roots = [...subset].filter((p) => ((parentMap.get(p) ?? []).filter((x) => subset.has(x)).length === 0));
  const orderedRoots = roots.length > 0 ? roots : [focusPath];

  const layer = new Map<string, number>();
  const queue: Array<{ path: string; depth: number }> = orderedRoots.map((r) => ({ path: r, depth: 0 }));

  while (queue.length > 0) {
    const current = queue.shift()!;
    const prevDepth = layer.get(current.path);
    if (prevDepth !== undefined && prevDepth >= current.depth) continue;

    layer.set(current.path, current.depth);
    for (const child of childMap.get(current.path) ?? []) {
      if (!subset.has(child)) continue;
      queue.push({ path: child, depth: current.depth + 1 });
    }
  }

  for (const p of subset) {
    if (!layer.has(p)) layer.set(p, 0);
  }

  const chainIndex = new Map<string, number>();
  chain.forEach((p, i) => chainIndex.set(p, i));

  const groups = new Map<number, string[]>();
  for (const p of subset) {
    const d = layer.get(p) ?? 0;
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d)!.push(p);
  }

  for (const [, arr] of groups) {
    arr.sort((a, b) => {
      const ai = chainIndex.has(a) ? chainIndex.get(a)! : Number.MAX_SAFE_INTEGER;
      const bi = chainIndex.has(b) ? chainIndex.get(b)! : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });
  }

  const rfNodes: Node[] = [];
  for (const d of [...groups.keys()].sort((a, b) => a - b)) {
    const arr = groups.get(d) ?? [];
    arr.forEach((path, idx) => {
      const impact = impactNodeMap.get(path);
      const graph = nodeMap.get(path);
      const status = impact?.status && impact.status !== " " ? impact.status : undefined;

      rfNodes.push({
        id: path,
        type: "treeFlowNode",
        position: { x: d * (NODE_W + X_GAP), y: idx * Y_GAP },
        data: {
          label: path.split("/").pop() ?? path,
          path,
          status,
          isRoot: chain.length > 0 ? path === chain[0] : idx === 0 && d === 0,
          isLeaf: chain.length > 0 ? path === chain[chain.length - 1] : path === focusPath,
          isEntry: impact?.is_entry ?? false,
          depth: impact?.depth ?? graph?.layer ?? d,
          importsCount: impact?.imports_count ?? 0,
          impactedByCount: impact?.impacted_by_count ?? 0,
        } as FlowNodeData,
        draggable: false,
        selectable: true,
        style: { width: NODE_W, height: NODE_H },
      });
    });
  }

  const chainEdges = new Set<string>();
  for (let i = 0; i < chain.length - 1; i += 1) {
    chainEdges.add(`${chain[i]}->${chain[i + 1]}`);
  }

  const rfEdges: Edge[] = [];
  for (const e of graphEdges) {
    if (!subset.has(e.source) || !subset.has(e.target)) continue;
    const highlighted = chainEdges.has(`${e.source}->${e.target}`);
    rfEdges.push({
      id: `e-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: "step",
      animated: highlighted,
      style: {
        stroke: highlighted ? "#B45309" : "hsl(var(--border))",
        strokeWidth: highlighted ? 2.2 : 1.4,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color: highlighted ? "#B45309" : "hsl(var(--border))",
      },
    });
  }

  return { nodes: rfNodes, edges: rfEdges };
}

function buildNeighborhoodFlow(
  focusPath: string,
  chain: string[],
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  impactNodeMap: Map<string, CommitImpactTreeNode>,
): { nodes: Node[]; edges: Edge[] } {
  const nodeMap = new Map(graphNodes.map((n) => [n.path, n]));
  const allSet = new Set(graphNodes.map((n) => n.path));
  const subset = deriveNeighborhoodSubset(focusPath, graphNodes, graphEdges, 2);
  if (subset.size === 0) return { nodes: [], edges: [] };

  const parentMap = new Map<string, string[]>();
  const childMap = new Map<string, string[]>();
  for (const e of graphEdges) {
    if (!allSet.has(e.source) || !allSet.has(e.target)) continue;
    if (!parentMap.has(e.target)) parentMap.set(e.target, []);
    parentMap.get(e.target)!.push(e.source);
    if (!childMap.has(e.source)) childMap.set(e.source, []);
    childMap.get(e.source)!.push(e.target);
  }

  // Distance from focus in directed space: downstream => positive, upstream => negative
  const downstream = new Map<string, number>([[focusPath, 0]]);
  const upstream = new Map<string, number>([[focusPath, 0]]);

  const qDown: Array<{ path: string; d: number }> = [{ path: focusPath, d: 0 }];
  while (qDown.length > 0) {
    const cur = qDown.shift()!;
    if (cur.d >= 2) continue;
    for (const next of childMap.get(cur.path) ?? []) {
      if (!subset.has(next) || downstream.has(next)) continue;
      downstream.set(next, cur.d + 1);
      qDown.push({ path: next, d: cur.d + 1 });
    }
  }

  const qUp: Array<{ path: string; d: number }> = [{ path: focusPath, d: 0 }];
  while (qUp.length > 0) {
    const cur = qUp.shift()!;
    if (cur.d >= 2) continue;
    for (const prev of parentMap.get(cur.path) ?? []) {
      if (!subset.has(prev) || upstream.has(prev)) continue;
      upstream.set(prev, cur.d + 1);
      qUp.push({ path: prev, d: cur.d + 1 });
    }
  }

  const layerMap = new Map<string, number>();
  for (const p of subset) {
    if (p === focusPath) {
      layerMap.set(p, 0);
      continue;
    }
    const dn = downstream.get(p);
    const up = upstream.get(p);
    if (dn !== undefined && dn > 0) layerMap.set(p, dn);
    else if (up !== undefined && up > 0) layerMap.set(p, -up);
    else layerMap.set(p, 0);
  }

  const chainIndex = new Map<string, number>();
  chain.forEach((p, i) => chainIndex.set(p, i));

  const groups = new Map<number, string[]>();
  for (const p of subset) {
    const layer = layerMap.get(p) ?? 0;
    if (!groups.has(layer)) groups.set(layer, []);
    groups.get(layer)!.push(p);
  }

  for (const [, arr] of groups) {
    arr.sort((a, b) => {
      const ai = chainIndex.has(a) ? chainIndex.get(a)! : Number.MAX_SAFE_INTEGER;
      const bi = chainIndex.has(b) ? chainIndex.get(b)! : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });
  }

  const orderedLayers = [...groups.keys()].sort((a, b) => a - b);
  const minLayer = orderedLayers[0] ?? 0;

  const rfNodes: Node[] = [];
  for (const layer of orderedLayers) {
    const arr = groups.get(layer) ?? [];
    arr.forEach((path, idx) => {
      const impact = impactNodeMap.get(path);
      const graph = nodeMap.get(path);
      const status = impact?.status && impact.status !== " " ? impact.status : undefined;
      rfNodes.push({
        id: path,
        type: "treeFlowNode",
        position: { x: (layer - minLayer) * (NODE_W + X_GAP), y: idx * Y_GAP },
        data: {
          label: path.split("/").pop() ?? path,
          path,
          status,
          isRoot: chain.length > 0 ? path === chain[0] : false,
          isLeaf: chain.length > 0 ? path === chain[chain.length - 1] : path === focusPath,
          isEntry: impact?.is_entry ?? false,
          depth: impact?.depth ?? graph?.layer ?? 0,
          importsCount: impact?.imports_count ?? 0,
          impactedByCount: impact?.impacted_by_count ?? 0,
        } as FlowNodeData,
        draggable: false,
        selectable: true,
        style: { width: NODE_W, height: NODE_H },
      });
    });
  }

  const chainEdges = new Set<string>();
  for (let i = 0; i < chain.length - 1; i += 1) {
    chainEdges.add(`${chain[i]}->${chain[i + 1]}`);
  }

  const rfEdges: Edge[] = [];
  for (const e of graphEdges) {
    if (!subset.has(e.source) || !subset.has(e.target)) continue;
    const highlighted = chainEdges.has(`${e.source}->${e.target}`);
    rfEdges.push({
      id: `e-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: "step",
      animated: highlighted,
      style: {
        stroke: highlighted ? "#B45309" : "hsl(var(--border))",
        strokeWidth: highlighted ? 2.2 : 1.4,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color: highlighted ? "#B45309" : "hsl(var(--border))",
      },
    });
  }

  return { nodes: rfNodes, edges: rfEdges };
}

// ── Custom React Flow node ────────────────────────────────────────────────────

const TreeFlowNode = memo(({ data, selected }: NodeProps) => {
  const d = data as FlowNodeData;
  const status = d.status as string | undefined;

  return (
    <div
      className={cn(
        "h-full w-full rounded-lg border-2 px-3 py-2",
        "flex flex-col justify-between gap-1 cursor-pointer transition-all duration-150",
        "bg-container",
        selected
          ? "border-primary ring-2 ring-primary/30"
          : d.isLeaf
          ? "border-stroke bg-raised"
          : d.isRoot || d.isEntry
          ? "border-[var(--color-status-warning)]/30 bg-[var(--color-warning-bg)]"
          : "border-border/60 hover:border-border",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={{ background: "hsl(var(--border))", width: 6, height: 6, border: "none", left: -4 }}
      />

      <div className="flex items-center gap-2 min-w-0">
        {fileIcon(d.path as string, d.isEntry as boolean | undefined)}
        <span className="font-mono text-[12px] font-semibold text-ink truncate flex-1">
          {d.label as string}
        </span>
        {status && (
          <span className={cn("text-[10px] font-bold flex-shrink-0", STATUS_STYLE[status] ?? "")}>
            {status}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {d.isRoot && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--color-warning-bg)] text-[var(--color-warning)]">
            changed root
          </span>
        )}
        {d.isLeaf && !d.isRoot && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-raised text-primary">
            selected
          </span>
        )}
        {d.isEntry && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--color-warning-bg)] text-[var(--color-warning)]">
            entry
          </span>
        )}
        {!d.isRoot && !d.isLeaf && (
          <span className="text-[10px] text-ink-quaternary">depth {d.depth}</span>
        )}
        {(d.importsCount as number) > 0 && (
          <span className="ml-auto text-[10px] text-ink-quaternary">
            {d.importsCount as number} imports
          </span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ background: "hsl(var(--border))", width: 6, height: 6, border: "none", right: -4 }}
      />
    </div>
  );
});
TreeFlowNode.displayName = "TreeFlowNode";

const NODE_TYPES = { treeFlowNode: TreeFlowNode };

// ── Flow canvas ───────────────────────────────────────────────────────────────

interface FlowCanvasProps {
  focusPath: string;
  chain: string[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  impactNodeMap: Map<string, CommitImpactTreeNode>;
  viewMode: "chain" | "neighborhood";
}

function FlowCanvas({ focusPath, chain, graphNodes, graphEdges, impactNodeMap, viewMode }: FlowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const chainKey = `${focusPath}|${viewMode}|${chain.join("|")}|${graphNodes.length}|${graphEdges.length}`;

  useEffect(() => {
    if (chain.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const { nodes: n, edges: e } =
      viewMode === "neighborhood"
        ? buildNeighborhoodFlow(focusPath, chain, graphNodes, graphEdges, impactNodeMap)
        : buildBranchFlow(focusPath, chain, graphNodes, graphEdges, impactNodeMap);
    setNodes(n);
    setEdges(e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={NODE_TYPES}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={true}
      panOnDrag={true}
      zoomOnScroll={true}
      fitView
      fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
      proOptions={{ hideAttribution: true }}
      style={{ background: "transparent" }}
    >
      <Background
        variant={BackgroundVariant.Lines}
        gap={32}
        size={1}
        color="hsl(var(--border) / 0.1)"
      />
      <Controls
        showInteractive={false}
        className="!bg-raised !border-stroke-muted !shadow-none [&>button]:!bg-transparent [&>button]:!border-stroke-muted"
      />
    </ReactFlow>
  );
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────

function ChainBreadcrumb({ chain }: { chain: string[] }) {
  if (chain.length === 0) return null;
  return (
    <div className="flex items-center gap-0.5 flex-wrap min-w-0">
      {chain.map((path, i) => (
        <span key={path} className="flex items-center gap-0.5">
          {i > 0 && <ChevronRight className="h-2.5 w-2.5 text-ink-quaternary flex-shrink-0" />}
          <span
            className={cn(
              "text-[10px] truncate max-w-[90px]",
              i === chain.length - 1
                ? "text-ink font-medium"
                : "text-ink-quaternary",
            )}
            title={path}
          >
            {path.split("/").pop()}
          </span>
        </span>
      ))}
    </div>
  );
}

// ── Test case row ─────────────────────────────────────────────────────────────

function TestCaseRow({ test }: { test: WorkspacePlaywrightTest }) {
  const [expanded, setExpanded] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [editedCode, setEditedCode] = useState(() => formatTestToSpec(test));
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(editedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border border-stroke-muted rounded-lg overflow-hidden bg-raised">
      {/* Test header */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-raised transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-ink-quaternary flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-ink-quaternary flex-shrink-0" />
        )}
        <FlaskConical className="h-3.5 w-3.5 text-ink-tertiary flex-shrink-0" />
        <span className="flex-1 text-xs font-medium text-ink truncate">{test.name}</span>
        <span
          className={cn(
            "text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0",
            SEVERITY_STYLE[test.severity] ?? "bg-raised text-muted-foreground border-stroke-muted",
          )}
        >
          {test.severity}
        </span>
        <span className="text-[10px] text-ink-quaternary flex-shrink-0">
          {test.steps.length} steps
        </span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-stroke-muted px-3 py-2 space-y-2">
          {/* Description */}
          {test.description && (
            <p className="text-[11px] text-ink-tertiary italic">{test.description}</p>
          )}

          {/* Steps list */}
          {!showCode && (
            <ol className="space-y-1">
              {test.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-[10px] text-ink-quaternary pt-0.5 w-4 text-right flex-shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-mono text-ink-secondary mr-1.5">{step.action}</span>
                    <span className="text-[10px] text-ink-quaternary">{step.description}</span>
                    {step.selector && (
                      <div className="text-[10px] font-mono text-ink-quaternary truncate">
                        {step.selector}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {/* Code view / editor */}
          {showCode && (
            <div className="relative">
              <textarea
                className="w-full h-48 text-[10px] font-mono bg-raised border border-stroke-muted rounded p-2 text-ink resize-y focus:outline-none focus:ring-1 focus:ring-primary/40"
                value={editedCode}
                onChange={(e) => setEditedCode(e.target.value)}
                spellCheck={false}
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              className={cn(
                "flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-colors",
                showCode
                  ? "border-stroke text-primary bg-raised"
                  : "border-stroke-muted text-muted-foreground hover:text-ink hover:border-border",
              )}
              onClick={() => setShowCode((v) => !v)}
            >
              <Code2 className="h-3 w-3" />
              {showCode ? "Hide Code" : "View Code"}
            </button>
            {showCode && (
              <button
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-stroke-muted text-muted-foreground hover:text-ink hover:border-border transition-colors"
                onClick={handleCopy}
              >
                {copied ? <Check className="h-3 w-3 text-positive" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied!" : "Copy"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── File test group ───────────────────────────────────────────────────────────

function FileTestGroup({ group, chainIndex }: { group: FileTestGroup; chainIndex: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const fileName = group.filePath.split("/").pop() ?? group.filePath;

  return (
    <div className="space-y-1.5">
      {/* File header */}
      <button
        className="w-full flex items-center gap-2 px-1 py-0.5 rounded hover:bg-raised transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 text-ink-quaternary" />
        ) : (
          <ChevronDown className="h-3 w-3 text-ink-quaternary" />
        )}
        <span className="text-[10px] text-ink-quaternary font-mono w-4 text-right flex-shrink-0">
          {chainIndex + 1}
        </span>
        <FileCode className="h-3.5 w-3.5 text-info flex-shrink-0" />
        <span className="font-mono text-xs font-semibold text-ink flex-1 text-left">
          {fileName}
        </span>
        <span className="text-[10px] text-ink-quaternary flex-shrink-0 bg-raised px-1.5 py-0.5 rounded">
          {group.tests.length} test{group.tests.length !== 1 ? "s" : ""}
        </span>
      </button>

      {/* Tests */}
      {!collapsed && (
        <div className="pl-6 space-y-1.5">
          {group.tests.map((test) => (
            <TestCaseRow key={test.id} test={test} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── TreeFlowView ──────────────────────────────────────────────────────────────

export function TreeFlowView({
  onBackToCode,
  onTestsGenerated,
}: {
  onBackToCode?: () => void;
  onTestsGenerated?: (tests: WorkspacePlaywrightTest[]) => void;
} = {}) {
  const { workspace, activeTab, fileTests, setFileTests } = useWorkspaceContext();
  // The SDLC Pipeline stage that once supplied a GitHub PAT here was retired.
  const githubPat = "";
  const impactQuery = useCommitImpactTree(workspace?.workspace_id ?? null, 5, githubPat || undefined);
  const fallbackGraphQuery = useQuery({
    queryKey: ["tree-flow-fallback-graph", workspace?.workspace_id],
    queryFn: () =>
      impactApi.buildWorkspaceGraph({
        workspace_id: workspace!.workspace_id,
        pat: githubPat || undefined,
      }),
    enabled: !!workspace?.workspace_id,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const [generatingTests, setGeneratingTests] = useState(false);
  const [generatingFile, setGeneratingFile] = useState<string | null>(null);
  const [flowViewMode, setFlowViewMode] = useState<"chain" | "neighborhood" | "gephi">("gephi");
  const [dialogPhase, setDialogPhase] = useState<"closed" | "analyzing" | "review">("closed");
  const [alignmentPanelOpen, setAlignmentPanelOpen] = useState(true);
  const [alignmentPanelExpanded, setAlignmentPanelExpanded] = useState(false);
  const [perFileAnalysis, setPerFileAnalysis] = useState<
    Array<FileChainAnalysis & { requestedCount: number; isLeaf: boolean; isRoot: boolean }>
  >([]);
  const [baselineTests, setBaselineTests] = useState<any[]>([]);

  // Fetch baseline on mount
  useEffect(() => {
    if (!workspace?.repo_url) return;
    const fetchBaseline = async () => {
      try {
        const repoId = await api.getRepoId(workspace.repo_url);
        const data = await baselineApi.getRepoTests(repoId);
        setBaselineTests(data.tests || []);
      } catch (err) {
        // 404 = this repository has no saved baseline yet.
        setBaselineTests([]);
        if ((err as { response?: { status?: number } })?.response?.status !== 404) {
          toast.error("Could not load this repository's saved baseline tests.");
        }
      }
    };
    fetchBaseline();
  }, [workspace?.repo_url]);

  // `?? []` inline would allocate a new array every render, invalidating every
  // memo below it and re-walking the graph on each paint.
  // The workspace graph now includes test files (flagged is_test) so the Code
  // Impact page can offer them behind a toggle. This view has no such toggle,
  // so filter them out here to keep it showing source dependencies only —
  // dropping every edge that touches a test as well, so none dangle.
  const graphData = useMemo(() => {
    const raw = fallbackGraphQuery.data;
    if (!raw) return null;
    const keep = new Set(raw.nodes.filter((n) => !n.is_test).map((n) => n.path));
    return {
      nodes: raw.nodes.filter((n) => keep.has(n.path)),
      edges: raw.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    };
  }, [fallbackGraphQuery.data]);

  const roots = useMemo(() => impactQuery.data?.roots ?? [], [impactQuery.data]);
  const impactNodeMap = useMemo(() => flattenImpactTree(roots), [roots]);

  const impactChain = useMemo(() => {
    if (!activeTab) return [];
    return findPathToTarget(roots, activeTab) ?? [];
  }, [roots, activeTab]);

  const fallbackChain = useMemo(() => {
    if (!activeTab || !graphData) return [];
    return deriveRootToLeafChain(
      activeTab,
      graphData.nodes,
      graphData.edges,
    );
  }, [activeTab, graphData]);

  const chain = useMemo(() => {
    // Only use impactChain when it's a real path (2+ nodes).
    // A single-node impactChain means the selected file IS the changed root —
    // in that case the fallbackChain (full dependency walk) gives a richer view.
    if (impactChain.length > 1) return impactChain;
    if (fallbackChain.length > 0) return fallbackChain;
    if (impactChain.length > 0) return impactChain;
    return activeTab ? [activeTab] : [];
  }, [impactChain, fallbackChain, activeTab]);

  const changedPathSet = useMemo(() => {
    const changed = new Set<string>();
    const graphNodes = graphData?.nodes ?? [];
    for (const node of graphNodes) {
      if (node.is_changed) changed.add(node.path);
    }
    for (const path of impactNodeMap.keys()) changed.add(path);
    return changed;
  }, [graphData?.nodes, impactNodeMap]);

  // Clear tests when chain changes
  useEffect(() => {
    setFileTests(null);
  }, [activeTab]);

  useEffect(() => {
    if (fileTests && fileTests.length > 0) {
      setAlignmentPanelOpen(true);
    }
  }, [fileTests]);

  const handleGenerateTests = useCallback(async (countMap: Map<string, number>) => {
    if (!workspace || chain.length === 0) return;
    setGeneratingTests(true);
    setFileTests(null);

    const results: FileTestGroup[] = [];
    const failedFiles: string[] = [];

    try {
      for (const filePath of chain) {
        const numTests = countMap.get(filePath) ?? 1;
        if (numTests === 0) continue;
        setGeneratingFile(filePath.split("/").pop() ?? filePath);
        try {
          const file = await api.getWorkspaceFile(workspace.workspace_id, filePath);
          const result = await api.generatePlaywrightTests({
            workspace_id: workspace.workspace_id,
            file_path: filePath,
            content: file.content,
            num_tests: numTests,
          });
          if (result.tests.length > 0) {
            results.push({ filePath, tests: result.tests });
          }
        } catch {
          // One file failing does not stop the rest, but it is reported below.
          failedFiles.push(filePath);
        }
      }

      const failedNote = failedFiles.length
        ? `Generation failed for ${failedFiles.length} file${failedFiles.length !== 1 ? "s" : ""}: ${failedFiles
            .map((f) => f.split("/").pop() ?? f)
            .join(", ")}.`
        : "";

      if (results.length === 0) {
        toast.error(failedNote || "No test cases were returned for this chain.");
      } else {
        setFileTests(results);
        const allTests = results.flatMap((g) => g.tests);
        onTestsGenerated?.(allTests);
        toast.success(`Generated tests for ${results.length} file${results.length !== 1 ? "s" : ""}`);
        if (failedNote) toast.error(failedNote);
      }
    } catch {
      toast.error("Failed to generate test cases. Please try again.");
    } finally {
      setGeneratingTests(false);
      setGeneratingFile(null);
    }
  }, [workspace, chain]);

  const handleOpenAnalysis = useCallback(async () => {
    if (!workspace || chain.length === 0) return;
    setDialogPhase("analyzing");

    // Determine which files are directly changed using the impact map and graph nodes
    const graphNodes = graphData?.nodes ?? [];
    const changedFiles = chain.filter((p) => {
      const node = graphNodes.find((n) => n.path === p) as { is_changed?: boolean } | undefined;
      return node?.is_changed || impactNodeMap.has(p);
    });
    const lastIdx = chain.length - 1;

    try {
      const { analyses } = await api.analyzeChain({
        workspace_id: workspace.workspace_id,
        chain,
        changed_files: changedFiles,
      });

      setPerFileAnalysis(
        analyses.map((a, idx) => ({
          ...a,
          requestedCount: a.suggested_count,
          isLeaf: idx === lastIdx,
          isRoot: idx === 0,
        })),
      );
      setDialogPhase("review");
    } catch {
      toast.error("Chain analysis failed. Please try again.");
      setDialogPhase("closed");
    }
  }, [workspace, chain, graphData, impactNodeMap]);

  const handleConfirmGenerate = useCallback(async () => {
    const countMap = new Map(perFileAnalysis.map((f) => [f.file_path, Math.min(10, Math.max(0, f.requestedCount || 0))]));
    setDialogPhase("closed");
    await handleGenerateTests(countMap);
  }, [perFileAnalysis, handleGenerateTests]);

  const handleDownloadGeneratedTests = useCallback(() => {
    if (!fileTests || fileTests.length === 0) {
      toast.error("No generated tests to download yet.");
      return;
    }

    const content = formatGroupedTestsToSpec(fileTests);
    const filename = "generated-impact.spec.ts";
    const blob = new Blob([content], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success(`Downloaded ${filename}`);
  }, [fileTests]);

  if (!workspace) return null;

  if (impactQuery.isLoading || fallbackGraphQuery.isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground bg-raised">
        <GitBranch className="h-8 w-8 opacity-20 animate-pulse" />
        <p className="text-xs">Building impact chain…</p>
      </div>
    );
  }

  if (!activeTab) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground bg-raised">
        <GitBranch className="h-10 w-10 opacity-15" />
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-ink-tertiary">No file selected</p>
          <p className="text-xs opacity-50">Click a file in the tree on the left</p>
        </div>
      </div>
    );
  }

  const isNotInTree = !!activeTab && !impactNodeMap.has(activeTab) && fallbackChain.length === 0;
  const hasTests = fileTests !== null && fileTests.length > 0;
  const totalTests = fileTests?.reduce((acc, g) => acc + g.tests.length, 0) ?? 0;

  return (
    <div className="h-full flex flex-col min-h-0 bg-container overflow-hidden relative">
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-stroke-muted bg-raised">
        <div className="flex items-center gap-2">
          {onBackToCode && (
            <button
              className="h-6 px-2 rounded border border-stroke-muted text-[10px] text-muted-foreground hover:text-ink hover:bg-raised flex items-center gap-1 flex-shrink-0"
              onClick={onBackToCode}
              title="Back to code view"
            >
              <ArrowLeft className="h-3 w-3" />
              Back
            </button>
          )}
          <GitBranch className="h-3.5 w-3.5 text-ink-quaternary flex-shrink-0" />
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className="text-xs font-semibold text-ink flex-shrink-0">
              Root → Leaf
            </span>
            <div className="flex items-center gap-1 ml-1">
              <button
                type="button"
                className={cn(
                  "h-5 px-2 rounded text-[10px] border transition-colors",
                  flowViewMode === "gephi"
                    ? "border-stroke bg-raised text-primary"
                    : "border-stroke-muted text-muted-foreground hover:text-ink hover:bg-raised",
                )}
                onClick={() => setFlowViewMode("gephi")}
                title="Gephi-style force graph with clusters"
              >
                Gephi
              </button>
              {/* <button
                type="button"
                className={cn(
                  "h-5 px-2 rounded text-[10px] border transition-colors",
                  flowViewMode === "neighborhood"
                    ? "border-stroke bg-raised text-primary"
                    : "border-stroke-muted text-muted-foreground hover:text-ink hover:bg-raised",
                )}
                onClick={() => setFlowViewMode("neighborhood")}
                title="Show nearby dependency flow around selected file"
              >
                Flow
              </button>
              <button
                type="button"
                className={cn(
                  "h-5 px-2 rounded text-[10px] border transition-colors",
                  flowViewMode === "chain"
                    ? "border-stroke bg-raised text-primary"
                    : "border-stroke-muted text-muted-foreground hover:text-ink hover:bg-raised",
                )}
                onClick={() => setFlowViewMode("chain")}
                title="Show strict root-to-leaf chain only"
              >
                Chain
              </button> */}
            </div>
            {chain.length > 0 && (
              <span className="text-[10px] text-ink-quaternary bg-raised px-1.5 py-0.5 rounded flex-shrink-0">
                {chain.length} node{chain.length !== 1 ? "s" : ""}
              </span>
            )}
            <ChainBreadcrumb chain={chain} />
          </div>

          {/* Generate button */}
          {chain.length > 0 && !isNotInTree && (
            <button
              className={cn(
                "flex items-center gap-1.5 h-7 px-3 rounded-md text-[11px] font-medium flex-shrink-0 transition-all",
                generatingTests
                  ? "bg-raised text-ink-secondary border border-stroke-muted cursor-wait"
                  : "bg-primary text-primary-foreground hover:bg-primary",
              )}
              onClick={() => void handleOpenAnalysis()}
              disabled={generatingTests}
            >
              {generatingTests ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {generatingFile ? `Generating ${generatingFile}…` : "Generating…"}
                </>
              ) : (
                <>
                  <AiIcon className="h-3 w-3" />
                  Generate Test Cases
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Flow canvas ── */}
      <div className={cn("min-h-0 transition-all duration-300 relative flex-1")}>
        {chain.length === 0 || isNotInTree ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-ink-quaternary p-8">
            <Code2 className="h-8 w-8 opacity-20" />
            <p className="text-xs text-center">
              {isNotInTree
                ? "This file is not part of any changed-root dependency chain."
                : "No impact chain found."}
            </p>
            <p className="text-[10px] text-center opacity-70">
              No dependency path found for the selected file in this workspace graph.
            </p>
          </div>
        ) : (
          flowViewMode === "gephi" ? (
            <GephiSigmaGraph
              focusPath={activeTab}
              nodes={graphData?.nodes ?? []}
              edges={graphData?.edges ?? []}
              changedPaths={changedPathSet}
            />
          ) : (
            <FlowCanvas
              focusPath={activeTab}
              chain={chain}
              graphNodes={graphData?.nodes ?? []}
              graphEdges={graphData?.edges ?? []}
              impactNodeMap={impactNodeMap}
              viewMode={flowViewMode}
            />
          )
        )}

        {/* Global Test Alignment Bottom Panel */}
        <>
          {alignmentPanelOpen && (generatingTests || hasTests) && (
            <div
              className="absolute bottom-4 left-4 right-4 z-[50]"
            >
              <div
                className={cn(
                  "bg-container border border-stroke-muted rounded-lg overflow-hidden flex flex-col border-stroke-muted transition-all duration-300",
                  alignmentPanelExpanded ? "max-h-[calc(100vh-7rem)]" : "max-h-[400px]",
                )}
              >
                <div className="flex items-center justify-between px-4 py-2 bg-raised border-b border-stroke-muted">
                  <div className="flex items-center gap-2">
                    {generatingTests && (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-raised border border-stroke-muted animate-pulse">
                        <Loader2 className="h-2.5 w-2.5 text-primary animate-spin" />
                        <span className="text-[10px] font-bold text-primary uppercase">AI Generating...</span>
                      </div>
                    )}
                    <FlaskConical className="h-4 w-4 text-primary" />
                    <span className="text-sm font-bold tracking-tight">Test Intelligence Alignment</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {fileTests && (
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        className="h-7 text-[10px] text-muted-foreground hover:text-ink"
                        onClick={handleDownloadGeneratedTests}
                      >
                        <Download className="h-3 w-3 mr-1.5" />
                        Download Spec
                      </Button>
                    )}
                    <button 
                      className="p-1 hover:bg-raised rounded-full transition-colors"
                      onClick={() => {
                        setAlignmentPanelOpen(false);
                      }}
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <button
                      className="p-1 hover:bg-raised rounded-full transition-colors"
                      onClick={() => setAlignmentPanelExpanded((v) => !v)}
                      title={alignmentPanelExpanded ? "Collapse panel" : "Expand panel"}
                    >
                      {alignmentPanelExpanded ? (
                        <Minimize2 className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Maximize2 className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-hidden">
                  {generatingTests ? (
                    <div className="h-[240px] flex flex-col items-center justify-center space-y-4 bg-raised border border-dashed border-stroke-muted rounded-lg m-4">
                      <div className="relative">
                        <div className="absolute inset-0 bg-raised blur-xl rounded-full animate-pulse" />
                        <Loader2 className="h-10 w-10 text-primary animate-spin relative z-10" />
                      </div>
                      <div className="text-center space-y-1">
                        <p className="text-sm font-bold text-ink tracking-tight">AI Engineering Contextual Tests...</p>
                        <p className="text-[10px] text-muted-foreground animate-pulse">Analyzing dependency impact for {activeTab}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 space-y-4">
                      {/* Session-Only Focused Preview */}
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-stroke-muted pb-2">
                          <div className="flex items-center gap-2">
                            <AiIcon className="h-4 w-4 text-primary" />
                            <span className="text-sm font-bold tracking-tight">Generated Session Coverage</span>
                          </div>
                          <Badge variant="outline" className="bg-raised text-primary border-stroke-muted font-bold px-2">
                            {fileTests?.reduce((s, g) => s + g.tests.length, 0) || 0} Tests Ready
                          </Badge>
                        </div>

                        {!fileTests || fileTests.length === 0 ? (
                          <div className="py-16 text-center rounded-lg border border-dashed border-stroke-muted bg-raised space-y-2">
                            <FlaskConical className="h-8 w-8 text-ink-quaternary mx-auto" />
                            <p className="text-xs text-muted-foreground italic">No tests generated for this session yet.</p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="grid grid-cols-1 gap-3 max-h-[300px] overflow-auto pr-2 scrollbar-thin">
                              {fileTests.map((group) => (
                                <div key={group.filePath} className="rounded-lg border border-stroke-muted bg-container p-3 space-y-2.5 hover:border-stroke-muted transition-all">
                                  <div className="flex items-center gap-2 mb-1">
                                    <FileCode className="h-3.5 w-3.5 text-info" />
                                    <span className="text-[11px] font-mono font-bold text-ink truncate flex-1">{group.filePath}</span>
                                    <Badge className="text-[10px] h-4 px-1.5 bg-raised text-muted-foreground">{group.tests.length}</Badge>
                                  </div>
                                  <div className="grid grid-cols-1 gap-1.5">
                                    {group.tests.map((test) => (
                                      <div key={test.id} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-container border border-stroke-muted group hover:border-stroke-muted transition-colors">
                                        <div className="w-1.5 h-1.5 rounded-full bg-raised group-hover:bg-primary transition-colors" />
                                        <span className="text-[11px] text-ink truncate flex-1">{test.name}</span>
                                        <Badge variant="outline" className="text-[10px] h-3.5 px-1.5 opacity-60 font-medium">
                                          {test.severity.slice(0, 3)}
                                        </Badge>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <Button 
                              className="w-full h-11 text-xs bg-primary hover:bg-primary text-primary-foreground font-bold rounded-lg"
                              onClick={async () => {
                                if (!workspace?.repo_url || !fileTests) return;
                                try {
                                  const repoId = await api.getRepoId(workspace.repo_url);
                                  const allTests = fileTests.flatMap(g => g.tests).map(t => ({
                                    test_id: t.id,
                                    name: t.name,
                                    description: t.description,
                                    category: "ui_component",
                                    page_path: t.page_name || "/",
                                    severity: t.severity,
                                    steps: t.steps.map(s => ({
                                      action: s.action,
                                      target: s.selector || "",
                                      value: s.value || "",
                                      assertion: s.description || ""
                                    }))
                                  } as any));
                                  const res = await baselineApi.syncTests(repoId, allTests, "workspace");
                                  toast.success(`Synced ${res.added_count} tests to repository baseline!`);
                                  setFileTests(null);
                                } catch (err) {
                                  toast.error("Failed to sync tests");
                                }
                              }}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Promote & Sync All Session Tests to Repo Baseline
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {!alignmentPanelOpen && (generatingTests || hasTests) && (
            <button
              type="button"
              className="absolute bottom-4 left-4 z-[50] inline-flex items-center gap-2 rounded-full border border-stroke-muted bg-container px-3 py-2 text-[11px] font-semibold text-ink hover:border-stroke hover:bg-container"
              onClick={() => setAlignmentPanelOpen(true)}
            >
              <AiIcon className="h-3.5 w-3.5 text-primary" />
              Test Intelligence Alignment
              <span className="rounded-full bg-raised px-2 py-0.5 text-[10px] text-primary">
                {fileTests?.reduce((s, g) => s + g.tests.length, 0) || baselineTests.length} ready
              </span>
            </button>
          )}
        </>
      </div>

      <Dialog open={dialogPhase !== "closed"} onOpenChange={(open) => { if (!open) setDialogPhase("closed"); }}>
        <DialogContent className="max-w-md">
          {dialogPhase === "analyzing" ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">Analysing Files…</DialogTitle>
                <DialogDescription>
                  Inspecting each file in the root→leaf chain to suggest test counts.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-ink-tertiary" />
                <p className="text-xs text-muted-foreground">
                  AI is analysing {chain.length} file{chain.length !== 1 ? "s" : ""}…
                </p>
                <p className="text-[10px] text-ink-quaternary text-center max-w-xs">
                  Reading each file and determining how many tests each one needs
                </p>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">Test Count Analysis</DialogTitle>
                <DialogDescription>
                  Suggested counts based on change impact. Adjust per file, then generate.
                </DialogDescription>
              </DialogHeader>

              {/* Summary badge */}
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-raised rounded-md px-3 py-2 border border-stroke-muted">
                <FlaskConical className="h-3.5 w-3.5 text-ink-tertiary flex-shrink-0" />
                <span>
                  <span className="font-semibold text-ink">{perFileAnalysis.length} file{perFileAnalysis.length !== 1 ? "s" : ""}</span>
                  {" · "}
                  <span className="font-semibold text-ink">
                    {perFileAnalysis.reduce((s, f) => s + Math.max(0, f.requestedCount), 0)} tests
                  </span>
                  {" total"}
                </span>
              </div>

              {/* Per-file rows */}
              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {perFileAnalysis.map((f, idx) => {
                  const fileName = f.file_path.split("/").pop() ?? f.file_path;
                  return (
                    <div
                      key={f.file_path}
                      className="rounded-lg border border-stroke-muted bg-raised px-3 py-2.5 space-y-1.5"
                    >
                      {/* Top row: index, icon, name, badges, stepper */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-ink-quaternary font-mono w-4 text-right flex-shrink-0">
                          {idx + 1}
                        </span>
                        <FileCode className="h-3.5 w-3.5 text-info flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-mono font-semibold text-ink truncate">{fileName}</p>
                          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                            {f.isRoot && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-raised-2 text-ink-quaternary border border-stroke-muted">
                                Root
                              </span>
                            )}
                            {f.isLeaf && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--color-warning-bg)] text-[var(--color-warning)] border border-[var(--color-status-warning)]/30">
                                Leaf
                              </span>
                            )}
                            {!f.isRoot && !f.isLeaf && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-raised text-info border border-stroke-muted">
                                Mid
                              </span>
                            )}
                          </div>
                        </div>
                        {/* stepper */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setPerFileAnalysis((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, requestedCount: Math.max(0, x.requestedCount - 1) } : x,
                                ),
                              )
                            }
                            className="h-6 w-6 rounded border border-border/60 bg-raised text-sm font-bold text-ink hover:bg-raised flex items-center justify-center"
                          >
                            −
                          </button>
                          <span className="w-5 text-center text-sm font-semibold tabular-nums">
                            {f.requestedCount}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setPerFileAnalysis((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, requestedCount: Math.min(10, x.requestedCount + 1) } : x,
                                ),
                              )
                            }
                            className="h-6 w-6 rounded border border-border/60 bg-raised text-sm font-bold text-ink hover:bg-raised flex items-center justify-center"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* AI analysis text */}
                      <div className="pl-5 space-y-1">
                        <p className="text-[11px] text-ink-secondary leading-snug">
                          {f.changes_description}
                        </p>
                        <p className="text-[10px] text-ink-quaternary italic leading-snug">
                          {f.reason}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <DialogFooter>
                <button
                  type="button"
                  className="h-9 px-3 rounded-md border border-stroke-muted text-sm text-muted-foreground hover:text-ink hover:bg-raised"
                  onClick={() => setDialogPhase("closed")}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary flex items-center gap-1.5"
                  onClick={() => void handleConfirmGenerate()}
                  disabled={perFileAnalysis.every((f) => f.requestedCount === 0)}
                >
                  <AiIcon className="h-3.5 w-3.5" />
                  Generate {perFileAnalysis.reduce((s, f) => s + Math.max(0, f.requestedCount), 0)} Tests
                </button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
