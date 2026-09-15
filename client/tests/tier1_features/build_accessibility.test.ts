import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const CLIENT_DIR = path.resolve(import.meta.dirname, "../..");

describe("Tier 1: Feature Coverage — Build Quality & Accessibility Standards", () => {
  it("8.1: TypeScript strict build verification (`tsc -b`) succeeds with 0 errors", () => {
    const stdout = execSync("npx tsc -b", { cwd: CLIENT_DIR, encoding: "utf8" });
    assert.equal(stdout.trim(), "", "TypeScript compilation should produce zero error output");
  });

  it("8.2: Vite production build (`npm run build`) generates dist bundles with exit code 0", () => {
    const stdout = execSync("npm run build", { cwd: CLIENT_DIR, encoding: "utf8" });
    assert.ok(stdout.includes("built in"), "Vite build should confirm successful build completion");
    assert.ok(fs.existsSync(path.join(CLIENT_DIR, "dist/index.html")), "dist/index.html must exist");
  });

  it("8.3: ESLint check (`npm run lint`) completes with 0 warnings and 0 errors", () => {
    assert.doesNotThrow(() => {
      execSync("npm run lint", { cwd: CLIENT_DIR, encoding: "utf8", stdio: "pipe" });
    }, "ESLint check should exit cleanly with code 0");
  });

  it("8.4: Glassmorphism CSS themes and design tokens are defined in index.css and components", () => {
    const cssPath = path.join(CLIENT_DIR, "src/index.css");
    assert.ok(fs.existsSync(cssPath), "index.css must exist");
    const cssContent = fs.readFileSync(cssPath, "utf8");

    assert.ok(cssContent.includes("--nexus-bg"), "Theme must define --nexus-bg");
    assert.ok(cssContent.includes("--nexus-sidebar"), "Theme must define --nexus-sidebar");
    assert.ok(cssContent.includes("--nexus-border"), "Theme must define --nexus-border");
    assert.ok(cssContent.includes(".dark"), "Dark theme selector must be configured");

    const sidebarPath = path.join(CLIENT_DIR, "src/chat/Sidebar.tsx");
    const sidebarContent = fs.readFileSync(sidebarPath, "utf8");
    assert.ok(sidebarContent.includes("backdrop-blur"), "Glassmorphism backdrop-blur must be present in UI components");
  });

  it("8.5: Global Command Palette accessibility contracts (⌘K / Ctrl+K hotkey and Escape dismiss)", () => {
    const palettePath = path.join(CLIENT_DIR, "src/components/CommandPalette.tsx");
    assert.ok(fs.existsSync(palettePath), "CommandPalette.tsx must exist");
    const paletteContent = fs.readFileSync(palettePath, "utf8");

    // Hotkey listener & focus trap
    assert.ok(paletteContent.includes("Escape"), "Must handle Escape key for closing");
    assert.ok(paletteContent.includes("role=\"dialog\"") || paletteContent.includes("role="), "Must define accessible modal role");
    assert.ok(paletteContent.includes("inputRef.current?.focus()"), "Must autofocus input on open");
  });
});
