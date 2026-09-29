/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

interface ImportRecord { path: string; kind: string; original?: string; external?: boolean }
interface InputRecord { bytes: number; imports: ImportRecord[] }
interface OutputRecord { bytes: number; entryPoint?: string; inputs: Record<string, { bytesInOutput: number }>; imports: ImportRecord[] }
interface Metafile { inputs: Record<string, InputRecord>; outputs: Record<string, OutputRecord> }
interface AuditResult {
	entry: string;
	bundleBytes: number;
	aiBytes: number;
	allowlistedBytes: number;
	allowlistedAiBytes: number;
	reachableAiBytes: number;
	reachableNonAllowlistedAiBytes: number;
	allowlist: { path: string; bytes: number }[];
	allowlistServices: { service: string; implementation: string }[];
	aiInputs: { path: string; bytes: number; reachable: boolean; allowlisted: boolean }[];
	offenders: { root: string; bytes: number; chain: string[] }[];
	importers: { from: string; to: string; chain: string[] }[];
	cuts: string[];
}

/** AI-only source folders. These prefixes are also exported for other build checks. */
export const AI_PATH_PREFIXES = [
	'vs/workbench/contrib/chat/',
	'vs/workbench/contrib/inlineChat/',
	'vs/workbench/contrib/mcp/',
	'vs/workbench/contrib/agentsVoice/',
	'vs/workbench/contrib/speech/',
	'vs/workbench/contrib/welcomeAgentSessions/',
	'vs/workbench/contrib/welcomeOnboarding/',
	'vs/workbench/contrib/remoteCodingAgents/',
	'vs/workbench/contrib/terminalContrib/chat/',
	'vs/workbench/contrib/terminalContrib/chatAgentTools/',
	'vs/workbench/contrib/terminalContrib/voice/',
	'vs/workbench/contrib/notebook/browser/controller/chat/',
	'vs/workbench/contrib/browserView/electron-browser/tools/',
	'vs/platform/localTranscription/',
	'vs/platform/agentHost/',
	'vs/platform/agentPlugins/',
	'vs/platform/chat/',
	'vs/platform/mcp/',
	'vs/workbench/services/agentHost/',
	'vs/workbench/services/chat/',
	'vs/workbench/services/mcp/',
	'vs/workbench/services/agentEditorComments/',
	'vs/workbench/services/aiRelatedInformation/',
	'vs/workbench/services/aiSettingsSearch/',
	'vs/workbench/services/aiEmbeddingVector/',
	'vs/sessions/',
] as const;

const ENTRY = 'src/vs/workbench/workbench.desktop.main.ts';
const API_ACTORS = [
	'src/vs/workbench/api/browser/mainThreadLanguageModels.ts',
	'src/vs/workbench/api/browser/mainThreadMcp.ts',
];

/** Services supplied outside the desktop singleton registry or injected only by an inactive class. */
export const DI_EXCEPTIONS = [
	{ service: 'IInstantiationService', mechanism: 'Provided by the instantiation container itself' },
	{ service: 'IEditorProgressService', mechanism: 'Per-editor child service collection in editorGroupView.ts' },
	{ service: 'IPrivateBreakpointWidgetService', mechanism: 'Per-widget child service collection in breakpointWidget.ts' },
	{ service: 'IExtHostInitDataService', mechanism: 'Extension-host bootstrap service collection' },
	{ service: 'IExtHostRpcService', mechanism: 'Extension-host bootstrap service collection' },
	{ service: 'IUserDataSyncStoreService', mechanism: 'Shared-process service collection' },
	{ service: 'IUserDataSyncLocalStoreService', mechanism: 'Shared-process service collection' },
	{ service: 'IOnboardingService', mechanism: 'Only StartupPageRunnerContribution injects it; that class is not registered or constructed' },
] as const;

/** Normalize metafile paths for prefix comparisons. */
function normalized(value: string): string {
	return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^src\//, '');
}

/** Classify source inputs that belong to the upstream AI surface. */
function isAi(value: string): boolean {
	return AI_PATH_PREFIXES.some(prefix => normalized(value).startsWith(prefix));
}

/** Parse the audit and guard CLI options. */
function parseArgs(args: string[]): { metafile: string; cuts: string[]; check: boolean; diCheck: boolean; json?: string; allowlist?: string; writeAllowlist?: string } {
	let metafile = '';
	let json: string | undefined;
	let allowlist: string | undefined;
	let writeAllowlist: string | undefined;
	const cuts: string[] = [];
	let check = false;
	let diCheck = false;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === '--metafile') {
			metafile = args[++index] ?? '';
		} else if (argument === '--cut') {
			cuts.push(args[++index] ?? '');
		} else if (argument === '--cuts-file') {
			const value: unknown = JSON.parse(fs.readFileSync(args[++index] ?? '', 'utf8'));
			const entries = Array.isArray(value) ? value : typeof value === 'object' && value !== null ? (value as { cuts?: unknown }).cuts : undefined;
			if (!Array.isArray(entries) || !entries.every((entry): entry is string => typeof entry === 'string')) {
				throw new Error('Cuts file must contain an array of edge strings or {"cuts": [...]}');
			}
			cuts.push(...entries);
		} else if (argument === '--json') {
			json = args[++index] ?? '';
		} else if (argument === '--check') {
			check = true;
		} else if (argument === '--di-check') {
			diCheck = true;
		} else if (argument === '--allowlist') {
			allowlist = args[++index] ?? '';
		} else if (argument === '--write-allowlist') {
			writeAllowlist = args[++index] ?? '';
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}
	if (!metafile) {
		throw new Error('Usage: node build/lean/aiBundleAudit.ts --metafile <path> [--cut from=>to] [--cuts-file <json>] [--json <path>] [--check] [--allowlist <file>] [--write-allowlist <file>] [--di-check]');
	}
	return { metafile, cuts, check, diCheck, json, allowlist, writeAllowlist };
}

/** List static source imports after applying modeled edge cuts. */
function staticImports(meta: Metafile, from: string, cuts: Set<string>): string[] {
	return (meta.inputs[from]?.imports ?? [])
		.filter(item => item.kind !== 'dynamic-import' && !item.external && meta.inputs[item.path] && !cuts.has(`${from}=>${item.path}`))
		.map(item => item.path);
}

/** Find shortest static import chains from the given roots. */
function pathsFrom(meta: Metafile, roots: string[], cuts: Set<string>): Map<string, string[]> {
	const paths = new Map<string, string[]>();
	const queue = [...roots];
	for (const root of roots) {
		if (meta.inputs[root]) {
			paths.set(root, [root]);
		}
	}
	for (let index = 0; index < queue.length; index++) {
		const from = queue[index];
		const chain = paths.get(from);
		if (!chain) {
			continue;
		}
		for (const to of staticImports(meta, from, cuts)) {
			if (!paths.has(to)) {
				paths.set(to, [...chain, to]);
				queue.push(to);
			}
		}
	}
	return paths;
}

interface ServiceScan {
	uses: Map<string, Set<string>>;
	registrations: Set<string>;
	aliases: Map<string, string>;
}

/** Scan actual TypeScript syntax so comments and type references are not mistaken for injections. */
function scanServices(files: Iterable<string>): ServiceScan {
	const uses = new Map<string, Set<string>>();
	const registrations = new Set<string>();
	const aliases = new Map<string, string>();
	for (const file of files) {
		if (!file.endsWith('.ts') || !fs.existsSync(file)) {
			continue;
		}
		const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
		const importAliases = new Map<string, string>();
		for (const statement of source.statements) {
			if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
				for (const item of statement.importClause.namedBindings.elements) {
					if (item.propertyName) {
						importAliases.set(item.name.text, item.propertyName.text);
					}
				}
			}
		}
		const canonical = (name: string) => importAliases.get(name) ?? name;
		const addUse = (name: string) => {
			if (!/^I[A-Z][A-Za-z0-9]*$/.test(name)) {
				return;
			}
			const service = canonical(name);
			const owners = uses.get(service) ?? new Set<string>();
			owners.add(file);
			uses.set(service, owners);
		};
		const visit = (node: ts.Node): void => {
			if (ts.isDecorator(node) && ts.isIdentifier(node.expression)) {
				addUse(node.expression.text);
			}
			if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)
				&& ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === 'refineServiceDecorator') {
				const base = node.initializer.arguments[0];
				if (base && ts.isIdentifier(base)) {
					aliases.set(node.name.text, base.text);
				}
			}
			if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isIdentifier(node.arguments[0])) {
				const service = canonical(node.arguments[0].text);
				if (ts.isPropertyAccessExpression(node.expression)) {
					if (node.expression.name.text === 'get') {
						addUse(service);
					} else if (node.expression.name.text === 'set' && ts.isIdentifier(node.expression.expression)
						&& ['serviceCollection', 'services'].includes(node.expression.expression.text)) {
						registrations.add(service);
					}
				} else if (ts.isIdentifier(node.expression) && [
					'registerSingleton', 'registerMainProcessRemoteService', 'registerSharedProcessRemoteService'
				].includes(node.expression.text)) {
					registrations.add(service);
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
	return { uses, registrations, aliases };
}

/** Resolve refined service decorators to the underlying service identifier. */
function serviceRoot(service: string, aliases: Map<string, string>): string {
	let result = service;
	const seen = new Set<string>();
	while (aliases.has(result) && !seen.has(result)) {
		seen.add(result);
		result = aliases.get(result)!;
	}
	return result;
}

/** Report injections without a registration in the desktop graph or an explicit runtime exception. */
function missingRegistrations(files: Iterable<string>): { file: string; service: string }[] {
	const { uses, registrations, aliases } = scanServices(files);
	const registeredRoots = new Set([...registrations].map(service => serviceRoot(service, aliases)));
	const excepted = new Set<string>(DI_EXCEPTIONS.map(item => item.service));
	return [...uses].flatMap(([service, owners]) => {
		if (registeredRoots.has(serviceRoot(service, aliases)) || excepted.has(service)) {
			return [];
		}
		return [...owners].map(file => ({ file, service }));
	}).sort((left, right) => left.file.localeCompare(right.file) || left.service.localeCompare(right.service));
}

/** Read the complete set of main-thread proxy identifiers asserted by the extension-host protocol. */
function mainContextActors(): string[] {
	const file = 'src/vs/workbench/api/common/extHost.protocol.ts';
	const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
	const declaration = source.statements.find(statement => ts.isVariableStatement(statement)
		&& statement.declarationList.declarations.some(item => ts.isIdentifier(item.name) && item.name.text === 'MainContext'));
	if (!declaration || !ts.isVariableStatement(declaration)) {
		throw new Error(`MainContext declaration not found: ${file}`);
	}
	const context = declaration.declarationList.declarations.find(item => ts.isIdentifier(item.name) && item.name.text === 'MainContext')?.initializer;
	if (!context || !ts.isObjectLiteralExpression(context)) {
		throw new Error(`MainContext is not an object literal: ${file}`);
	}
	return context.properties.filter(ts.isPropertyAssignment).map(item => item.name.getText(source));
}

/** Find actor registrations made by named customers or multi-actor customer constructors. */
function registeredMainContextActors(files: Iterable<string>): Set<string> {
	const registered = new Set<string>();
	for (const file of files) {
		if (!file.endsWith('.ts') || !fs.existsSync(file)) {
			continue;
		}
		const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
		const actorName = (node: ts.Node): string | undefined => {
			if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.name)) {
				return undefined;
			}
			const owner = node.expression;
			if (ts.isIdentifier(owner) && owner.text === 'MainContext') {
				return node.name.text;
			}
			if (ts.isPropertyAccessExpression(owner) && owner.name.text === 'MainContext') {
				return node.name.text;
			}
			return undefined;
		};
		const visit = (node: ts.Node): void => {
			if (ts.isDecorator(node) && ts.isCallExpression(node.expression)
				&& ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'extHostNamedCustomer') {
				const name = node.expression.arguments[0] && actorName(node.expression.arguments[0]);
				if (name) {
					registered.add(name);
				}
			}
			if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
				&& node.expression.name.text === 'set') {
				const name = node.arguments[0] && actorName(node.arguments[0]);
				if (name) {
					registered.add(name);
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
	return registered;
}

/** Report protocol actors that have no registration in the desktop entry graph. */
function missingMainContextActors(files: Iterable<string>): string[] {
	const registered = registeredMainContextActors(files);
	return mainContextActors().filter(actor => !registered.has(actor));
}

/** Find TypeScript source files for the actor closure's upstream registration map. */
function allSourceFiles(directory: string): string[] {
	if (!fs.existsSync(directory)) {
		return [];
	}
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const file = path.join(directory, entry.name);
		return entry.isDirectory() ? allSourceFiles(file) : entry.name.endsWith('.ts') ? [file] : [];
	});
}

/** Map AI service identifiers to their upstream implementation inputs. */
function serviceRegistrations(meta: Metafile): Map<string, string[]> {
	const registrations = new Map<string, string[]>();
	for (const file of allSourceFiles('src/vs')) {
		const source = fs.readFileSync(file, 'utf8');
		if (!source.includes('registerSingleton(')) {
			continue;
		}
		for (const match of source.matchAll(/registerSingleton\s*\(\s*(I[A-Za-z\d_]+)\s*,\s*([A-Za-z\d_]+)/g)) {
			// The sessions window has alternate registrations for core services; it is not the desktop workbench.
			if ((!isAi(file) || normalized(file).startsWith('vs/sessions/')) && !file.includes('/authenticationMcp')) {
				continue;
			}
			const declaration = new RegExp(`(?:class|function)\\s+${match[2]}\\b`).test(source);
			const imported = new RegExp(`import\\s*\\{[^}]*\\b${match[2]}\\b[^}]*\\}\\s*from\\s*['\"]([^'\"]+)['\"]`).exec(source)?.[1];
			const implementation = declaration ? file : meta.inputs[file]?.imports.find(item => item.original === imported)?.path;
			if (!implementation) {
				continue;
			}
			const previous = registrations.get(match[1]) ?? [];
			previous.push(implementation.replaceAll('\\', '/'));
			registrations.set(match[1], previous);
		}
	}
	return registrations;
}

/** Compute the legacy LM/MCP actor closure used by the baseline report. */
function actorAllowlist(meta: Metafile): { files: Set<string>; services: { service: string; implementation: string }[] } {
	const registrations = serviceRegistrations(meta);
	const serviceOwners = new Set(API_ACTORS);
	const services = new Map<string, string>();
	const queue = [...API_ACTORS];
	for (let index = 0; index < queue.length; index++) {
		const owner = queue[index];
		if (!fs.existsSync(owner)) {
			continue;
		}
		const source = fs.readFileSync(owner, 'utf8');
		for (const match of source.matchAll(/@\s*(I[A-Za-z\d_]+)\b/g)) {
			for (const implementation of registrations.get(match[1]) ?? []) {
				services.set(match[1], implementation);
				if (!serviceOwners.has(implementation)) {
					serviceOwners.add(implementation);
					queue.push(implementation);
				}
			}
		}
	}
	return {
		files: new Set(pathsFrom(meta, [...serviceOwners], new Set()).keys()),
		services: [...services].map(([service, implementation]) => ({ service, implementation })).sort((left, right) => left.service.localeCompare(right.service)),
	};
}

/** Attribute desktop output bytes and optional modeled edge cuts. */
function audit(meta: Metafile, rawCuts: string[]): AuditResult {
	const output = Object.entries(meta.outputs).find(([name, record]) => name.endsWith('/vs/workbench/workbench.desktop.main.js') && record.inputs[ENTRY]);
	if (!output) {
		throw new Error('Desktop workbench JavaScript output missing from metafile');
	}
	// ESM splitting can place eagerly imported code in sibling chunks. Count the
	// entire static output closure; dynamic imports remain optional first-use code.
	const initialOutputs = new Map<string, OutputRecord>();
	const pending = [output[0]];
	while (pending.length) {
		const name = pending.pop()!;
		const record = meta.outputs[name];
		if (!record) {
			throw new Error(`Missing static desktop output: ${name}`);
		}
		if (initialOutputs.has(name)) {
			continue;
		}
		initialOutputs.set(name, record);
		for (const item of record.imports ?? []) {
			if (item.kind !== 'dynamic-import' && !item.external) {
				pending.push(item.path);
			}
		}
	}
	const inputBytes = new Map<string, number>();
	for (const record of initialOutputs.values()) {
		for (const [file, input] of Object.entries(record.inputs)) {
			inputBytes.set(file, (inputBytes.get(file) ?? 0) + input.bytesInOutput);
		}
	}
	const bytes = (file: string) => inputBytes.get(file) ?? 0;
	const cuts = new Set(rawCuts.map(cut => {
		const parts = cut.split('=>');
		if (parts.length !== 2) {
			throw new Error(`Invalid cut: ${cut}`);
		}
		const from = Object.keys(meta.inputs).find(input => normalized(input) === normalized(parts[0]));
		const to = Object.keys(meta.inputs).find(input => normalized(input) === normalized(parts[1]));
		if (!from || !to || !meta.inputs[from].imports.some(item => item.path === to && item.kind !== 'dynamic-import')) {
			throw new Error(`Static edge not found: ${cut}`);
		}
		return `${from}=>${to}`;
	}));
	const paths = pathsFrom(meta, [ENTRY], cuts);
	const { files: allow, services: allowlistServices } = actorAllowlist(meta);
	const bundled = [...inputBytes.keys()];
	const ai = bundled.filter(isAi);
	const reachableAi = ai.filter(file => paths.has(file));
	const offending = reachableAi.filter(file => !allow.has(file));
	const roots = offending.filter(file => {
		const chain = paths.get(file) ?? [];
		return !chain.slice(0, -1).some(node => isAi(node) && !allow.has(node));
	});
	const importers = bundled.flatMap(from => isAi(from) ? [] : (meta.inputs[from]?.imports ?? [])
		.filter(item => item.kind !== 'dynamic-import' && isAi(item.path) && inputBytes.has(item.path))
		.map(item => ({ from, to: item.path, chain: paths.get(from) ?? [] })));
	return {
		entry: ENTRY,
		bundleBytes: [...initialOutputs.values()].reduce((sum, item) => sum + item.bytes, 0),
		aiBytes: ai.reduce((sum, file) => sum + bytes(file), 0),
		allowlistedBytes: bundled.filter(file => allow.has(file)).reduce((sum, file) => sum + bytes(file), 0),
		allowlistedAiBytes: ai.filter(file => allow.has(file)).reduce((sum, file) => sum + bytes(file), 0),
		reachableAiBytes: reachableAi.reduce((sum, file) => sum + bytes(file), 0),
		reachableNonAllowlistedAiBytes: offending.reduce((sum, file) => sum + bytes(file), 0),
		allowlist: bundled.filter(file => allow.has(file)).map(file => ({ path: file, bytes: bytes(file) })).sort((left, right) => left.path.localeCompare(right.path)),
		allowlistServices,
		aiInputs: ai.map(file => ({ path: file, bytes: bytes(file), reachable: paths.has(file), allowlisted: allow.has(file) })).sort((left, right) => left.path.localeCompare(right.path)),
		offenders: roots.map(root => ({ root, bytes: bytes(root), chain: paths.get(root) ?? [] })).sort((left, right) => left.chain.length - right.chain.length || left.root.localeCompare(right.root)),
		importers: importers.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to)),
		cuts: [...cuts].sort(),
	};
}

/** Run the requested audit, allowlist guard, and DI guard. */
function main(): void {
	const options = parseArgs(process.argv.slice(2));
	const metafile = JSON.parse(fs.readFileSync(options.metafile, 'utf8')) as Metafile;
	const result = audit(metafile, options.cuts);
	const chains = pathsFrom(metafile, [ENTRY], new Set());
	const reachableAi = result.aiInputs.filter(item => item.reachable).map(item => item.path);
	if (options.json) {
		fs.writeFileSync(options.json, JSON.stringify(result, null, 2) + '\n');
	}
	if (options.writeAllowlist) {
		fs.writeFileSync(options.writeAllowlist, JSON.stringify({ version: 1, inputs: reachableAi }, null, 2) + '\n');
	}
	console.log(`Desktop initial static output: ${result.bundleBytes} bytes; AI inputs: ${result.aiBytes} bytes; allowlist closure: ${result.allowlistedBytes} bytes (${result.allowlistedAiBytes} AI bytes, ${result.allowlist.length} inputs); reachable AI after cuts: ${result.reachableAiBytes} bytes; non-allowlisted reachable AI: ${result.reachableNonAllowlistedAiBytes} bytes.`);
	console.log(`AI roots: ${result.offenders.length}; non-AI to AI static edges: ${result.importers.length}.`);
	if (options.check && options.allowlist) {
		const saved = JSON.parse(fs.readFileSync(options.allowlist, 'utf8')) as { version: number; inputs: string[] };
		if (saved.version !== 1 || !Array.isArray(saved.inputs) || !saved.inputs.every(item => typeof item === 'string')) {
			throw new Error(`Invalid AI allowlist: ${options.allowlist}`);
		}
		const allowed = new Set(saved.inputs);
		for (const file of reachableAi) {
			if (!allowed.has(file)) {
				console.error(`New reachable AI input: ${file}\n  ${(chains.get(file) ?? []).join(' -> ')}`);
				process.exitCode = 1;
			}
		}
	} else if (options.check && result.offenders.length) {
		for (const offender of result.offenders) {
			console.error(`${offender.root}: ${offender.chain.join(' -> ')}`);
		}
		process.exitCode = 1;
	}
	if (options.diCheck) {
		const missing = missingRegistrations(chains.keys());
		for (const item of missing) {
			console.error(`Missing DI registration: ${item.file}: ${item.service}`);
		}
		console.log(`DI check: ${chains.size} reachable inputs; ${missing.length} missing registrations; ${DI_EXCEPTIONS.length} documented exceptions.`);
		if (missing.length) {
			process.exitCode = 1;
		}
		const missingActors = missingMainContextActors(chains.keys());
		for (const actor of missingActors) {
			console.error(`Missing main-thread actor: MainContext.${actor}`);
		}
		console.log(`Actor check: ${mainContextActors().length} MainContext actors; ${missingActors.length} missing registrations.`);
		if (missingActors.length) {
			process.exitCode = 1;
		}
	}
}

main();
