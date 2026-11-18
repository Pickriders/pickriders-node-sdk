// Refreshes openapi/developer-openapi.json, then regenerate types with `yarn generate`.
//
//   yarn openapi:pull                 from the production API
//   yarn openapi:pull <url-or-file>   from another API (…/developer/docs/openapi.json) or a local dump
//                                     (backend-api: `yarn swagger:dump:developer` writes developer-openapi.json)
import { readFile, writeFile } from 'node:fs/promises';

const source = process.argv[2] ?? 'https://api.pickriders.com/developer/docs/openapi.json';
const text = /^https?:\/\//.test(source)
  ? await fetch(source).then((res) => {
      if (!res.ok) throw new Error(`${source} answered ${res.status}`);
      return res.text();
    })
  : await readFile(source, 'utf8');

const doc = JSON.parse(text);
if (!doc.openapi || !doc.paths) throw new Error(`${source} is not an OpenAPI document`);
await writeFile(new URL('../openapi/developer-openapi.json', import.meta.url), `${JSON.stringify(doc, null, 2)}\n`);
console.log(`Saved ${Object.keys(doc.paths).length} paths from ${source}. Now run: yarn generate`);
