import { describe, expect, it } from "vitest";
// `yaml` is vite's own YAML 1.1/1.2 parser (always installed with vitest);
// used here only as an independent, strict reference parser.
import YAML from "yaml";
import { generateOpenApi, yamlString, type OpenApiOperation } from "./openapi";
import { parseOpenApi } from "../impl-verify";

const kv = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;
const env = { SESSIONS: kv };
const BASE = { brand_name: "Acme", domain: "acme.com", category: "Developer Tools", competitors: [], baseline_scan_summary: "x" };
const OPS: OpenApiOperation[] = [
  { method: "get", path: "/pets", summary: "List pets" },
  { method: "post", path: "/pets" },
];
const cc = (...codes: number[]) => String.fromCharCode(...codes);

function strictParse(text: string, version: "1.1" | "1.2") {
  return YAML.parse(text, { strict: true, uniqueKeys: true, prettyErrors: false, version }) as Record<string, any>;
}

describe("generateOpenApi: skipped without operations", () => {
  it("returns null when no operations were found (never an empty paths: {} scaffold)", async () => {
    expect(await generateOpenApi(env, BASE)).toBeNull();
    expect(await generateOpenApi(env, BASE, [])).toBeNull();
    // Unusable entries do not count as operations.
    const junk = [{ method: "fetch", path: "/x" }, { method: "get", path: "x" }] as unknown as OpenApiOperation[];
    expect(await generateOpenApi(env, BASE, junk)).toBeNull();
  });

  it("emits every operation once when there are some", async () => {
    const spec = (await generateOpenApi(env, BASE, [...OPS, OPS[0]]))!;
    const doc = strictParse(spec, "1.2");
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(["/pets"]);
    expect(Object.keys(doc.paths["/pets"])).toEqual(["get", "post"]);
    expect(doc.paths["/pets"].get.summary).toBe("List pets");
    expect(parseOpenApi(spec)?.paths).toEqual({ "/pets": ["get", "post"] });
  });
});

describe("generateOpenApi: customer values are always valid, exact YAML scalars", () => {
  const HOSTILE = [
    "Acme: Pro",
    "Acme #1",
    "Acme # not a comment",
    " #x",
    "- Acme",
    "* Acme",
    "? Acme",
    "&anchor Acme",
    "!tag Acme",
    "{flow: map}",
    "[flow, seq]",
    "%YAML 1.2",
    "@Acme",
    "`Acme`",
    "|",
    ">-",
    "null",
    "true",
    "0x10",
    "",
    "a\"b'c\\d",
    "Line1" + cc(10) + "Line2: x",
    "Tab" + cc(9) + "bed",
    "São Paulo — 東京 🚀 café",
    "NEL" + cc(0x85) + "x",
    "LS" + cc(0x2028) + "PS" + cc(0x2029),
    cc(0xfeff) + "BOM",
    "DEL" + cc(0x7f) + "C0" + cc(1),
    "--- ...",
  ];

  it("parses under YAML 1.2 and 1.1 with the exact brand in info.title, and the checker reads it back", async () => {
    for (const brand of HOSTILE) {
      const spec = (await generateOpenApi(env, { ...BASE, brand_name: brand }, OPS))!;
      for (const v of ["1.2", "1.1"] as const) {
        const doc = strictParse(spec, v);
        expect(doc.info.title, `${JSON.stringify(brand)} under YAML ${v}`).toBe(`${brand} API`);
        expect(doc.servers[0].url).toBe("https://acme.com");
      }
      const p = parseOpenApi(spec);
      expect(p?.title, JSON.stringify(brand)).toBe(`${brand} API`);
      expect(p?.servers).toEqual(["https://acme.com"]);
      expect(p?.paths).toEqual({ "/pets": ["get", "post"] });
    }
  });

  it("hostile operation paths and summaries stay exact", async () => {
    const ops: OpenApiOperation[] = [
      { method: "get", path: "/a: b #c/{id}", summary: "- list: all # of them" + cc(10) + "next" },
      { method: "delete", path: '/q"uote', summary: "'single'" },
    ];
    const spec = (await generateOpenApi(env, BASE, ops))!;
    const doc = strictParse(spec, "1.2");
    expect(doc.paths["/a: b #c/{id}"].get.summary).toBe("- list: all # of them" + cc(10) + "next");
    expect(doc.paths['/q"uote'].delete.summary).toBe("'single'");
    expect(parseOpenApi(spec)?.paths).toEqual({ "/a: b #c/{id}": ["get"], '/q"uote': ["delete"] });
  });

  it("yamlString: lone surrogates become U+FFFD; YAML-unprintable characters are escaped", () => {
    expect(YAML.parse(yamlString("a" + cc(0xd800) + "b"))).toBe("a" + cc(0xfffd) + "b");
    expect(YAML.parse(yamlString(cc(0xdc00)))).toBe(cc(0xfffd));
    expect(YAML.parse(yamlString("🚀"))).toBe("🚀"); // a valid pair is kept
    const escaped = yamlString(cc(0x85, 0x2028, 0xfeff, 0xfffe, 0x7f));
    expect(escaped).toBe('"' + ["0085", "2028", "FEFF", "FFFE", "007F"].map((h) => "\\u" + h).join("") + '"');
    expect(/^[\x20-\x7e]*$/.test(yamlString("x" + cc(0, 10, 13, 0x85)))).toBe(true);
  });
});
