/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * Lean removes built-in AI UI while core upstream modules still inject AI services.
 * Registering the upstream implementations here keeps core files untouched and merges cheap.
 */
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { RemoteAgentHostService } from '../../../../platform/agentHost/browser/remoteAgentHostServiceImpl.js';
import { IRemoteAgentHostService } from '../../../../platform/agentHost/common/remoteAgentHostService.js';
import { ILocalGitService } from '../../../../platform/git/common/localGitService.js';
import { registerSharedProcessRemoteService } from '../../../../platform/ipc/electron-browser/services.js';
import { IPluginGitService } from '../../chat/common/plugins/pluginGitService.js';
import { NativePluginGitCommandService } from '../../chat/electron-browser/pluginGitCommandService.js';
import { IMcpDevModeDebugging } from '../../mcp/common/mcpDevMode.js';
import { IWorkbenchMcpGatewayService } from '../../mcp/common/mcpGatewayService.js';
import { McpDevModeDebuggingNode } from '../../mcp/electron-browser/mcpDevModeDebuggingNode.js';
import { WorkbenchMcpGatewayService } from '../../mcp/electron-browser/mcpGatewayService.js';
import '../../../services/agentHost/electron-browser/agentHostService.js';
import '../../../services/mcp/electron-browser/mcpGalleryManifestService.js';
import '../../../services/mcp/electron-browser/mcpWorkbenchManagementService.js';

registerSingleton(IMcpDevModeDebugging, McpDevModeDebuggingNode, InstantiationType.Delayed);
registerSingleton(IPluginGitService, NativePluginGitCommandService, InstantiationType.Delayed);
registerSingleton(IRemoteAgentHostService, RemoteAgentHostService, InstantiationType.Delayed);
registerSingleton(IWorkbenchMcpGatewayService, WorkbenchMcpGatewayService, InstantiationType.Delayed);
registerSharedProcessRemoteService(ILocalGitService, 'localGit');
