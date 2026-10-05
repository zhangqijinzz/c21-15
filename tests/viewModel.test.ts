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
import {
  EXAMPLE_PROJECT,
  type RequestNode,
  type ScenarioSnapshot,
} from "../src/shared/domain/types";

function makeSnapshot(
  name: string,
  nodes: RequestNode[],
  completionMs = 1000,
): ScenarioSnapshot {
  return {
    id: `snapshot-${name}`,
    name,
    createdAt: 1000,
    concurrencyLimit: null,
    nodes: structuredClone(nodes),
    completionMs,
    criticalPath: [],
  };
}

function makeNode(
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
    timeoutMs: 500,
    retryCount: 0,
    failureRate: 0,
  };
}

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

  it("reports a node rename as a semantic change", () => {
    const nodes = [makeNode("a", "会话校验"), makeNode("b", "功能开关")];
    const renamed = nodes.map((node) =>
      node.id === "a" ? { ...node, name: "登录校验" } : node,
    );
    const comparison = compareScenarios(
      makeSnapshot("基准", nodes),
      makeSnapshot("对照", renamed),
    );
    expect(comparison.changes).toContain("节点改名：会话校验 → 登录校验");
  });

  it("does not report a dependency change when only the order differs", () => {
    const baseline = makeSnapshot("基准", [
      makeNode("a", "会话校验"),
      makeNode("b", "功能开关"),
      makeNode("c", "资料", ["a", "b"]),
    ]);
    const reordered = makeSnapshot("对照", [
      makeNode("a", "会话校验"),
      makeNode("b", "功能开关"),
      makeNode("c", "资料", ["b", "a"]),
    ]);
    const comparison = compareScenarios(baseline, reordered);
    expect(
      comparison.changes.filter((change) => change.includes("前置依赖")),
    ).toEqual([]);
    expect(comparison.changes).toEqual([]);
  });

  it("reports real dependency additions and removals by target name", () => {
    const baseline = makeSnapshot("基准", [
      makeNode("a", "会话校验"),
      makeNode("b", "功能开关"),
      makeNode("c", "资料", ["a"]),
    ]);
    const modified = makeSnapshot("对照", [
      makeNode("a", "会话校验"),
      makeNode("b", "功能开关"),
      makeNode("c", "资料", ["b"]),
    ]);
    const comparison = compareScenarios(baseline, modified);
    expect(comparison.changes).toContain("资料 · 新增前置依赖：功能开关");
    expect(comparison.changes).toContain("资料 · 移除前置依赖：会话校验");
  });

  it("explains dependency edges whose target node is missing in the other snapshot", () => {
    const baseline = makeSnapshot("基准", [
      makeNode("a", "会话校验"),
      makeNode("b", "功能开关"),
      makeNode("c", "资料", ["a"]),
    ]);
    // 对照方案新增节点 d，c 改依赖 d（对已被移除节点 a 的连线一并消失）。
    const modified = makeSnapshot("对照", [
      makeNode("b", "功能开关"),
      makeNode("c", "资料", ["d"]),
      makeNode("d", "个性推荐"),
    ]);
    const comparison = compareScenarios(baseline, modified);
    expect(comparison.changes).toContain(
      "资料 · 新增前置依赖：个性推荐（该节点在基准方案中不存在）",
    );
    expect(comparison.changes).toContain(
      "资料 · 移除前置依赖：会话校验（该节点在对照方案中不存在）",
    );
  });
});
