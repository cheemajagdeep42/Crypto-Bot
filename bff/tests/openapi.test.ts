import { describe, expect, it } from "vitest";
import { openApiSpec } from "../src/openapi";

describe("OpenAPI spec", () => {
    it("contains critical production endpoints", () => {
        expect(openApiSpec.paths["/api/bot/state"]).toBeDefined();
        expect(openApiSpec.paths["/api/bot/config"]).toBeDefined();
        expect(openApiSpec.paths["/api/bot/preview-scan"]).toBeDefined();
        expect(openApiSpec.paths["/api/bot/add-dex-token"]).toBeDefined();
        expect(openApiSpec.paths["/api/trading/jupiter-quote"]).toBeDefined();
        expect(openApiSpec.paths["/api/trading/jupiter-swap-tx"]).toBeDefined();
    });
});

