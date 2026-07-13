// P0-C2 Chunk D — post-build Queue-handler export GATE.
//
// A source-only grep is insufficient (and the OpenNext bundle contains unrelated
// internal `queue` symbols), so this inspects the ACTUAL wrangler-produced bundle
// + esbuild metafile via the TypeScript compiler AST. It resolves the real
// default-export object and its properties rather than text-matching, and fails
// unless:
//   - the metafile's worker entryPoint is the custom worker (not .open-next/worker.js);
//   - the default export exposes callable `fetch` AND `queue` handlers;
//   - the OpenNext named runtime exports remain present;
//   - (negative control) a fetch-only default export fails.
import ts from "typescript";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REQUIRED_NAMED = ["DOQueueHandler", "DOShardedTagCache", "BucketCachePurge"];
const EXPECTED_ENTRY = "worker.ts";
const GENERATED_ENTRY = ".open-next/worker.js";

// Resolve the bundle's default-export object literal via AST and report its
// property names + whether `queue` is function-shaped, plus the named exports.
export function analyzeBundle(source) {
  const sf = ts.createSourceFile("bundle.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const namedExports = new Set();
  let defaultLocalName = null;
  let objLiteral = null;

  const visit = (node) => {
    // `export { A, B, X as default }`
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const spec of node.exportClause.elements) {
        const exportedName = spec.name.text;
        const localName = (spec.propertyName ?? spec.name).text;
        if (exportedName === "default") defaultLocalName = localName;
        else namedExports.add(exportedName);
      }
    }
    // `export default <expr>`
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      if (ts.isObjectLiteralExpression(node.expression)) objLiteral = node.expression;
      else if (ts.isIdentifier(node.expression)) defaultLocalName = node.expression.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // `X as default` → find `var X = { ... }`
  if (!objLiteral && defaultLocalName) {
    const findVar = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === defaultLocalName &&
        node.initializer &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        objLiteral = node.initializer;
      }
      ts.forEachChild(node, findVar);
    };
    findVar(sf);
  }

  const props = new Set();
  let queueCallable = false;
  if (objLiteral) {
    for (const p of objLiteral.properties) {
      const nm = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
      if (!nm) continue;
      props.add(nm);
      if (nm === "queue") {
        if (ts.isMethodDeclaration(p)) queueCallable = true;
        else if (
          ts.isPropertyAssignment(p) &&
          (ts.isFunctionExpression(p.initializer) || ts.isArrowFunction(p.initializer))
        ) {
          queueCallable = true;
        }
      }
    }
  }

  return {
    defaultFound: !!objLiteral,
    hasFetch: props.has("fetch"),
    hasQueue: props.has("queue"),
    queueCallable,
    namedExports: [...namedExports],
  };
}

// Read the esbuild metafile and return the entryPoint of the main worker output.
export function entryPointFromMetafile(metafile) {
  for (const [out, v] of Object.entries(metafile.outputs ?? {})) {
    if (out.replace(/\\/g, "/").endsWith("worker.js") && v && v.entryPoint) {
      return v.entryPoint.replace(/\\/g, "/");
    }
  }
  return null;
}

export function evaluateGate({ bundleSource, metafile, expectedEntry = EXPECTED_ENTRY, requiredNamed = REQUIRED_NAMED }) {
  const failures = [];
  const analysis = analyzeBundle(bundleSource);
  const entryPoint = entryPointFromMetafile(metafile);

  if (!entryPoint) {
    failures.push("metafile: no worker.js output carries an entryPoint");
  } else if (entryPoint.endsWith(GENERATED_ENTRY)) {
    failures.push(`metafile: entryPoint is the generated fetch-only worker (${entryPoint})`);
  } else if (!entryPoint.endsWith(expectedEntry)) {
    failures.push(`metafile: entryPoint '${entryPoint}' is not the custom worker '${expectedEntry}'`);
  }

  if (!analysis.defaultFound) failures.push("bundle: could not resolve a default-export object");
  if (!analysis.hasFetch) failures.push("bundle: default export has no `fetch` handler");
  if (!analysis.hasQueue) failures.push("bundle: default export has no `queue` handler");
  if (analysis.hasQueue && !analysis.queueCallable) failures.push("bundle: `queue` is present but not callable");
  for (const n of requiredNamed) {
    if (!analysis.namedExports.includes(n)) failures.push(`bundle: missing OpenNext named export '${n}'`);
  }

  return { ok: failures.length === 0, failures, analysis, entryPoint };
}

function main() {
  const [bundlePath, metaPath] = process.argv.slice(2);
  if (!bundlePath || !metaPath) {
    console.error("usage: node worker-bundle-gate.mjs <bundle.js> <meta.json>");
    process.exit(2);
  }
  const bundleSource = readFileSync(bundlePath, "utf8");
  const metafile = JSON.parse(readFileSync(metaPath, "utf8"));
  const { ok, failures, analysis, entryPoint } = evaluateGate({ bundleSource, metafile });
  if (!ok) {
    console.error("cf:build gate FAILED:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(
    `cf:build gate PASS: bundled default export contains fetch + queue ` +
      `(queue callable); entryPoint=${entryPoint}; named OpenNext exports preserved ` +
      `[${analysis.namedExports.join(", ")}].`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
