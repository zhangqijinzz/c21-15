import { describe, expect, it } from "vitest";
import {
  createProject,
  duplicateProject,
  selectProject,
} from "../src/features/projects/projectViewModel";
import {
  compareScenarios,
  restoreScenario,
  saveScenario,
} from "../src/features/scenarios/scenarioViewModel";
import { simulateProject } from "../src/shared/domain/simulation";
import type { RequestNode, ScenarioSnapshot } from "../src/shared/domain/types";
import { EXAMPLE_PROJECT } from "../src/shared/domain/types";

describe("project and scenario view models", () => {
  it("creates a project and switches the active project", () => {
    const initial = {
      version: 1 as const,
      activeProjectId: EXAMPLE_PROJECT.id,
      projects: [EXAMPLE_PROJECT],
    };
    const created = createProject(initial, 100);
    expect(created.projects).toHaveLength(2);
    expect(created.activeProjectId).not.toBe(EXAMPLE_PROJECT.id);
    expect(selectProject(created, EXAMPLE_PROJECT.id).activeProjectId).toBe(
      EXAMPLE_PROJECT.id,
    );
  });

  it("duplicates a project and remaps its dependency identities", () => {
    const initial = {
      version: 1 as const,
      activeProjectId: EXAMPLE_PROJECT.id,
      projects: [EXAMPLE_PROJECT],
    };
    const duplicated = duplicateProject(initial, EXAMPLE_PROJECT, 10);
    const copy = duplicated.projects[0];
    expect(copy?.nodes[2]?.dependencyIds).toEqual([copy?.nodes[0]?.id]);
    expect(copy?.nodes[4]?.fallbackNodeId).toBe(copy?.nodes[3]?.id);
    expect(copy?.id).not.toBe(EXAMPLE_PROJECT.id);
    expect(copy?.scenarios).toEqual([]);
  });

  it("saves a complete snapshot and restores its parameters", () => {
    const baseline = {
      ...EXAMPLE_PROJECT,
      nodes: EXAMPLE_PROJECT.nodes.slice(0, 2),
    };
    const result = simulateProject(baseline);
    const saved = saveScenario(baseline, result, "并发方案");
    expect(saved.scenarios).toHaveLength(1);
    const changed = {
      ...saved,
      nodes: saved.nodes.map((node) => ({ ...node, durationMs: 999 })),
    };
    const restored = restoreScenario(changed, saved.scenarios[0]?.id ?? "");
    expect(restored.nodes[0]?.durationMs).toBe(baseline.nodes[0]?.durationMs);
  });

  it("describes node and concurrency differences between snapshots", () => {
    const baseline = {
      ...EXAMPLE_PROJECT,
      nodes: EXAMPLE_PROJECT.nodes.slice(0, 2),
    };
    const baselineSnapshot = saveScenario(
      baseline,
      simulateProject(baseline),
      "不限并发",
    ).scenarios[0];
    const changed = {
      ...baseline,
      concurrencyLimit: 1,
      nodes: baseline.nodes.map((node, index) =>
        index === 0 ? { ...node, durationMs: 900 } : node,
      ),
    };
    const changedSnapshot = saveScenario(
      changed,
      simulateProject(changed),
      "串行优化",
    ).scenarios[0];
    if (!baselineSnapshot || !changedSnapshot)
      throw new Error("Scenario fixtures should be saved");
    const comparison = compareScenarios(baselineSnapshot, changedSnapshot);
    expect(comparison.deltaMs).toBeGreaterThan(0);
    expect(comparison.changes.join(" ")).toContain("并发上限");
    expect(comparison.changes.join(" ")).toContain("耗时");
  });
});

function testNode(
  id: string,
  name: string,
  dependencyIds: string[] = [],
): RequestNode {
  return {
    id,
    name,
    durationMs: 100,
    jitterMs: 0,
    dependencyIds,
    timeoutMs: 1000,
    retryCount: 0,
    failureRate: 0,
  };
}

function testSnapshot(
  name: string,
  nodes: RequestNode[],
  completionMs = 100,
): ScenarioSnapshot {
  return {
    id: `snapshot-${name}`,
    name,
    createdAt: 0,
    concurrencyLimit: null,
    nodes,
    completionMs,
    criticalPath: [],
  };
}

describe("semantic scenario comparison", () => {
  it("reports a renamed node", () => {
    const baseline = testSnapshot("a", [testNode("n1", "旧名称")]);
    const comparison = testSnapshot("b", [testNode("n1", "新名称")]);
    const result = compareScenarios(baseline, comparison);
    expect(result.changes).toContain("旧名称 · 名称改为「新名称」");
  });

  it("ignores dependency order when the dependency set is unchanged", () => {
    const baseline = testSnapshot("a", [
      testNode("dep1", "依赖甲"),
      testNode("dep2", "依赖乙"),
      testNode("node", "主节点", ["dep1", "dep2"]),
    ]);
    // 取消勾选再重新勾上：集合相同，仅数组顺序变化
    const comparison = testSnapshot("b", [
      testNode("dep1", "依赖甲"),
      testNode("dep2", "依赖乙"),
      testNode("node", "主节点", ["dep2", "dep1"]),
    ]);
    const result = compareScenarios(baseline, comparison);
    expect(result.changes).toEqual([]);
  });

  it("distinguishes added from removed dependencies", () => {
    const baseline = testSnapshot("a", [
      testNode("dep1", "依赖甲"),
      testNode("dep2", "依赖乙"),
      testNode("node", "主节点", ["dep1"]),
    ]);
    const comparison = testSnapshot("b", [
      testNode("dep1", "依赖甲"),
      testNode("dep2", "依赖乙"),
      testNode("node", "主节点", ["dep2"]),
    ]);
    const result = compareScenarios(baseline, comparison);
    expect(result.changes).toContain("主节点 · 新增前置依赖「依赖乙」");
    expect(result.changes).toContain("主节点 · 移除前置依赖「依赖甲」");
  });

  it("says which side is missing when a dependency points to an absent node", () => {
    const baseline = testSnapshot("a", [
      testNode("dep", "只在基准里的节点"),
      testNode("node", "主节点", ["dep"]),
    ]);
    // 对照方案新增了 dep2 节点，主节点改为依赖它；dep 节点被移除
    const comparison = testSnapshot("b", [
      testNode("dep2", "只在对照里的节点"),
      testNode("node", "主节点", ["dep2"]),
    ]);
    const result = compareScenarios(baseline, comparison);
    expect(result.changes).toContain(
      "主节点 · 新增前置依赖「只在对照里的节点」（该节点在基准方案中不存在）",
    );
    expect(result.changes).toContain(
      "主节点 · 移除前置依赖「只在基准里的节点」（该节点在对照方案中不存在）",
    );
    expect(result.changes).toContain("只在基准里的节点 · 已从对照方案移除");
    expect(result.changes).toContain("只在对照里的节点 · 新增请求节点");
  });
});
