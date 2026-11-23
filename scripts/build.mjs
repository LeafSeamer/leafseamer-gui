import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {validateSite} from '../src/site.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sdkRoot = new URL('./', import.meta.resolve('@leafseamer/sdk'));
const lock = JSON.parse(await fs.readFile(path.join(root, 'sdk-runtime.json'), 'utf8'));
const sdkBytes = await fs.readFile(new URL('build-manifest.json', sdkRoot));
if (hash(sdkBytes) !== lock.manifest_sha256) throw new Error('sdk_manifest_drift');
const sdk = JSON.parse(sdkBytes);
if (JSON.stringify(sdk.selection) !== JSON.stringify(lock.selection)) throw new Error('sdk_selection_drift');
for (const [name, digest] of Object.entries(sdk.artifacts)) {
  if (!/^[A-Za-z0-9/_.-]+$/.test(name) || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('sdk_artifact_path');
  if (hash(await fs.readFile(new URL(name, sdkRoot))) !== digest) throw new Error('sdk_artifact_drift');
}
if (hash(await fs.readFile(new URL('../LICENSE', sdkRoot))) !== lock.license_sha256) throw new Error('sdk_license_drift');
const args = process.argv.slice(2);
const options = new Map();
if (args.length % 2) throw new Error('build_arguments');
for (let i = 0; i < args.length; i += 2) {
  if (!['--config', '--out-dir'].includes(args[i]) || options.has(args[i]) || !args[i + 1]) throw new Error('build_arguments');
  options.set(args[i], args[i + 1]);
}
const customOutput = options.get('--out-dir');
if (customOutput !== undefined && !path.isAbsolute(customOutput)) throw new Error('build_arguments');
let config = {site_label: '本机 Controller', service_id: null, database_instance_id: null};
if (options.has('--config')) {
  const bytes = await fs.readFile(path.resolve(options.get('--config'))); if (bytes.length > 32768) throw new Error('site_configuration');
  config = JSON.parse(bytes);
  if(!config||typeof config!=='object'||Object.keys(config).sort().join(',')!==(Object.hasOwn(config,'seamer')?'database_instance_id,seamer,service_id,site_label':'database_instance_id,service_id,site_label'))throw new Error('site_configuration');
  const validated=validateSite({format:config.seamer&&Object.hasOwn(config.seamer,'binding_source')?'leafseamer.gui.site/3':Object.hasOwn(config,'seamer')?'leafseamer.gui.site/2':'leafseamer.gui.site/1',...config,selection:sdk.selection});
  if(validated.format!=='leafseamer.gui.site/3'&&bytes.length>4096)throw new Error('site_configuration');
  if(!validated.service_id)throw new Error('site_configuration');
}
const output = customOutput ?? path.join(root, 'dist');
if (customOutput !== undefined) await fs.mkdir(output);
await build({root, configFile: path.join(root, 'vite.config.mjs'), build: {outDir: output, emptyOutDir: customOutput === undefined}});
await fs.writeFile(path.join(output, 'site.json'), JSON.stringify({format:config.seamer&&Object.hasOwn(config.seamer,'binding_source')?'leafseamer.gui.site/3':Object.hasOwn(config,'seamer')?'leafseamer.gui.site/2':'leafseamer.gui.site/1', ...config, selection: sdk.selection}) + '\n');
await fs.copyFile(new URL('../LICENSE', sdkRoot), path.join(output, 'SDK-LICENSE.txt'));
const licenses = await Promise.all(['react', 'react-dom', 'scheduler'].map(async name => {
  const directory = path.dirname(fileURLToPath(import.meta.resolve(name)));
  return name + '\n\n' + await fs.readFile(path.join(directory, 'LICENSE'), 'utf8');
}));
licenses.push(await fs.readFile(new URL('THIRD_PARTY_LICENSES.txt', sdkRoot), 'utf8'));
await fs.writeFile(path.join(output, 'THIRD-PARTY-LICENSES.txt'), licenses.join('\n\n'));
const artifacts = {};
for (const entry of await fs.readdir(output, {recursive: true, withFileTypes: true})) {
  if (!entry.isFile()) continue;
  const file = path.join(entry.parentPath, entry.name), name = path.relative(output, file).replaceAll('\\', '/');
  artifacts[name] = hash(await fs.readFile(file));
}
await fs.writeFile(path.join(output, 'gui-manifest.json'), JSON.stringify({format: 'leafseamer.gui.build/1', selection: sdk.selection, sdk_manifest_sha256: lock.manifest_sha256, artifacts}, null, 2) + '\n');
console.log(JSON.stringify({artifacts: Object.keys(artifacts).length, configured: config.service_id !== null}));
