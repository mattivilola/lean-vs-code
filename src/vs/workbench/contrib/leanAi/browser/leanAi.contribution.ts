/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * Lean removes built-in AI UI, views, commands, and settings surfaces while keeping core files untouched.
 * The extension-host protocol requires every main-thread actor, so Lean retains those actors and
 * registers their upstream services here. Speech, chat dictation, and MCP workbench services are
 * lazy because the AI surfaces that consumed them eagerly are not bundled.
 */
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { localize } from '../../../../nls.js';
import { IAgentHostByokLmHandler } from '../../../../platform/agentHost/common/agentHostByokLm.js';
import { ChatAIDisabledSettingId } from '../../../../platform/chat/common/chatSettings.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { AllowedMcpServersService } from '../../../../platform/mcp/common/allowedMcpServersService.js';
import { McpGalleryService } from '../../../../platform/mcp/common/mcpGalleryService.js';
import { IAllowedMcpServersService, IMcpGalleryService } from '../../../../platform/mcp/common/mcpManagement.js';
import { AgentNetworkFilterService, IAgentNetworkFilterService } from '../../../../platform/networkFilter/common/networkFilterService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ChatAccessibilityService } from '../../chat/browser/accessibility/chatAccessibilityService.js';
import { AgentPluginRepositoryService } from '../../chat/browser/agentPluginRepositoryService.js';
import { AgentHostByokLmHandler } from '../../chat/browser/agentSessions/agentHost/agentHostByokLmHandler.js';
import { AgentHostImportConversationStore, IAgentHostImportConversationStore } from '../../chat/browser/agentSessions/agentHost/agentHostImportConversationStore.js';
import { AgentSessionsService, IAgentSessionsService } from '../../chat/browser/agentSessions/agentSessionsService.js';
import { ISessionSummaryHoverService, SessionSummaryHoverService } from '../../chat/browser/agentSessions/sessionSummaryHoverService.js';
import { ChatAttachmentResolveService, IChatAttachmentResolveService } from '../../chat/browser/attachments/chatAttachmentResolveService.js';
import { ChatAttachmentWidgetRegistry, IChatAttachmentWidgetRegistry } from '../../chat/browser/attachments/chatAttachmentWidgetRegistry.js';
import { ChatContextPickService, IChatContextPickService } from '../../chat/browser/attachments/chatContextPickService.js';
import { ChatPasteTargetService } from '../../chat/browser/attachments/chatPasteTargetService.js';
import { ChatVariablesService } from '../../chat/browser/attachments/chatVariables.js';
import { IChatAccessibilityService, IChatCodeBlockContextProviderService, IChatPasteTargetService, IChatWidgetService, IQuickChatService } from '../../chat/browser/chat.js';
import { ChatEditingService } from '../../chat/browser/chatEditing/chatEditingServiceImpl.js';
import { ChatGoalSummaryService, IChatGoalSummaryService } from '../../chat/browser/chatGoalSummaryService.js';
import { ChatImageCarouselService, IChatImageCarouselService } from '../../chat/browser/chatImageCarouselService.js';
import { ChatOutputRendererService, IChatOutputRendererService } from '../../chat/browser/chatOutputItemRenderer.js';
import { ChatPetService, IChatPetService } from '../../chat/browser/chatPetService.js';
import { IChatResponseFileChangesService } from '../../chat/browser/chatResponseFileChangesService.js';
import { ChatSubmitRequestHandlerService, IChatSubmitRequestHandlerService } from '../../chat/browser/chatSubmitRequestHandlerService.js';
import { ChatTipService, IChatTipService } from '../../chat/browser/chatTipService.js';
import { ChatCodeBlockContextProviderService } from '../../chat/browser/codeBlockContextProviderService.js';
import { EditorChatResponseFileChangesService } from '../../chat/browser/editorChatResponseFileChangesService.js';
import { ChatModelFeedbackSurveyService, IChatModelFeedbackSurveyService } from '../../chat/browser/feedbackSurvey/chatModelFeedbackSurveyService.js';
import { LanguageModelsConfigurationService } from '../../chat/browser/languageModelsConfigurationService.js';
import { IPlanReviewFeedbackService, PlanReviewFeedbackService } from '../../chat/browser/planReviewFeedback/planReviewFeedbackService.js';
import { PluginInstallService } from '../../chat/browser/pluginInstallService.js';
import { ChatSpeechToTextService, IChatSpeechToTextService } from '../../chat/browser/speechToText/chatSpeechToTextService.js';
import { IVoiceCodeTranscriptionClient, VoiceCodeTranscriptionClient } from '../../chat/browser/speechToText/voiceCodeTranscriptionClient.js';
import { ChatToolRiskAssessmentService, IChatToolRiskAssessmentService } from '../../chat/browser/tools/chatToolRiskAssessmentService.js';
import { LanguageModelToolsConfirmationService } from '../../chat/browser/tools/languageModelToolsConfirmationService.js';
import { LanguageModelToolsService } from '../../chat/browser/tools/languageModelToolsService.js';
import { ToolResultCompressorService } from '../../chat/browser/tools/toolResultCompressorService.js';
import { ChatMarkdownAnchorService, IChatMarkdownAnchorService } from '../../chat/browser/widget/chatContentParts/chatMarkdownAnchorService.js';
import { ChatLayoutService } from '../../chat/browser/widget/chatLayoutService.js';
import { ChatPetWidgetService, IChatPetWidgetService } from '../../chat/browser/widget/chatPetWidgetService.js';
import { ChatWidgetService } from '../../chat/browser/widget/chatWidgetService.js';
import { QuickChatService } from '../../chat/browser/widgetHosts/chatQuick.js';
import { IChatVariablesService } from '../../chat/common/attachments/chatVariables.js';
import { IChatDebugService } from '../../chat/common/chatDebugService.js';
import { ChatDebugServiceImpl } from '../../chat/common/chatDebugServiceImpl.js';
import { ChatModeService, IChatModeService } from '../../chat/common/chatModes.js';
import { ChatRequestOriginService, IChatRequestOriginService } from '../../chat/common/chatRequestOrigin.js';
import { IChatService } from '../../chat/common/chatService/chatService.js';
import { ChatService } from '../../chat/common/chatService/chatServiceImpl.js';
import { ChatSideChatService, IChatSideChatService } from '../../chat/common/chatSideChatService.js';
import { CodeMapperService, ICodeMapperService } from '../../chat/common/editing/chatCodeMapperService.js';
import { IChatEditingService } from '../../chat/common/editing/chatEditingService.js';
import { ILanguageModelIgnoredFilesService, LanguageModelIgnoredFilesService } from '../../chat/common/ignoredFiles.js';
import { ILanguageModelsService, LanguageModelsService } from '../../chat/common/languageModels.js';
import { ILanguageModelsConfigurationService } from '../../chat/common/languageModelsConfiguration.js';
import { ChatTransferService, IChatTransferService } from '../../chat/common/model/chatTransferService.js';
import { ChatAgentNameService, ChatAgentService, IChatAgentNameService, IChatAgentService } from '../../chat/common/participants/chatAgents.js';
import { ChatSlashCommandService, IChatSlashCommandService } from '../../chat/common/participants/chatSlashCommands.js';
import { IAgentPluginRepositoryService } from '../../chat/common/plugins/agentPluginRepositoryService.js';
import { IAgentPluginService } from '../../chat/common/plugins/agentPluginService.js';
import { AgentPluginService } from '../../chat/common/plugins/agentPluginServiceImpl.js';
import { IPluginInstallService } from '../../chat/common/plugins/pluginInstallService.js';
import { IPluginMarketplaceService, PluginMarketplaceService } from '../../chat/common/plugins/pluginMarketplaceService.js';
import { IWorkspacePluginSettingsService, WorkspacePluginSettingsService } from '../../chat/common/plugins/workspacePluginSettingsService.js';
import { CustomizationMigrationTelemetryService, ICustomizationMigrationTelemetryService } from '../../chat/common/promptSyntax/service/customizationMigrationTelemetryService.js';
import { IPromptsService } from '../../chat/common/promptSyntax/service/promptsService.js';
import { PromptsService } from '../../chat/common/promptSyntax/service/promptsServiceImpl.js';
import { ISessionChatPillVisibilityService, SessionChatPillVisibility } from '../../chat/common/sessionChatPills.js';
import { ChatArtifactsService, IChatArtifactsService } from '../../chat/common/tools/chatArtifactsService.js';
import { ChatTodoListService, IChatTodoListService } from '../../chat/common/tools/chatTodoListService.js';
import { ILanguageModelToolsConfirmationService } from '../../chat/common/tools/languageModelToolsConfirmationService.js';
import { ILanguageModelToolsService } from '../../chat/common/tools/languageModelToolsService.js';
import { IToolResultCompressor } from '../../chat/common/tools/toolResultCompressor.js';
import { IChatLayoutService } from '../../chat/common/widget/chatLayoutService.js';
import { ChatResponseResourceFileSystemProvider, IChatResponseResourceFileSystemProvider } from '../../chat/common/widget/chatResponseResourceFileSystemProvider.js';
import { ChatWidgetHistoryService, IChatWidgetHistoryService } from '../../chat/common/widget/chatWidgetHistoryService.js';
import { IInlineChatSessionResolver, InlineChatSessionResolver } from '../../inlineChat/browser/inlineChatSessionResolver.js';
import { IInlineChatSessionService } from '../../inlineChat/browser/inlineChatSessionService.js';
import { InlineChatSessionServiceImpl } from '../../inlineChat/browser/inlineChatSessionServiceImpl.js';
import { McpElicitationService } from '../../mcp/browser/mcpElicitationService.js';
import { McpWorkbenchService } from '../../mcp/browser/mcpWorkbenchService.js';
import { McpRegistry } from '../../mcp/common/mcpRegistry.js';
import { IMcpRegistry } from '../../mcp/common/mcpRegistryTypes.js';
import { McpSamplingService } from '../../mcp/common/mcpSamplingService.js';
import { IMcpSandboxService, McpSandboxService } from '../../mcp/common/mcpSandboxService.js';
import { McpService } from '../../mcp/common/mcpService.js';
import { IMcpElicitationService, IMcpSamplingService, IMcpService, IMcpWorkbenchService } from '../../mcp/common/mcpTypes.js';
import { SpeechService } from '../../speech/browser/speechService.js';
import { ISpeechService } from '../../speech/common/speechService.js';
import '../../../../platform/agentHost/browser/agentHostConnectionsService.js';
import '../../../../platform/agentHost/browser/agentHostEnablementService.js';
import '../../../services/agentHost/common/agentHostResourceService.js';
import '../../../services/aiRelatedInformation/common/aiRelatedInformationService.js';
import '../../../services/aiSettingsSearch/common/aiSettingsSearchService.js';
import '../../chat/browser/aiCustomization/customizationHarnessService.js';
import '../../chat/browser/voiceClient/voiceClientService.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'chat',
	properties: {
		[ChatAIDisabledSettingId]: {
			type: 'boolean',
			description: localize('chat.disableAIFeatures', "Disable and hide built-in AI features provided by GitHub Copilot, including chat and inline suggestions."),
			default: false,
			scope: ConfigurationScope.WINDOW,
		},
	},
});

registerSingleton(IAgentHostByokLmHandler, AgentHostByokLmHandler, InstantiationType.Delayed);
registerSingleton(IAgentHostImportConversationStore, AgentHostImportConversationStore, InstantiationType.Delayed);
registerSingleton(IAgentNetworkFilterService, AgentNetworkFilterService, InstantiationType.Delayed);
registerSingleton(IAgentPluginRepositoryService, AgentPluginRepositoryService, InstantiationType.Delayed);
registerSingleton(IAgentPluginService, AgentPluginService, InstantiationType.Delayed);
registerSingleton(IAgentSessionsService, AgentSessionsService, InstantiationType.Delayed);
registerSingleton(IChatAccessibilityService, ChatAccessibilityService, InstantiationType.Delayed);
registerSingleton(IChatAgentNameService, ChatAgentNameService, InstantiationType.Delayed);
registerSingleton(IChatAgentService, ChatAgentService, InstantiationType.Delayed);
registerSingleton(IChatArtifactsService, ChatArtifactsService, InstantiationType.Delayed);
registerSingleton(IChatAttachmentResolveService, ChatAttachmentResolveService, InstantiationType.Delayed);
registerSingleton(IChatAttachmentWidgetRegistry, ChatAttachmentWidgetRegistry, InstantiationType.Delayed);
registerSingleton(IChatCodeBlockContextProviderService, ChatCodeBlockContextProviderService, InstantiationType.Delayed);
registerSingleton(IChatContextPickService, ChatContextPickService, InstantiationType.Delayed);
registerSingleton(IChatDebugService, ChatDebugServiceImpl, InstantiationType.Delayed);
registerSingleton(IChatEditingService, ChatEditingService, InstantiationType.Delayed);
registerSingleton(IChatGoalSummaryService, ChatGoalSummaryService, InstantiationType.Delayed);
registerSingleton(IChatImageCarouselService, ChatImageCarouselService, InstantiationType.Delayed);
registerSingleton(IChatLayoutService, ChatLayoutService, InstantiationType.Delayed);
registerSingleton(IChatMarkdownAnchorService, ChatMarkdownAnchorService, InstantiationType.Delayed);
registerSingleton(IChatModeService, ChatModeService, InstantiationType.Delayed);
registerSingleton(IChatModelFeedbackSurveyService, ChatModelFeedbackSurveyService, InstantiationType.Delayed);
registerSingleton(IChatOutputRendererService, ChatOutputRendererService, InstantiationType.Delayed);
registerSingleton(IChatPasteTargetService, ChatPasteTargetService, InstantiationType.Delayed);
registerSingleton(IChatPetService, ChatPetService, InstantiationType.Delayed);
registerSingleton(IChatPetWidgetService, ChatPetWidgetService, InstantiationType.Delayed);
registerSingleton(IChatRequestOriginService, ChatRequestOriginService, InstantiationType.Delayed);
registerSingleton(IChatResponseFileChangesService, EditorChatResponseFileChangesService, InstantiationType.Delayed);
registerSingleton(IChatResponseResourceFileSystemProvider, ChatResponseResourceFileSystemProvider, InstantiationType.Delayed);
registerSingleton(IChatService, ChatService, InstantiationType.Delayed);
registerSingleton(IChatSideChatService, ChatSideChatService, InstantiationType.Delayed);
registerSingleton(IChatSlashCommandService, ChatSlashCommandService, InstantiationType.Delayed);
registerSingleton(IChatSpeechToTextService, ChatSpeechToTextService, InstantiationType.Delayed);
registerSingleton(IChatSubmitRequestHandlerService, ChatSubmitRequestHandlerService, InstantiationType.Delayed);
registerSingleton(IChatTipService, ChatTipService, InstantiationType.Delayed);
registerSingleton(IChatTodoListService, ChatTodoListService, InstantiationType.Delayed);
registerSingleton(IChatToolRiskAssessmentService, ChatToolRiskAssessmentService, InstantiationType.Delayed);
registerSingleton(IChatTransferService, ChatTransferService, InstantiationType.Delayed);
registerSingleton(IChatVariablesService, ChatVariablesService, InstantiationType.Delayed);
registerSingleton(IChatWidgetHistoryService, ChatWidgetHistoryService, InstantiationType.Delayed);
registerSingleton(IChatWidgetService, ChatWidgetService, InstantiationType.Delayed);
registerSingleton(ICodeMapperService, CodeMapperService, InstantiationType.Delayed);
registerSingleton(ICustomizationMigrationTelemetryService, CustomizationMigrationTelemetryService, InstantiationType.Delayed);
registerSingleton(IInlineChatSessionResolver, InlineChatSessionResolver, InstantiationType.Delayed);
registerSingleton(IInlineChatSessionService, InlineChatSessionServiceImpl, InstantiationType.Delayed);
registerSingleton(ILanguageModelIgnoredFilesService, LanguageModelIgnoredFilesService, InstantiationType.Delayed);
registerSingleton(ILanguageModelToolsConfirmationService, LanguageModelToolsConfirmationService, InstantiationType.Delayed);
registerSingleton(ILanguageModelToolsService, LanguageModelToolsService, InstantiationType.Delayed);
registerSingleton(ILanguageModelsConfigurationService, LanguageModelsConfigurationService, InstantiationType.Delayed);
registerSingleton(ILanguageModelsService, LanguageModelsService, InstantiationType.Delayed);
registerSingleton(IMcpElicitationService, McpElicitationService, InstantiationType.Delayed);
registerSingleton(IMcpRegistry, McpRegistry, InstantiationType.Delayed);
registerSingleton(IMcpSamplingService, McpSamplingService, InstantiationType.Delayed);
registerSingleton(IMcpSandboxService, McpSandboxService, InstantiationType.Delayed);
registerSingleton(IMcpService, McpService, InstantiationType.Delayed);
registerSingleton(IMcpWorkbenchService, McpWorkbenchService, InstantiationType.Delayed);
registerSingleton(IPlanReviewFeedbackService, PlanReviewFeedbackService, InstantiationType.Delayed);
registerSingleton(IPluginInstallService, PluginInstallService, InstantiationType.Delayed);
registerSingleton(IPluginMarketplaceService, PluginMarketplaceService, InstantiationType.Delayed);
registerSingleton(IPromptsService, PromptsService, InstantiationType.Delayed);
registerSingleton(IQuickChatService, QuickChatService, InstantiationType.Delayed);
registerSingleton(ISessionChatPillVisibilityService, SessionChatPillVisibility, InstantiationType.Delayed);
registerSingleton(ISessionSummaryHoverService, SessionSummaryHoverService, InstantiationType.Delayed);
registerSingleton(ISpeechService, SpeechService, InstantiationType.Delayed);
registerSingleton(IToolResultCompressor, ToolResultCompressorService, InstantiationType.Delayed);
registerSingleton(IVoiceCodeTranscriptionClient, VoiceCodeTranscriptionClient, InstantiationType.Delayed);
registerSingleton(IWorkspacePluginSettingsService, WorkspacePluginSettingsService, InstantiationType.Delayed);
registerSingleton(IMcpGalleryService, McpGalleryService, InstantiationType.Delayed);
registerSingleton(IAllowedMcpServersService, AllowedMcpServersService, InstantiationType.Delayed);
