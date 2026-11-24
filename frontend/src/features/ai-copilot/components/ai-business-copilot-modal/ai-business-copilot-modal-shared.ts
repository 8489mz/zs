export interface ReasoningStep {
  step: string;
  observation: string;
}

export interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  suggestedQuestions?: string[];
  reasoningSteps?: ReasoningStep[];
  toolsUsed?: string[];
}

export interface KnowledgeSource {
  id: number;
  title: string;
  source_type: string;
  status: string;
  chunk_count: number;
  token_count: number;
  created_at: string;
}

export interface AiBusinessCopilotModalProps {
  open: boolean;
  onClose: () => void;
}

export const QUICK_SUGGESTIONS_EN = [
  'How much did we earn today?',
  'Current cash in safe & register',
  'What are critical stock shortages?',
  'Top customers with outstanding balances',
  'Out-of-the-box ideas to boost profit',
  'Opportunities to move stagnant stock',
  'Company policies & terms',
  'Top 5 best-selling products',
];

export const QUICK_SUGGESTIONS = [
  'كسبت كام النهاردة؟',
  'فلوس الخزينة والدرج الحالية',
  'ايه نواقص المخزن الحرجة؟',
  'مين أكتر عملاء عليهم فلوس؟',
  'أفكار بره الصندوق لزيادة الأرباح',
  'فرص تصريف البضاعة الراكدة',
  'شروط وسياسات المنشأة',
  'أكتر 5 منتجات مبيعاً',
];
