import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AiCopilotService, CopilotResponse } from './ai-copilot.service';
import { AiAgentService, AgentChatResponse } from './services/ai-agent.service';
import { AiKnowledgeService } from './services/ai-knowledge.service';

@Controller('api/ai-copilot')
@UseGuards(SessionAuthGuard)
export class AiCopilotController {
  constructor(
    private readonly copilotService: AiCopilotService,
    private readonly agentService: AiAgentService,
    private readonly knowledgeService: AiKnowledgeService,
  ) {}

  private assertCanManageAiSettings(req: RequestWithAuth): void {
    const auth = req.authContext;
    if (
      !auth ||
      (auth.role !== 'admin' &&
        auth.role !== 'super_admin' &&
        !auth.permissions?.includes('settings') &&
        !auth.permissions?.includes('canManageSettings'))
    ) {
      throw new ForbiddenException('Missing settings management permission');
    }
  }

  /**
   * New Conversational Reasoning Agent Endpoint (Multi-turn + Tools + Out-of-the-box reasoning)
   */
  @Post('agent/chat')
  async chatAgent(
    @Body() body: { message: string; sessionId?: string },
    @Req() req: RequestWithAuth,
  ): Promise<AgentChatResponse> {
    const actor = req.authContext!;
    const { tenantId } = requireTenantScope(actor);
    const aiConfig = await this.copilotService.getEffectiveAiConfig(tenantId);

    return this.agentService.chat(
      body.message,
      body.sessionId,
      actor,
      aiConfig.apiKey?.trim(),
      aiConfig.provider,
      aiConfig.model,
      aiConfig.baseUrl,
    );
  }

  /**
   * List recent chat sessions
   */
  @Get('agent/sessions')
  listSessions(@Req() req: RequestWithAuth) {
    return this.agentService.listUserSessions(req.authContext!);
  }

  /**
   * Get messages for a specific session
   */
  @Get('agent/sessions/:id/messages')
  getSessionMessages(@Param('id') sessionId: string, @Req() req: RequestWithAuth) {
    return this.agentService.getSessionMessages(sessionId, req.authContext!);
  }

  /**
   * Add a new document / policy / manual to the knowledge base (Chatbase style)
   */
  @Post('knowledge/sources')
  async addKnowledgeSource(
    @Body()
    body: {
      title: string;
      sourceType?: string;
      rawText: string;
      fileUrl?: string;
      metadata?: Record<string, unknown>;
    },
    @Req() req: RequestWithAuth,
  ) {
    const actor = req.authContext!;
    const { tenantId } = requireTenantScope(actor);
    const aiConfig = await this.copilotService.getEffectiveAiConfig(tenantId);

    return this.knowledgeService.addSource(body, actor, aiConfig.apiKey?.trim(), aiConfig.provider);
  }

  /**
   * List company knowledge sources
   */
  @Get('knowledge/sources')
  listKnowledgeSources(@Req() req: RequestWithAuth) {
    return this.knowledgeService.listSources(req.authContext!);
  }

  /**
   * Delete a knowledge source
   */
  @Delete('knowledge/sources/:id')
  deleteKnowledgeSource(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.knowledgeService.deleteSource(id, req.authContext!);
  }

  /**
   * Auto-index active product catalog into knowledge base
   */
  @Post('knowledge/auto-index-products')
  async autoIndexProducts(@Req() req: RequestWithAuth) {
    const actor = req.authContext!;
    const { tenantId } = requireTenantScope(actor);
    const aiConfig = await this.copilotService.getEffectiveAiConfig(tenantId);

    return this.knowledgeService.autoIndexProducts(actor, aiConfig.apiKey?.trim(), aiConfig.provider);
  }

  // --- Legacy Endpoints for Backwards Compatibility ---

  @Post('ask')
  ask(@Body('question') question: string, @Req() req: RequestWithAuth): Promise<CopilotResponse> {
    return this.copilotService.ask(question, req.authContext!);
  }

  @Get('config')
  getConfig(@Req() req: RequestWithAuth) {
    this.assertCanManageAiSettings(req);
    return this.copilotService.getConfig(req.authContext!);
  }

  @Post('config')
  saveConfig(
    @Body()
    body: {
      provider?: 'gemini' | 'openai' | 'custom';
      apiKey?: string;
      geminiApiKey?: string;
      model?: string;
      baseUrl?: string;
    },
    @Req() req: RequestWithAuth,
  ) {
    this.assertCanManageAiSettings(req);
    return this.copilotService.saveConfig(body, req.authContext!);
  }

  @Post('test-key')
  testKey(
    @Body()
    body: {
      apiKey?: string;
      provider?: 'gemini' | 'openai' | 'custom';
      model?: string;
      baseUrl?: string;
    },
    @Req() req: RequestWithAuth,
  ) {
    this.assertCanManageAiSettings(req);
    return this.copilotService.testAiKey(body, req.authContext!);
  }

  @Post('models')
  getModels(
    @Body()
    body: {
      apiKey?: string;
      provider?: 'gemini' | 'openai' | 'custom';
    },
    @Req() req: RequestWithAuth,
  ) {
    this.assertCanManageAiSettings(req);
    return this.copilotService.getAvailableModels(body, req.authContext!);
  }

  @Post('simulate-bot')
  simulateBot(@Body('question') question: string, @Req() req: RequestWithAuth) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.copilotService.generateSalesBotReply({
      question,
      tenantId,
    });
  }
}
