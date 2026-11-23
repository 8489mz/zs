export type AiProvider = 'gemini' | 'openai' | 'custom';

export interface CopilotResponse {
  answer: string;
  suggestedQuestions: string[];
  metrics?: Record<string, unknown>;
  engine?: 'gemini_llm' | 'openai_llm' | 'custom_llm' | 'local_analytics';
}
