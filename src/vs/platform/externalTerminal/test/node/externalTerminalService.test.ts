/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IExternalTerminalConfiguration } from '../../common/externalTerminal.js';
import { LinuxExternalTerminalService, MacExternalTerminalService, WindowsExternalTerminalService } from '../../node/externalTerminalService.js';

const mockConfig = Object.freeze<IExternalTerminalConfiguration>({
	terminal: {
		explorerKind: 'external',
		external: {
			windowsExec: 'testWindowsShell',
			osxExec: 'testOSXShell',
			linuxExec: 'testLinuxShell'
		}
	}
});

suite('ExternalTerminalService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test(`WinTerminalService - uses terminal from configuration`, done => {
		const testShell = 'cmd';
		const testCwd = 'path/to/workspace';
		const mockSpawner: any = {
			spawn: (command: any, args: any, opts: any) => {
				strictEqual(command, testShell, 'shell should equal expected');
				strictEqual(args[args.length - 1], mockConfig.terminal.external.windowsExec);
				strictEqual(opts.cwd, testCwd);
				done();
				return {
					on: (evt: any) => evt
				};
			}
		};
		const testService = new WindowsExternalTerminalService();
		testService.spawnTerminal(
			mockSpawner,
			mockConfig.terminal.external,
			testShell,
			testCwd
		);
	});

	test(`WinTerminalService - uses default terminal when configuration.terminal.external.windowsExec is undefined`, done => {
		const testShell = 'cmd';
		const testCwd = 'path/to/workspace';
		const mockSpawner: any = {
			spawn: (command: any, args: any, opts: any) => {
				strictEqual(args[args.length - 1], WindowsExternalTerminalService.getDefaultTerminalWindows());
				done();
				return {
					on: (evt: any) => evt
				};
			}
		};
		mockConfig.terminal.external.windowsExec = undefined;
		const testService = new WindowsExternalTerminalService();
		testService.spawnTerminal(
			mockSpawner,
			mockConfig.terminal.external,
			testShell,
			testCwd
		);
	});

	test(`WinTerminalService - cwd is correct regardless of case`, done => {
		const testShell = 'cmd';
		const testCwd = 'c:/foo';
		const mockSpawner: any = {
			spawn: (command: any, args: any, opts: any) => {
				strictEqual(opts.cwd, 'C:/foo', 'cwd should be uppercase regardless of the case that\'s passed in');
				done();
				return {
					on: (evt: any) => evt
				};
			}
		};
		const testService = new WindowsExternalTerminalService();
		testService.spawnTerminal(
			mockSpawner,
			mockConfig.terminal.external,
			testShell,
			testCwd
		);
	});

	test(`WinTerminalService - cmder should be spawned differently`, done => {
		const testShell = 'cmd';
		const testCwd = 'c:/foo';
		const mockSpawner: any = {
			spawn: (command: any, args: any, opts: any) => {
				deepStrictEqual(args, ['C:/foo']);
				strictEqual(opts, undefined);
				done();
				return { on: (evt: any) => evt };
			}
		};
		const testService = new WindowsExternalTerminalService();
		testService.spawnTerminal(
			mockSpawner,
			{ windowsExec: 'cmder' },
			testShell,
			testCwd
		);
	});

	test(`WinTerminalService - windows terminal should open workspace directory`, done => {
		const testShell = 'wt';
		const testCwd = 'c:/foo';
		const mockSpawner: any = {
			spawn: (command: any, args: any, opts: any) => {
				strictEqual(opts.cwd, 'C:/foo');
				done();
				return { on: (evt: any) => evt };
			}
		};
		const testService = new WindowsExternalTerminalService();
		testService.spawnTerminal(
			mockSpawner,
			mockConfig.terminal.external,
			testShell,
			testCwd
		);
	});

	test(`MacTerminalService - uses terminal from configuration`, done => {
		const testCwd = 'path/to/workspace';
		const mockSpawner: any = {
			spawn: (command: any, args: any, opts: any) => {
				strictEqual(args[1], mockConfig.terminal.external.osxExec);
				done();
				return {
					on: (evt: any) => evt
				};
			}
		};
		const testService = new MacExternalTerminalService();
		testService.spawnTerminal(
			mockSpawner,
			mockConfig.terminal.external,
			testCwd
		);
	});

	test(`MacTerminalService - uses default terminal when configuration.terminal.external.osxExec is undefined`, async () => {
		const testCwd = 'path/to/workspace';
		let usedApp: string | undefined;
		const mockSpawner: any = {
			spawn: (command: any, args: any, opts: any) => {
				usedApp = args[1];
				return {
					on: (evt: any, cb: any) => {
						if (evt === 'exit') {
							cb();
						}
					}
				};
			}
		};
		const testService = new MacExternalTerminalService();
		await testService.spawnTerminal(
			mockSpawner,
			{ osxExec: undefined },
			testCwd
		);
		strictEqual(usedApp, await MacExternalTerminalService.getDefaultTerminalOSXReady());
	});

	test(`MacTerminalService - defaults to Lean Term.app when installed, otherwise Terminal.app`, async () => {
		const probed: string[] = [];
		const installed = await MacExternalTerminalService.detectDefaultTerminalOSX(async path => {
			probed.push(path);
			return true;
		});
		const missing = await MacExternalTerminalService.detectDefaultTerminalOSX(async path => {
			probed.push(path);
			return false;
		});
		deepStrictEqual({ installed, missing, probed }, {
			installed: 'Lean Term.app',
			missing: 'Terminal.app',
			probed: ['/Applications/Lean Term.app', '/Applications/Lean Term.app']
		});
	});

	test(`MacTerminalService - Lean Term.app opens the folder with open -a`, done => {
		const testCwd = 'path/to/workspace';
		const mockSpawner: any = {
			spawn: (command: any, args: any, opts: any) => {
				deepStrictEqual({ command, args, cwd: opts.cwd }, {
					command: '/usr/bin/open',
					args: ['-a', 'Lean Term.app', testCwd],
					cwd: testCwd
				});
				done();
				return {
					on: (evt: any) => evt
				};
			}
		};
		const testService = new MacExternalTerminalService();
		testService.spawnTerminal(
			mockSpawner,
			{ osxExec: 'Lean Term.app' },
			testCwd
		);
	});

	test(`MacTerminalService - Ghostty.app should be spawned correctly`, done => {
		const testCwd = 'path/to/workspace';
		const mockSpawner: any = {
			spawn: (command: any, args: any, opts: any) => {
				strictEqual(command, '/usr/bin/open');
				strictEqual(args[0], '-a');
				strictEqual(args[1], 'Ghostty.app');
				strictEqual(args[2], testCwd);
				strictEqual(opts.cwd, testCwd);
				done();
				return {
					on: (evt: any) => evt
				};
			}
		};
		const testService = new MacExternalTerminalService();
		testService.spawnTerminal(
			mockSpawner,
			{ osxExec: 'Ghostty.app' },
			testCwd
		);
	});

	test(`LinuxTerminalService - uses terminal from configuration`, done => {
		const testCwd = 'path/to/workspace';
		const mockSpawner: any = {
			spawn: (command: any, args: any, opts: any) => {
				strictEqual(command, mockConfig.terminal.external.linuxExec);
				strictEqual(opts.cwd, testCwd);
				done();
				return {
					on: (evt: any) => evt
				};
			}
		};
		const testService = new LinuxExternalTerminalService();
		testService.spawnTerminal(
			mockSpawner,
			mockConfig.terminal.external,
			testCwd
		);
	});

	test(`LinuxTerminalService - Ghostty should be spawned with working directory`, done => {
		const testCwd = 'path/to/workspace';
		const mockSpawner: any = {
			spawn: (command: any, args: any, opts: any) => {
				strictEqual(command, 'ghostty');
				deepStrictEqual(args, [`--working-directory=${testCwd}`]);
				strictEqual(opts.cwd, testCwd);
				done();
				return {
					on: (evt: any) => evt
				};
			}
		};
		const testService = new LinuxExternalTerminalService();
		testService.spawnTerminal(
			mockSpawner,
			{ linuxExec: 'ghostty' },
			testCwd
		);
	});

	test(`LinuxTerminalService - uses default terminal when configuration.terminal.external.linuxExec is undefined`, done => {
		LinuxExternalTerminalService.getDefaultTerminalLinuxReady().then(defaultTerminalLinux => {
			const testCwd = 'path/to/workspace';
			const mockSpawner: any = {
				spawn: (command: any, args: any, opts: any) => {
					strictEqual(command, defaultTerminalLinux);
					done();
					return {
						on: (evt: any) => evt
					};
				}
			};
			mockConfig.terminal.external.linuxExec = undefined;
			const testService = new LinuxExternalTerminalService();
			testService.spawnTerminal(
				mockSpawner,
				mockConfig.terminal.external,
				testCwd
			);
		});
	});
});
