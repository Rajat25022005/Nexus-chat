import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

interface TestSuiteResult {
  file: string;
  tier: string;
  passed: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

const TESTS_ROOT = path.resolve(import.meta.dirname);

const OPAQUE_BOX_SUITES: { tier: string; relativePath: string }[] = [
  // Tier 1: Core Feature Coverage
  { tier: "Tier 1: Feature Parity", relativePath: "tier1_features/user_discovery.test.ts" },
  { tier: "Tier 1: Feature Parity", relativePath: "tier1_features/direct_chats.test.ts" },
  { tier: "Tier 1: Feature Parity", relativePath: "tier1_features/s3_attachments.test.ts" },
  { tier: "Tier 1: Feature Parity", relativePath: "tier1_features/workspace_invites.test.ts" },
  { tier: "Tier 1: Feature Parity", relativePath: "tier1_features/socket_auth_handshake.test.ts" },
  { tier: "Tier 1: Feature Parity", relativePath: "tier1_features/socket_outbound_events.test.ts" },
  { tier: "Tier 1: Feature Parity", relativePath: "tier1_features/socket_inbound_listeners.test.ts" },

  // Tier 2: Boundary & Limits
  { tier: "Tier 2: Boundaries", relativePath: "tier2_boundaries/empty_whitespace_inputs.test.ts" },
  { tier: "Tier 2: Boundaries", relativePath: "tier2_boundaries/storage_limits.test.ts" },
  { tier: "Tier 2: Boundaries", relativePath: "tier2_boundaries/token_lifecycle_disconnects.test.ts" },
  { tier: "Tier 2: Boundaries", relativePath: "tier2_boundaries/rapid_event_bursts.test.ts" },

  // Tier 3: Pairwise Cross-Feature Flows
  { tier: "Tier 3: Cross-Feature", relativePath: "tier3_cross_feature/search_to_direct_chat_flow.test.ts" },
  { tier: "Tier 3: Cross-Feature", relativePath: "tier3_cross_feature/direct_chat_messaging_attachment_flow.test.ts" },
  { tier: "Tier 3: Cross-Feature", relativePath: "tier3_cross_feature/message_thread_reaction_flow.test.ts" },
  { tier: "Tier 3: Cross-Feature", relativePath: "tier3_cross_feature/workspace_invite_to_group_chat_flow.test.ts" },

  // Tier 4: Real-World Collaboration
  { tier: "Tier 4: Real-World", relativePath: "tier4_real_world/multi_user_conference.test.ts" },
  { tier: "Tier 4: Real-World", relativePath: "tier4_real_world/ai_copilot_collaboration.test.ts" },
  { tier: "Tier 4: Real-World", relativePath: "tier4_real_world/multi_channel_switching.test.ts" },

  // Tier 5: Adversarial & Security
  { tier: "Tier 5: Adversarial", relativePath: "tier5_adversarial/malformed_socket_payloads.test.ts" },
  { tier: "Tier 5: Adversarial", relativePath: "tier5_adversarial/race_conditions_and_conflict_resolution.test.ts" },
  { tier: "Tier 5: Adversarial", relativePath: "tier5_adversarial/injection_and_tampering.test.ts" },
];

const BUILD_SUITES: { tier: string; relativePath: string }[] = [
  { tier: "Tier 1: Build & A11y", relativePath: "tier1_features/build_accessibility.test.ts" },
];

function runTestFile(relativePath: string, tier: string): TestSuiteResult {
  const fullPath = path.join(TESTS_ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    return {
      file: relativePath,
      tier,
      passed: false,
      durationMs: 0,
      stdout: "",
      stderr: `File not found: ${fullPath}`,
    };
  }

  const start = performance.now();
  const res = spawnSync(process.execPath, [fullPath], {
    cwd: TESTS_ROOT,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  const durationMs = Math.round(performance.now() - start);

  return {
    file: relativePath,
    tier,
    passed: res.status === 0,
    durationMs,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

function parseTestCount(stdout: string): { total: number; passed: number; failed: number } {
  const passMatch = stdout.match(/ℹ pass (\d+)/);
  const failMatch = stdout.match(/ℹ fail (\d+)/);
  const totalMatch = stdout.match(/ℹ tests (\d+)/);

  const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
  const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
  const total = totalMatch ? parseInt(totalMatch[1], 10) : passed + failed;

  return { total, passed, failed };
}

function main() {
  const args = process.argv.slice(2);
  const includeBuild = args.includes("--include-build") || args.includes("--all");
  const tierFilter = args.find((a) => a.startsWith("--tier="))?.split("=")[1];

  let suitesToRun = [...OPAQUE_BOX_SUITES];
  if (includeBuild) {
    suitesToRun = [...BUILD_SUITES, ...suitesToRun];
  }

  if (tierFilter) {
    suitesToRun = suitesToRun.filter((s) => s.tier.toLowerCase().includes(`tier ${tierFilter}`));
  }

  console.log("================================================================================");
  console.log("            NEXUS CHAT E2E OPAQUE-BOX TEST SUITE RUNNER (GEN 3)                 ");
  console.log("================================================================================");
  console.log(`Discovered ${suitesToRun.length} test suites across Tiers 1 through 5.`);
  console.log(`Include build tests: ${includeBuild ? "YES" : "NO (run with --include-build)"}`);
  console.log("--------------------------------------------------------------------------------\n");

  const results: TestSuiteResult[] = [];
  let currentTier = "";
  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  for (const s of suitesToRun) {
    if (s.tier !== currentTier) {
      currentTier = s.tier;
      console.log(`\n\x1b[1m\x1b[36m▶ [${currentTier.toUpperCase()}]\x1b[0m`);
    }

    const result = runTestFile(s.relativePath, s.tier);
    results.push(result);

    const counts = parseTestCount(result.stdout);
    totalTests += counts.total;
    totalPassed += counts.passed;
    totalFailed += counts.failed;

    if (result.passed) {
      console.log(`  \x1b[32m✔\x1b[0m ${result.file.padEnd(55)} (${counts.passed} tests, ${result.durationMs}ms)`);
    } else {
      console.log(`  \x1b[31m✖\x1b[0m ${result.file.padEnd(55)} (${counts.failed} failed, ${result.durationMs}ms)`);
      if (result.stderr.trim()) {
        console.error(`    \x1b[31mStderr:\x1b[0m ${result.stderr.trim().slice(0, 300)}`);
      }
    }
  }

  console.log("\n================================================================================");
  console.log("                               SUMMARY MATRIX                                   ");
  console.log("================================================================================");

  const tierMap = new Map<string, { suites: number; passedSuites: number; tests: number; duration: number }>();
  for (const r of results) {
    if (!tierMap.has(r.tier)) {
      tierMap.set(r.tier, { suites: 0, passedSuites: 0, tests: 0, duration: 0 });
    }
    const entry = tierMap.get(r.tier)!;
    entry.suites++;
    if (r.passed) entry.passedSuites++;
    entry.tests += parseTestCount(r.stdout).total;
    entry.duration += r.durationMs;
  }

  for (const [tier, data] of tierMap.entries()) {
    const statusStr = data.passedSuites === data.suites ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    console.log(
      ` ${tier.padEnd(30)} | ${data.passedSuites}/${data.suites} suites | ${data.tests.toString().padStart(3)} tests | ${data.duration.toString().padStart(5)}ms | [${statusStr}]`
    );
  }

  console.log("--------------------------------------------------------------------------------");
  const allPassed = results.every((r) => r.passed);
  console.log(`Total Suites: ${results.length} | Passed: ${results.filter((r) => r.passed).length} | Failed: ${results.filter((r) => !r.passed).length}`);
  console.log(`Total Tests:  ${totalTests} | Passed: ${totalPassed} | Failed: ${totalFailed}`);
  console.log(`Final Result: ${allPassed ? "\x1b[32mALL TEST SUITES PASSED (EXIT 0)\x1b[0m" : "\x1b[31mSUITE FAILURES DETECTED (EXIT 1)\x1b[0m"}`);
  console.log("================================================================================\n");

  process.exit(allPassed ? 0 : 1);
}

main();
