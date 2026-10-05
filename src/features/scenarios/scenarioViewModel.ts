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

function describeDependencyChanges(
  before: RequestNode,
  after: RequestNode,
  baselineNodes: Map<string, RequestNode>,
  comparisonNodes: Map<string, RequestNode>,
): string[] {
  const baselineDependencies = new Set(before.dependencyIds);
  const comparisonDependencies = new Set(after.dependencyIds);
  const changes: string[] = [];
  const addedLine = (dependencyId: string): string => {
    const target = comparisonNodes.get(dependencyId);
    if (!baselineNodes.has(dependencyId))
      return `${before.name} · 新增前置依赖：${target ? target.name : dependencyId}（该节点在基准方案中不存在）`;
    const surviving = target ?? baselineNodes.get(dependencyId);
    return surviving
      ? `${before.name} · 新增前置依赖：${surviving.name}`
      : `${before.name} · 新增前置依赖：已删除节点（${dependencyId}）`;
  };
  const removedLine = (dependencyId: string): string => {
    const target = baselineNodes.get(dependencyId);
    if (!comparisonNodes.has(dependencyId))
      return `${before.name} · 移除前置依赖：${target ? target.name : dependencyId}（该节点在对照方案中不存在）`;
    const surviving = target ?? comparisonNodes.get(dependencyId);
    return surviving
      ? `${before.name} · 移除前置依赖：${surviving.name}`
      : `${before.name} · 移除前置依赖：已删除节点（${dependencyId}）`;
  };
  // 依赖按集合比较：取消勾选再重新勾上只改变数组顺序，集合不变，不算变化。
  for (const dependencyId of new Set(after.dependencyIds)) {
    if (!baselineDependencies.has(dependencyId))
      changes.push(addedLine(dependencyId));
  }
  for (const dependencyId of new Set(before.dependencyIds)) {
    if (!comparisonDependencies.has(dependencyId))
      changes.push(removedLine(dependencyId));
  }
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
    changes.push(`节点改名：${before.name} → ${after.name}`);
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
