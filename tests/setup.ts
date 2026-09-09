import { expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

// Register for each environment, including mixed Node/PostgreSQL and jsdom runs.
expect.extend(matchers);
