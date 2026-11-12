// Node verification adapter: real process configuration and real pg, no DB replacement.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
export async function resolve(specifier,context,nextResolve) {
 if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env=process.env',shortCircuit:true};
 if(specifier==='next/headers')return nextResolve('next/headers.js',context);
 if(specifier.startsWith('@/'))return {url:new URL('../'+specifier.slice(2)+'.ts',import.meta.url).href,shortCircuit:true};
 return nextResolve(specifier,context);
}
export async function load(url,context,nextLoad) {
 if(url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(await readFile(fileURLToPath(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};
 return nextLoad(url,context);
}
