import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const managerSidebarStyles = stylesheet.slice(
  stylesheet.lastIndexOf("  .manager-sidebar {"),
  stylesheet.lastIndexOf("  .manager-workspace {")
);

describe("manager sidebar typography", () => {
  it("increases every sidebar text level by ten percent", () => {
    expect(managerSidebarStyles).toContain(".manager-sidebar__brand .brand__wordmark strong { font-size: 19.8px; }");
    expect(managerSidebarStyles).toContain("font: 700 9.9px var(--font-display);");
    expect(managerSidebarStyles).toContain(".organization-switcher strong { overflow: hidden; font-size: 9.9px;");
    expect(managerSidebarStyles).toContain(".organization-switcher small { margin-top: 2px; color: rgba(255,255,255,.43); font-size: 7.7px;");
    expect(managerSidebarStyles).toContain(".manager-nav__label { padding: 0 10px 6px; color: rgba(255,255,255,.28); font-size: 7.7px;");
    expect(managerSidebarStyles).toContain(".manager-nav > a { position: relative; display: flex; align-items: center; gap: 10px; min-height: 39px; padding: 0 10px; border-radius: 9px; color: rgba(255,255,255,.55); font-size: 11px;");
    expect(managerSidebarStyles).toContain(".manager-nav__group > a { position: relative; display: flex; align-items: center; gap: 10px; min-height: 39px; padding: 0 10px; border-radius: 9px; color: rgba(255,255,255,.55); font-size: 11px;");
    expect(managerSidebarStyles).toContain(".manager-nav__subnav a { padding: 5px 7px; border-radius: 7px; color: rgba(255,255,255,.48); font-size: 8.8px;");
    expect(managerSidebarStyles).toContain(".manager-profile strong { overflow: hidden; font-size: 8.8px;");
    expect(managerSidebarStyles).toContain(".manager-profile small { margin-top: 2px; color: rgba(255,255,255,.38); font-size: 7.7px;");
  });
});
