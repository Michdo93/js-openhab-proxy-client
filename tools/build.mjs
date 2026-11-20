// Builds openhab-proxy.mjs (ES module) and openhab-proxy.min.js from
// openhab-proxy.js:  npm run build
import { readFileSync, writeFileSync } from "node:fs";
import { transformSync } from "esbuild";

const source = readFileSync("openhab-proxy.js", "utf8");
const names = /const openHAB = \{([^}]*)\}/.exec(source)[1]
  .split(",").map((name) => name.trim()).filter(Boolean);

writeFileSync("openhab-proxy.mjs",
  `${source}\nexport { ${names.join(", ")} };\nexport default openHAB;\n`);

const licence = /\/\*\*[\s\S]*?\*\//.exec(source)[0];
const { code } = transformSync(source, { minify: true, target: "es2020" });
writeFileSync("openhab-proxy.min.js", `${licence}\n${code}`);
console.log(`openhab-proxy.mjs, openhab-proxy.min.js (${code.length} bytes)`);
