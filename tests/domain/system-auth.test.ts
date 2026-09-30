import { describe, expect, it } from "vitest";
import {
  resolveSystemAuthDestination,
  resolveSystemAuthMode,
  systemLoginHref,
} from "@/lib/system-auth";

describe("system auth navigation", () => {
  it("maps public modes and defaults unknown values to sign in", () => {
    expect(resolveSystemAuthMode("cadastro")).toBe("signup");
    expect(resolveSystemAuthMode("login")).toBe("signin");
    expect(resolveSystemAuthMode(["cadastro", "login"])).toBe("signin");
    expect(resolveSystemAuthMode("admin")).toBe("signin");
  });

  it("allows only protected system destinations", () => {
    expect(resolveSystemAuthDestination("/display-admin")).toBe("/display-admin");
    expect(resolveSystemAuthDestination("/admin")).toBe("/gestor");
    expect(resolveSystemAuthDestination("/regularizacao")).toBe("/regularizacao");
    expect(resolveSystemAuthDestination("https://evil.example")).toBe("/gestor");
    expect(resolveSystemAuthDestination(["/display-admin", "/gestor"])).toBe("/gestor");
  });

  it("builds stable login and signup URLs", () => {
    expect(systemLoginHref("signin", "/gestor")).toBe("/los-barberos/entrar?modo=login");
    expect(systemLoginHref("signup", "/display-admin")).toBe(
      "/los-barberos/entrar?modo=cadastro&next=%2Fdisplay-admin",
    );
    expect(systemLoginHref("signin", "/gestor", "music-pro")).toBe("/music-pro/entrar?modo=login");
  });
});
