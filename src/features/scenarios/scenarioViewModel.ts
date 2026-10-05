import type {
  LatencyProject,
  RequestNode,
  ScenarioSnapshot,
  SimulationResult,
} from "../../shared/domain/types";

export interface ScenarioComparison {
  deltaMs: number;
  changes: string[];
  outcome: "faster" | "slower" | "equal";
}

function dependencyLabel(
  id: string,
  sideNodes: Map<string, RequestNode>,
  otherNodes: Map<string, RequestNode>,
  missingInOtherSide: string,
): string {
  const node = sideNodes.get(id);
  if (!node) return `「未知节点 ${id}」`;
  const note = otherNodes.has(id)
    ? ""
    : `（该节点在${missingInOtherSide}中不存在）`;
  return `「${node.name}」${note}`;
}

function describeDependencyChanges(
  before: RequestNode,
  after: RequestNode,
  baselineNodes: Map<string, RequestNode>,
  comparisonNodes: Map<string, RequestNode>,
): string[] {
  const baselineDeps = new Set(before.dependencyIds);
  const comparisonDeps = new Set(after.dependencyIds);
  const changes: string[] = [];
  // 依赖是集合语义：仅顺序变化（如取消勾选后重新勾上）不算改动，
  // 只有真正新增或移除某个依赖才报告。
  after.dependencyIds.forEach((id) => {
    if (baselineDeps.has(id)) return;
    changes.push(
      `${before.name} · 新增前置依赖${dependencyLabel(
        id,
        comparisonNodes,
        baselineNodes,
        "基准方案",
      )}`,
    );
  });
  before.dependencyIds.forEach((id) => {
    if (comparisonDeps.has(id)) return;
    changes.push(
      `${before.name} · 移除前置依赖${dependencyLabel(
        id,
        baselineNodes,
        comparisonNodes,
        "对照方案",
      )}`,
    );
  });
  return changes;
}

function describeNodeChanges(
  before: RequestNode,
  after: RequestNode,
  baselineNodes: Map<string, RequestNode>,
  comparisonNodes: Map<string, RequestNode>,
): string[] {
  const changes: string[] = [];
  if (before.name !== after.name)
    changes.push(`${before.name} · 名称改为「${after.name}」`);
  if (before.durationMs !== after.durationMs)
    changes.push(
      `${before.name} · 耗时 ${before.durationMs} → ${after.durationMs} ms`,
    );
  if (before.jitterMs !== after.jitterMs)
    changes.push(
      `${before.name} · 波动 ±${before.jitterMs} → ±${after.jitterMs} ms`,
    );
  if (before.timeoutMs !== after.timeoutMs)
    changes.push(
      `${before.name} · 超时 ${before.timeoutMs} → ${after.timeoutMs} ms`,
    );
  if (before.retryCount !== after.retryCount)
    changes.push(
      `${before.name} · 重试 ${before.retryCount} → ${after.retryCount} 次`,
    );
  if (before.failureRate !== after.failureRate)
    changes.push(
      `${before.name} · 失败率 ${before.failureRate} → ${after.failureRate}%`,
    );
  if (before.fallbackNodeId !== after.fallbackNodeId)
    changes.push(`${before.name} · 降级目标已调整`);
  changes.push(
    ...describeDependencyChanges(before, after, baselineNodes, comparisonNodes),
  );
  return changes;
}

export function compareScenarios(
  baseline: ScenarioSnapshot,
  comparison: ScenarioSnapshot,
): ScenarioComparison {
  const baselineNodes = new Map(baseline.nodes.map((node) => [node.id, node]));
  const comparisonNodes = new Map(
    comparison.nodes.map((node) => [node.id, node]),
  );
  const changes = [
    ...baseline.nodes.flatMap((node) => {
      const next = comparisonNodes.get(node.id);
      return next
        ? describeNodeChanges(node, next, baselineNodes, comparisonNodes)
        : [`${node.name} · 已从对照方案移除`];
    }),
    ...comparison.nodes
      .filter((node) => !baselineNodes.has(node.id))
      .map((node) => `${node.name} · 新增请求节点`),
  ];
  if (baseline.concurrencyLimit !== comparison.concurrencyLimit)
    changes.unshift(
      `并发上限 · ${baseline.concurrencyLimit ?? "不限"} → ${comparison.concurrencyLimit ?? "不限"}`,
    );
  return {
    deltaMs: comparison.completionMs - baseline.completionMs,
    changes,
    outcome:
      comparison.completionMs < baseline.completionMs
        ? "faster"
        : comparison.completionMs > baseline.completionMs
          ? "slower"
          : "equal",
  };
}

export function saveScenario(
  project: LatencyProject,
  result: SimulationResult,
  name: string,
): LatencyProject {
  if (
    result.warnings.some(
      (warning) => warning.includes("检测到循环") || warning.includes("不能"),
    )
  )
    return project;
  const snapshot: ScenarioSnapshot = {
    id: crypto.randomUUID(),
    name: name.trim() || `方案 ${project.scenarios.length + 1}`,
    createdAt: Date.now(),
    concurrencyLimit: project.concurrencyLimit,
    nodes: structuredClone(project.nodes),
    completionMs: result.completionMs,
    criticalPath: [...result.criticalPath],
  };
  return {
    ...project,
    scenarios: [snapshot, ...project.scenarios],
    updatedAt: Date.now(),
  };
}

export function removeScenario(
  project: LatencyProject,
  scenarioId: string,
): LatencyProject {
  return {
    ...project,
    scenarios: project.scenarios.filter(
      (scenario) => scenario.id !== scenarioId,
    ),
    updatedAt: Date.now(),
  };
}

export function restoreScenario(
  project: LatencyProject,
  scenarioId: string,
): LatencyProject {
  const snapshot = project.scenarios.find(
    (scenario) => scenario.id === scenarioId,
  );
  if (!snapshot) return project;
  return {
    ...project,
    nodes: structuredClone(snapshot.nodes),
    concurrencyLimit: snapshot.concurrencyLimit,
    updatedAt: Date.now(),
  };
}
